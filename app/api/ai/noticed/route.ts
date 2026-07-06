/**
 * POST /api/ai/noticed — Check triggers + generate AI copy + return visible items
 *
 * Accepts portfolio state from client. Runs rules engine, batch-generates
 * Haiku copy for new triggers, upserts to noticed_items, returns visible feed.
 *
 * GET returns current visible items without re-checking triggers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getOptionalUserId } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { callChatAI } from '@/lib/ai-provider';
import type { SystemBlock } from '@/lib/ai-provider';

const FINBERT_URL = process.env.FINBERT_URL || 'http://127.0.0.1:8765';

// ── Threshold bands for position milestones ──
const POSITIVE_BANDS = [15, 25, 50, 100, 250];
const NEGATIVE_BANDS = [-10, -20, -35, -50];

// ── Types ──
interface PortfolioPosition {
  symbol: string;
  qty: number;
  marketValue: number;
  avgCost: number;
  totalPnl: number;
  totalPnlPercent: number;
}

interface PortfolioAccount {
  cash: number;
  equity: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
}

interface NoticedRuleInput {
  account: PortfolioAccount;
  positions: PortfolioPosition[];
  watchlistSymbols: string[];
  daysSinceLastTrade: number;
}

interface NewTrigger {
  trigger_type: string;
  trigger_key: string;
  title: string;
  variant: 'accent' | 'warn' | 'gain';
  icon: string;
  meta: Record<string, any>;
  follow_up: string;
  context: string;
}

// ── Rules engine ──
function findNewTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
): NewTrigger[] {
  const triggers: NewTrigger[] = [];
  const { account, positions, daysSinceLastTrade } = input;
  const totalValue = account.equity + account.cash;

  // ── 1. Idle Cash ──
  const cashPct = totalValue > 0 ? (account.cash / totalValue) * 100 : 0;
  if (cashPct > 50 && daysSinceLastTrade > 7) {
    const key = 'idle_cash';
    if (!existingKeys.has(key)) {
      triggers.push({
        trigger_type: 'idle_cash',
        trigger_key: key,
        title: `${cashPct.toFixed(0)}% cash idle`,
        variant: 'warn',
        icon: '⚠️',
        meta: { cashPct: Math.round(cashPct), daysIdle: daysSinceLastTrade, cashBalance: account.cash },
        follow_up: 'What should I do with my idle cash?',
        context: `Cash: ${cashPct.toFixed(0)}% ($${account.cash.toLocaleString()}) idle for ${daysSinceLastTrade} days since last trade. Total portfolio: $${totalValue.toLocaleString()}.`,
      });
    }
  }

  // ── 2. Position Milestones ──
  for (const pos of positions) {
    const pnlPct = pos.totalPnlPercent || 0;
    const crossedBands = pnlPct > 0
      ? POSITIVE_BANDS.filter(b => pnlPct >= b)
      : NEGATIVE_BANDS.filter(b => pnlPct <= b);

    for (const band of crossedBands) {
      const bandLabel = band > 0 ? `+${band}` : `${band}`;
      const key = `MILESTONE_${pos.symbol}_${bandLabel}`;
      if (!existingKeys.has(key)) {
        const isPositive = band > 0;
        triggers.push({
          trigger_type: 'position_milestone',
          trigger_key: key,
          title: `${pos.symbol} ${bandLabel}%`,
          variant: isPositive ? 'gain' : 'warn',
          icon: isPositive ? '📈' : '📉',
          meta: { symbol: pos.symbol, threshold: band, currentPnlPct: Math.round(pnlPct * 10) / 10, marketValue: pos.marketValue },
          follow_up: isPositive
            ? `Should I take profits on ${pos.symbol}?`
            : `Is ${pos.symbol} still worth holding?`,
          context: `${pos.symbol}: crossed ${bandLabel}% total return threshold (currently at ${pnlPct.toFixed(1)}%). Position value: $${pos.marketValue.toLocaleString()}.`,
        });
      }
    }
  }

  return triggers;
}

// ── Build portfolio summary for Haiku ──
function buildPortfolioSummary(input: NoticedRuleInput): string {
  const { account, positions } = input;
  const totalValue = account.equity + account.cash;
  const lines: string[] = [];
  lines.push(`Equity: $${account.equity.toLocaleString()} | Cash: $${account.cash.toLocaleString()} | Total: $${totalValue.toLocaleString()}`);
  lines.push(`Day P&L: ${account.dayPnl >= 0 ? '+' : ''}$${account.dayPnl.toFixed(2)} (${account.dayPnlPercent >= 0 ? '+' : ''}${account.dayPnlPercent.toFixed(2)}%)`);
  lines.push(`Total P&L: ${account.totalPnl >= 0 ? '+' : ''}$${account.totalPnl.toFixed(2)} (${account.totalPnlPercent >= 0 ? '+' : ''}${account.totalPnlPercent.toFixed(2)}%)`);
  if (positions.length > 0) {
    const posList = positions.map(p =>
      `${p.symbol}: $${p.marketValue.toLocaleString()} | ${p.totalPnlPercent >= 0 ? '+' : ''}${p.totalPnlPercent.toFixed(1)}%`
    ).join(', ');
    lines.push(`Positions: ${posList}`);
  }
  return lines.join('\n');
}

// ── Static system prompt for Haiku batch generation ──
const NOTICED_SYSTEM: SystemBlock = {
  type: 'text',
  text: `You are Vantage AI's proactive feed engine. Generate ONE short observation (1-2 sentences, max 30 words each) for each trigger below.

VOICE: Casual, direct, like a smart friend texting. Call out what matters. No formal language. No "you might want to consider" — just say it.

FORMAT — return exactly one line per trigger, pipe-delimited:
TRIGGER_KEY|observation text|follow-up question

Example:
MILESTONE_AAPL_+25|AAPL just blew past +25% — your patience since buying in March paid off big.|Should I take profits on AAPL?
idle_cash|You've got $30k in cash doing nothing for 2 weeks. That's real money losing to inflation.|What should I do with my idle cash?`,
};

// ── Batch Haiku generation ──
async function generateObservations(
  triggers: NewTrigger[],
  portfolioSummary: string,
): Promise<Map<string, { body: string; follow_up: string }>> {
  const results = new Map<string, { body: string; follow_up: string }>();
  if (triggers.length === 0) return results;

  const triggerLines = triggers.map((t, i) =>
    `${i + 1}. [${t.trigger_key}] ${t.title} — ${t.context}`
  ).join('\n');

  const triggerPrompt = `PORTFOLIO:\n${portfolioSummary}\n\nTRIGGERS:\n${triggerLines}\n\nGenerate observations for each trigger above.`;

  try {
    const res = await callChatAI({
      messages: [{ role: 'user', content: triggerPrompt }],
      systemBlocks: [NOTICED_SYSTEM],
      maxTokens: 400,
      temperature: 0.4,
    });

    const text = res.content || '';
    const lines = text.split('\n').filter((l: string) => l.includes('|'));
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 3) {
        const key = parts[0].trim();
        const body = parts[1].trim();
        const followUp = parts.slice(2).join('|').trim();
        if (key && body) {
          results.set(key, { body, follow_up: followUp || '' });
        }
      }
    }
  } catch (err: any) {
    console.error('[noticed] Haiku generation failed:', err.message);
    for (const t of triggers) {
      results.set(t.trigger_key, { body: t.context, follow_up: t.follow_up });
    }
  }

  return results;
}

// ── Fetch earnings proximity triggers ──
async function findEarningsTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
): Promise<NewTrigger[]> {
  const triggers: NewTrigger[] = [];
  const allSymbols = [
    ...input.positions.map(p => p.symbol),
    ...(input.watchlistSymbols || []),
  ];
  const unique = [...new Set(allSymbols)];
  if (unique.length === 0) return triggers;

  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
    if (!FINNHUB_KEY) return triggers;

    const now = new Date();
    const from = now.toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const results = await Promise.allSettled(
      unique.map(async (symbol) => {
        const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${symbol}&token=${FINNHUB_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const events = data?.earningsCalendar || [];
        if (events.length === 0) return null;
        return { symbol, date: events[0].date };
      }),
    );

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const { symbol, date } = r.value;
      const key = `EARNINGS_${symbol}_${date}`;
      if (existingKeys.has(key)) continue;

      triggers.push({
        trigger_type: 'earnings_proximity',
        trigger_key: key,
        title: `${symbol} earnings`,
        variant: 'accent',
        icon: '📅',
        meta: { symbol, earningsDate: date },
        follow_up: `What should I expect from ${symbol} earnings?`,
        context: `${symbol} has earnings coming up on ${date} (within 30 days).`,
      });
    }
  } catch (err: any) {
    console.error('[noticed] Earnings fetch failed:', err.message);
  }

  return triggers;
}

// ── Fetch sentiment-shift triggers (FinBERT) ──
async function findSentimentShiftTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
): Promise<NewTrigger[]> {
  const triggers: NewTrigger[] = [];
  const allSymbols = [
    ...input.positions.map(p => p.symbol),
    ...(input.watchlistSymbols || []),
  ];
  const unique = [...new Set(allSymbols)];
  if (unique.length === 0) return triggers;

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || process.env.FINNHUB_IO_API_KEY;
  if (!FINNHUB_KEY) return triggers;

  const today = new Date().toISOString().split('T')[0];
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

  for (const symbol of unique.slice(0, 10)) {
    try {
      // Fetch recent company news from Finnhub
      const newsUrl = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${threeDaysAgo}&to=${today}&token=${FINNHUB_KEY}`;
      const newsRes = await fetch(newsUrl, { signal: AbortSignal.timeout(5000) });
      if (!newsRes.ok) continue;
      const articles = await newsRes.json();
      if (!Array.isArray(articles) || articles.length === 0) continue;

      // Score headlines with FinBERT (first 5 headlines)
      const headlines = articles.slice(0, 5).map((a: any) => a.headline || a.title || '').filter(Boolean);
      if (headlines.length < 2) continue;

      const finbertResults: { label: string; score: number; headline: string }[] = [];
      for (const headline of headlines) {
        try {
          const fbRes = await fetch(`${FINBERT_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: headline }),
            signal: AbortSignal.timeout(3000),
          });
          if (fbRes.ok) {
            const fb = await fbRes.json();
            finbertResults.push({ label: fb.label, score: fb.score, headline });
          }
        } catch { /* skip failed headline */ }
      }

      // Trigger: 2+ headlines are "negative" with score > 0.5
      const negativeHeadlines = finbertResults.filter(
        r => r.label === 'negative' && r.score > 0.5
      );
      if (negativeHeadlines.length < 2) continue;

      const key = `SENTIMENT_${symbol}`;
      if (existingKeys.has(key)) continue;

      const sample = negativeHeadlines.slice(0, 3).map(r => `"${r.headline.slice(0, 80)}..."`).join(', ');
      triggers.push({
        trigger_type: 'sentiment_shift',
        trigger_key: key,
        title: `${symbol} headlines turning negative`,
        variant: 'warn',
        icon: '📰',
        meta: {
          symbol,
          negativeCount: negativeHeadlines.length,
          totalHeadlines: headlines.length,
          sample,
        },
        follow_up: `What's happening with ${symbol}?`,
        context: `${symbol}: ${negativeHeadlines.length} of ${headlines.length} recent headlines scored negative by FinBERT. Headlines: ${sample}`,
      });

      console.log(`[noticed] Sentiment shift: ${symbol} — ${negativeHeadlines.length}/${headlines.length} negative`);
    } catch (err: any) {
      console.warn(`[noticed] Sentiment check failed for ${symbol}:`, err.message);
    }
  }

  return triggers;
}

