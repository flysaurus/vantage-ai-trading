/**
 * Noticed Engine — shared rules engine & Haiku generation for AI Noticed feed.
 *
 * Used by both:
 * - POST /api/ai/noticed (client-triggered, per-user)
 * - POST /api/cron/portfolio-agent (QStash-scheduled, multi-user batched)
 */

import { createServerClient } from '@/lib/supabase';
import { callChatAI } from '@/lib/ai-provider';
import { AGENT_PRINCIPLES } from '@/lib/ai-principles';
import { checkUsageLimit } from '@/lib/ai-guard';
import { STYLE_SECTOR_TARGETS, NON_SECTOR_BUCKETS } from '@/lib/risk-narrative';
import { decomposePositionValue, resolveEtfWeightsForPositions } from '@/lib/etf-sectors';
import type { SystemBlock } from '@/lib/ai-provider';
import { PORTFOLIO_AGENT_SAFETY_BLOCKS } from '@/lib/ai/shared-safety-blocks';
import { IDLE_CASH_THRESHOLD, IDLE_CASH_MIN_DAYS, resolveIdleCash } from './idle-cash';

// ── Config ──
const FINBERT_URL = process.env.FINBERT_URL || 'http://127.0.0.1:8765';
const POSITIVE_BANDS = [15, 25, 50, 100, 250];
const NEGATIVE_BANDS = [-10, -20, -35, -50];

// ── Types ──
export interface PortfolioPosition {
  symbol: string;
  qty: number;
  marketValue: number;
  avgCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  sector?: string;
}

export interface PortfolioAccount {
  cash: number;
  equity: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
}

export interface NoticedRuleInput {
  account: PortfolioAccount;
  positions: PortfolioPosition[];
  watchlistSymbols: string[];
  daysSinceLastTrade: number;
  /** Spendable cash (settled cash − open reservations). Computed by the pipeline. */
  availableCash?: number | null;
  /** True when the account is read-only (skip the idle-cash invest prompt). */
  isReadOnly?: boolean;
  /** Consecutive trading days availableCash has stayed above the threshold. */
  idleCashStreak?: number;
}

export interface NoticedTrigger {
  trigger_type: string;
  trigger_key: string;
  title: string;
  variant: 'accent' | 'warn' | 'gain';
  icon: string;
  /**
   * Deterministic CTA marker carried as `meta.action` — never free-text.
   * 'REBALANCE' → concentration-risk / allocation drift.
   * 'REVIEW_POSITION:<TICKER>' → single-position flag.
   * Absent = no inline CTA.
   */
  meta: Record<string, any>;
  follow_up: string;
  context: string;
}

// ── Build portfolio summary for Haiku ──
export function buildPortfolioSummary(input: NoticedRuleInput): string {
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

// ── Rules: position milestones + idle cash ──
export function findNewTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
  investorStyle?: string | null,
): NoticedTrigger[] {
  const triggers: NoticedTrigger[] = [];
  const { account, positions } = input;

  // ── 1. Idle Cash (dollar threshold + consecutive trading-day streak) ──
  // Replaces the old percentage heuristic (cashPct > 50 && daysSinceLastTrade > 7)
  // with the shared availableCash helper + a 3-trading-day streak. Read-only
  // accounts are skipped via the shared trading-capability check.
  const availableCash = typeof input.availableCash === 'number' ? input.availableCash : null;
  if (
    availableCash !== null &&
    availableCash > IDLE_CASH_THRESHOLD &&
    (input.idleCashStreak ?? 0) >= IDLE_CASH_MIN_DAYS &&
    !input.isReadOnly
  ) {
    const key = 'idle_cash';
    if (!existingKeys.has(key)) {
      const amount = Math.floor(availableCash);
      triggers.push({
        trigger_type: 'idle_cash',
        trigger_key: key,
        title: `$${amount.toLocaleString()} cash idle`,
        variant: 'warn',
        icon: '💤',
        meta: {
          amount,
          cashBalance: amount,
          daysIdle: input.idleCashStreak,
          action: `INVEST_CASH:${amount}`,
        },
        follow_up: `Want to put $${amount.toLocaleString()} to work?`,
        context: `$${amount.toLocaleString()} in available cash (after open orders) has been idle for ${input.idleCashStreak} consecutive trading days. Investor style: ${investorStyle || 'unspecified'}.`,
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
          meta: { symbol: pos.symbol, threshold: band, currentPnlPct: Math.round(pnlPct * 10) / 10, marketValue: pos.marketValue, action: `REVIEW_POSITION:${pos.symbol}` },
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

// ── Rules: portfolio drift vs style targets ──

export function findDriftTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
  investorStyle: string | null,
  etfWeights?: Map<string, Record<string, number>>,
): NoticedTrigger[] {
  const triggers: NoticedTrigger[] = [];
  if (!investorStyle) return triggers;

  const targets = STYLE_SECTOR_TARGETS[investorStyle];
  if (!targets) return triggers;

  const sectorValues = new Map<string, number>();
  for (const pos of input.positions) {
    // Decompose broad-market ETFs into underlying sector weights (dynamic
    // `etfWeights` when available, else static profile, else single sector) so
    // a 100%-SPY portfolio reads as ~31% Technology, ~13% Financials, etc.
    const resolved = etfWeights?.get((pos.symbol || '').toUpperCase());
    const decomposed = decomposePositionValue(pos.symbol, pos.sector, pos.marketValue, resolved);
    for (const [bucket, value] of Object.entries(decomposed)) {
      sectorValues.set(bucket, (sectorValues.get(bucket) || 0) + value);
    }
  }

  // Denominator = invested (sum of position market values) + cash.
  // Do NOT use account.equity here: the client sends equity as TOTAL account
  // value (already includes cash), so `equity + cash` would double-count cash
  // and skew every sector weight down.
  const investedValue = input.positions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
  const totalValue = investedValue + input.account.cash;

  for (const [sector, targetPct] of Object.entries(targets)) {
    if (NON_SECTOR_BUCKETS.has(sector)) continue;

    const currentValue = sectorValues.get(sector) || 0;
    const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
    const deviation = Math.round((currentPct - targetPct) * 10) / 10;
    const absDev = Math.abs(deviation);

    if (absDev < 15) continue;

    const key = `DRIFT_${sector.replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (existingKeys.has(key)) continue;

    const direction = deviation > 0 ? 'overweight' : 'underweight';
    triggers.push({
      trigger_type: 'portfolio_drift',
      trigger_key: key,
      title: `${sector} ${direction}`,
      variant: deviation > 25 ? 'warn' : 'accent',
      icon: '⚖️',
      meta: {
        sector,
        currentPct: Math.round(currentPct),
        targetPct,
        deviation: Math.round(deviation),
        totalValue,
        action: 'REBALANCE',
      },
      follow_up: `How should I rebalance my ${sector} exposure?`,
      context: `${sector}: ${Math.round(currentPct)}% vs ${targetPct}% target (${direction} by ${Math.abs(Math.round(deviation))}%). Portfolio: $${totalValue.toLocaleString()}. Style: ${investorStyle}.`,
    });
  }

  triggers.sort((a, b) => Math.abs(b.meta.deviation) - Math.abs(a.meta.deviation));
  return triggers.slice(0, 5);
}

// ── Rules: portfolio concentration (single-holding + top-N) ──
// Distinct from sector drift: catches broad-market ETF dominance / single-name
// bets that the drift engine can't see (it skips 'Broad Market' + non-target
// buckets and only compares per-sector weights vs style targets).
const CONC_SINGLE_PCT = 20; // largest single position >20% → REVIEW_POSITION CTA
const CONC_TOP3_PCT = 50;   // top-3 holdings >50% → REBALANCE CTA

export function findConcentrationTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
): NoticedTrigger[] {
  const triggers: NoticedTrigger[] = [];
  const positions = input.positions;
  if (!positions || positions.length === 0) return triggers;

  // Invested-only denominator: this is about HOLDING concentration, so cash
  // does not dilute the single-name / top-3 weight the way it would a sector
  // allocation target.
  const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
  if (totalValue <= 0) return triggers;

  const sorted = [...positions].sort(
    (a, b) => (b.marketValue || 0) - (a.marketValue || 0),
  );

  // ── Single-position concentration ──
  const largest = sorted[0];
  const largestPct = (largest.marketValue / totalValue) * 100;
  if (largestPct > CONC_SINGLE_PCT) {
    const key = `CONC_SINGLE_${largest.symbol}`;
    if (!existingKeys.has(key)) {
      const pct = Math.round(largestPct * 10) / 10;
      triggers.push({
        trigger_type: 'concentration_single',
        trigger_key: key,
        title: `${largest.symbol} is ${pct}% of you`,
        variant: largestPct > 35 ? 'warn' : 'accent',
        icon: '🎯',
        meta: {
          symbol: largest.symbol,
          pct,
          marketValue: largest.marketValue,
          totalValue,
          action: `REVIEW_POSITION:${largest.symbol}`,
        },
        follow_up: `Should I trim ${largest.symbol} to reduce single-name risk?`,
        context: `${largest.symbol} alone is ${pct}% of your portfolio — one bad day could really hurt.`,
      });
    }
  }

  // ── Top-3 concentration ──
  const top3 = sorted.slice(0, 3);
  const top3Value = top3.reduce((sum, p) => sum + (p.marketValue || 0), 0);
  const top3Pct = (top3Value / totalValue) * 100;
  if (top3Pct > CONC_TOP3_PCT) {
    const key = 'CONC_TOP3';
    if (!existingKeys.has(key)) {
      const pct = Math.round(top3Pct * 10) / 10;
      const symbols = top3.map((p) => p.symbol);
      triggers.push({
        trigger_type: 'concentration_top3',
        trigger_key: key,
        title: `Top 3 are ${pct}% of you`,
        variant: top3Pct > 70 ? 'warn' : 'accent',
        icon: '🧺',
        meta: {
          symbols,
          pct,
          totalValue,
          action: 'REBALANCE',
        },
        follow_up: `How should I diversify beyond ${symbols.join(', ')}?`,
        context: `Your top 3 holdings (${symbols.join(', ')}) make up ${pct}% of your portfolio — heavy concentration risk.`,
      });
    }
  }

  return triggers;
}

// ── Rules: earnings proximity (Finnhub) ──
export async function findEarningsTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
): Promise<NoticedTrigger[]> {
  const triggers: NoticedTrigger[] = [];
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

// ── Rules: sentiment shift (FinBERT + Finnhub news) ──
export async function findSentimentShiftTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
): Promise<NoticedTrigger[]> {
  const triggers: NoticedTrigger[] = [];
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
      const newsUrl = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${threeDaysAgo}&to=${today}&token=${FINNHUB_KEY}`;
      const newsRes = await fetch(newsUrl, { signal: AbortSignal.timeout(5000) });
      if (!newsRes.ok) continue;
      const articles = await newsRes.json();
      if (!Array.isArray(articles) || articles.length === 0) continue;

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
        } catch { /* skip */ }
      }

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
        meta: { symbol, negativeCount: negativeHeadlines.length, totalHeadlines: headlines.length, sample, action: `REVIEW_POSITION:${symbol}` },
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
export async function generateObservations(
  triggers: NoticedTrigger[],
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
      systemBlocks: [NOTICED_SYSTEM, ...AGENT_PRINCIPLES, ...PORTFOLIO_AGENT_SAFETY_BLOCKS],
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

// ── User processing context (built by cron endpoint, consumed by processUserTriggers) ──
export interface UserProcessingContext {
  userId: string;
  input: NoticedRuleInput;
  investorStyle: string | null;
  existingKeys: Set<string>;
  supabase: any;
}

// ── Run full noticed pipeline for one user, returning processed results ──
// Used by both the POST route and the cron endpoint
export async function runNoticedPipeline(
  ctx: UserProcessingContext,
): Promise<{
  allTriggers: NoticedTrigger[];
  trulyNew: NoticedTrigger[];
  haikuGenerated: boolean;
  budgetRemaining: number;
}> {
  const { input, existingKeys, investorStyle, supabase, userId } = ctx;

  // ── Resolve idle-cash inputs (available cash + streak + read-only) ──
  // Runs on every pipeline pass (both POST + cron). Records today's cash
  // snapshot so the streak reflects the current trading day.
  if (input.availableCash == null && input.account.cash != null) {
    try {
      const resolved = await resolveIdleCash(supabase, userId, input.account.cash);
      input.availableCash = resolved.availableCash;
      input.idleCashStreak = resolved.idleCashStreak;
      input.isReadOnly = resolved.isReadOnly;
    } catch (err: any) {
      console.warn('[noticed] idle-cash resolve failed:', err?.message || err);
    }
  }

  // ── Resolve dynamic ETF sector weights (Yahoo → Supabase cache) ──
  // Only fund-ish positions are looked up; individual stocks keep their single
  // sector. Resolution is best-effort and never throws (falls back to static).
  let etfWeights = new Map<string, Record<string, number>>();
  try {
    etfWeights = await resolveEtfWeightsForPositions(input.positions, supabase);
  } catch (err: any) {
    console.warn('[noticed] ETF weight resolve failed:', err?.message || err);
  }

  // Run all rule engines
  let allTriggers: NoticedTrigger[] = findNewTriggers(input, existingKeys, investorStyle);
  allTriggers = allTriggers.concat(findConcentrationTriggers(input, existingKeys));
  allTriggers = allTriggers.concat(findDriftTriggers(input, existingKeys, investorStyle, etfWeights));
  allTriggers = allTriggers.concat(await findEarningsTriggers(input, existingKeys));
  allTriggers = allTriggers.concat(await findSentimentShiftTriggers(input, existingKeys));

  // Identify truly new (not re-firing resolved items)
  const allKeys = allTriggers.map(t => t.trigger_key);
  const { data: resolvedItems } = await supabase
    .from('noticed_items')
    .select('id, trigger_key, regenerated_count')
    .eq('user_id', userId)
    .eq('resolved', true)
    .in('trigger_key', allKeys);

  // Re-activate resolved items that fired again
  if (resolvedItems && resolvedItems.length > 0) {
    await supabase
      .from('noticed_items')
      .update({ resolved: false, dismissed_until: null, last_checked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('trigger_key', (resolvedItems as any[]).map((r: any) => r.trigger_key));

    const triggerByKey = new Map(allTriggers.map((t) => [t.trigger_key, t]));
    for (const item of resolvedItems as any[]) {
      const fresh = triggerByKey.get(item.trigger_key);
      const update: any = { regenerated_count: (item.regenerated_count || 0) + 1 };
      if (fresh) {
        // Refresh deterministic fields (incl. meta.action CTA marker) from the
        // freshly-computed trigger so re-fired items carry the current action.
        update.meta = fresh.meta;
        update.variant = fresh.variant;
        update.icon = fresh.icon;
        update.title = fresh.title;
        update.follow_up = fresh.follow_up;
      }
      await supabase
        .from('noticed_items')
        .update(update)
        .eq('id', item.id);
    }
  }

  const resolvedKeys = new Set((resolvedItems || []).map((r: any) => r.trigger_key));
  const trulyNew = allTriggers.filter(t => !resolvedKeys.has(t.trigger_key));

  // Budget-checked Haiku generation
  let haikuGenerated = false;
  let budgetRemaining = 0;

  if (trulyNew.length > 0) {
    const budget = await checkUsageLimit(userId, 'noticed');
    budgetRemaining = budget.remaining;

    if (budget.allowed) {
      const portfolioSummary = buildPortfolioSummary(input);
      const observations = await generateObservations(trulyNew, portfolioSummary);
      haikuGenerated = true;

      // Upsert into noticed_items
      for (const trigger of trulyNew) {
        const obs = observations.get(trigger.trigger_key);
        await supabase.from('noticed_items').upsert({
          user_id: userId,
          trigger_type: trigger.trigger_type,
          trigger_key: trigger.trigger_key,
          title: trigger.title,
          body: obs?.body || trigger.context,
          fallback: false,
          follow_up: obs?.follow_up || trigger.follow_up,
          variant: trigger.variant,
          icon: trigger.icon,
          meta: trigger.meta,
          resolved: false,
          dismissed_until: null,
          last_checked_at: new Date().toISOString(),
        }, { onConflict: 'user_id,trigger_key' });
      }

      // Log generation
      supabase.from('ai_generation_log').insert({
        user_id: userId,
        surface: 'noticed',
        facts_read: [],
        prompt_context: '',
        facts_written: trulyNew.map(t => ({
          subject: t.trigger_key,
          claim: observations.get(t.trigger_key)?.body || t.context,
          fact_type: 'noticed_observation',
        })),
      }).then(() => { /* silent */ }).catch((e: any) => {
        if (!e?.message?.includes('does not exist')) {
          console.warn('[noticed] Failed to write generation log:', e?.message || e);
        }
      });
    } else {
      // Budget exhausted — use fallback text
      for (const trigger of trulyNew) {
        await supabase.from('noticed_items').upsert({
          user_id: userId,
          trigger_type: trigger.trigger_type,
          trigger_key: trigger.trigger_key,
          title: trigger.title,
          body: trigger.context,
          fallback: true,
          follow_up: trigger.follow_up,
          variant: trigger.variant,
          icon: trigger.icon,
          meta: trigger.meta,
          resolved: false,
          dismissed_until: null,
          last_checked_at: new Date().toISOString(),
        }, { onConflict: 'user_id,trigger_key' });
      }

      // Log skip
      supabase.from('ai_generation_log').insert({
        user_id: userId,
        surface: 'noticed',
        facts_read: [],
        prompt_context: `SKIPPED: ${budget.reason}`,
        facts_written: trulyNew.map(t => ({
          subject: t.trigger_key,
          claim: t.context,
          fact_type: 'noticed_fallback',
        })),
      }).then(() => { /* silent */ }).catch((e: any) => {
        if (!e?.message?.includes('does not exist')) {
          console.warn('[noticed] Failed to write skip log:', e?.message || e);
        }
      });
    }
  }

  // Resolve stale items (skip currently-dismissed items so snooze/dismiss
  // suppresses re-firing during the same trigger period).
  const allTriggerKeys = new Set(allTriggers.map(t => t.trigger_key));
  const nowIso = new Date().toISOString().replace('Z', '');
  const { data: staleItems } = await supabase
    .from('noticed_items')
    .select('trigger_key')
    .eq('user_id', userId)
    .eq('resolved', false)
    .or(`dismissed_until.is.null,dismissed_until.lt.${nowIso}`);

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

  return { allTriggers, trulyNew, haikuGenerated, budgetRemaining };
}