// ── GET: Return visible items (no re-check) ──
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getOptionalUserId();
  if (!userId) return NextResponse.json({ items: [] });

  const supabase = createServerClient() as any;
  const { data: items } = await supabase
    .from('noticed_items')
    .select('*')
    .eq('user_id', userId)
    .eq('resolved', false)
    .or(`dismissed_until.is.null,dismissed_until.lt.${new Date().toISOString().replace('Z', '')}`)
    .order('created_at', { ascending: false })
    .limit(5);

  return NextResponse.json({
    items: (items || []).map(formatItem),
  });
}

// ── POST: Full check + generation ──
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const supabase = createServerClient() as any;

  try {
    const body = await req.json().catch(() => ({}));
    const portfolio = body.portfolio as PortfolioAccount | undefined;
    const positions = (body.positions || []) as PortfolioPosition[];
    const watchlistSymbols = (body.watchlistSymbols || []) as string[];

    if (!portfolio) {
      return NextResponse.json({ items: [], error: 'Missing portfolio data' }, { status: 400 });
    }

    // ── Get days since last trade ──
    let daysSinceLastTrade = 999;
    try {
      const { data: lastTrade } = await supabase
        .from('trade_history')
        .select('executed_at')
        .eq('user_id', userId)
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastTrade?.executed_at) {
        const lastDate = new Date(lastTrade.executed_at);
        daysSinceLastTrade = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    } catch {
      // If trade_history query fails, assume old
    }

    const input: NoticedRuleInput = {
      account: portfolio,
      positions,
      watchlistSymbols,
      daysSinceLastTrade,
    };

    // ── Get existing trigger keys ──
    const { data: existing } = await supabase
      .from('noticed_items')
      .select('trigger_key')
      .eq('user_id', userId)
      .eq('resolved', false);

    const existingKeys = new Set<string>((existing || []).map((e: any) => e.trigger_key));

    // ── Run rules engine ──
    let newTriggers = findNewTriggers(input, existingKeys);

    // ── Earnings (separate — async fetch) ──
    const earningsTriggers = await findEarningsTriggers(input, existingKeys);
    newTriggers = [...newTriggers, ...earningsTriggers];

    // ── Sentiment shift (separate — async FinBERT) ──
    const sentimentTriggers = await findSentimentShiftTriggers(input, existingKeys);
    newTriggers = [...newTriggers, ...sentimentTriggers];

    if (newTriggers.length === 0) {
      // Update last_checked_at on existing items
      await supabase
        .from('noticed_items')
        .update({ last_checked_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('resolved', false);

      const { data: visible } = await supabase
        .from('noticed_items')
        .select('*')
        .eq('user_id', userId)
        .eq('resolved', false)
        .or(`dismissed_until.is.null,dismissed_until.lt.${new Date().toISOString().replace('Z', '')}`)
        .order('created_at', { ascending: false })
        .limit(5);

      return NextResponse.json({ items: (visible || []).map(formatItem), newCount: 0 });
    }

    // ── Handle resolved triggers that re-fire ──
    const newKeys = newTriggers.map(t => t.trigger_key);
    const { data: resolvedItems } = await supabase
      .from('noticed_items')
      .select('id, trigger_key, regenerated_count')
      .eq('user_id', userId)
      .eq('resolved', true)
      .in('trigger_key', newKeys);

    if (resolvedItems && resolvedItems.length > 0) {
      // Re-activate resolved items that fired again
      await supabase
        .from('noticed_items')
        .update({
          resolved: false,
          dismissed_until: null,
          last_checked_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .in('trigger_key', (resolvedItems as any[]).map((r: any) => r.trigger_key));

      // Increment regenerated count for re-triggered items
      for (const item of resolvedItems as any[]) {
        await supabase
          .from('noticed_items')
          .update({ regenerated_count: (item.regenerated_count || 0) + 1 })
          .eq('id', item.id);
      }
    }

    // ── Generate Haiku copy for genuinely new triggers ──
    const resolvedKeys = new Set((resolvedItems || []).map((r: any) => r.trigger_key));
    const trulyNew = newTriggers.filter(t => !resolvedKeys.has(t.trigger_key));

    if (trulyNew.length > 0) {
      const portfolioSummary = buildPortfolioSummary(input);
      const observations = await generateObservations(trulyNew, portfolioSummary);

      for (const trigger of trulyNew) {
        const obs = observations.get(trigger.trigger_key);
        const body = obs?.body || trigger.context;
        const followUp = obs?.follow_up || trigger.follow_up;

        await supabase.from('noticed_items').upsert(
          {
            user_id: userId,
            trigger_type: trigger.trigger_type,
            trigger_key: trigger.trigger_key,
            title: trigger.title,
            body,
            follow_up: followUp,
            variant: trigger.variant,
            icon: trigger.icon,
            meta: trigger.meta,
            resolved: false,
            dismissed_until: null,
            last_checked_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,trigger_key' },
        );
      }
    }

    // ── Resolve items whose conditions are no longer true ──
    const allTriggerKeys = new Set(newTriggers.map(t => t.trigger_key));
    const { data: staleItems } = await supabase
      .from('noticed_items')
      .select('trigger_key')
      .eq('user_id', userId)
      .eq('resolved', false);

    if (staleItems) {
      const toResolve = (staleItems as any[])
        .filter((s: any) => !allTriggerKeys.has(s.trigger_key))
        .map((s: any) => s.trigger_key);

      if (toResolve.length > 0) {
        await supabase
          .from('noticed_items')
          .update({ resolved: true, last_checked_at: new Date().toISOString() })
          .eq('user_id', userId)
          .in('trigger_key', toResolve);
      }
    }

    // ── Return visible items ──
    const { data: visible } = await supabase
      .from('noticed_items')
      .select('*')
      .eq('user_id', userId)
      .eq('resolved', false)
      .or(`dismissed_until.is.null,dismissed_until.lt.${new Date().toISOString().replace('Z', '')}`)
      .order('created_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      items: (visible || []).map(formatItem),
      newCount: trulyNew.length,
    });
  } catch (err: any) {
    console.error('[noticed] Error:', err.message);
    return NextResponse.json({ items: [], error: err.message }, { status: 500 });
  }
}

// ── Format DB row for client ──
function formatItem(row: any) {
  return {
    id: row.id,
    triggerKey: row.trigger_key,
    triggerType: row.trigger_type,
    title: row.title,
    body: row.body,
    followUp: row.follow_up || '',
    variant: row.variant,
    icon: row.icon,
    meta: row.meta,
    createdAt: row.created_at,
    dismissedUntil: row.dismissed_until,
  };
}
