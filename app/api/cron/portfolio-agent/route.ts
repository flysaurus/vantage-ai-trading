/**
 * POST /api/cron/portfolio-agent
 *
 * QStash-scheduled endpoint that runs the Noticed rules engine across ALL
 * active users and generates Haiku observations for new triggers.
 *
 * Throttled: processes users in batches with pacing between batches to
 * avoid flooding the Claude API.
 *
 * Auth: Bearer token (CRON_SECRET, GH_CRON_SECRET, or QSTASH_CRON_SECRET)
 *
 * Schedule: every 30 min during US market hours (13-21 UTC, Mon-Fri)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { NoticedRuleInput, NoticedTrigger } from '@/lib/noticed/engine';
import { runNoticedPipeline } from '@/lib/noticed/engine';

// ── Auth ──
const ALLOWED_SECRETS = [
  process.env.CRON_SECRET || '',
  process.env.GH_CRON_SECRET || '',
  process.env.QSTASH_CRON_SECRET || '',
].filter(Boolean);

function validateAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  return ALLOWED_SECRETS.some(secret => authHeader === `Bearer ${secret}`);
}

// ── Batch config ──
const BATCH_SIZE = 10;   // users per batch
const BATCH_DELAY_MS = 2000; // pause between batches

// ── Sleeper ──
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── POST ──
export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  if (!validateAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient() as any;

  // ── 1. Fetch active users (have positions, not deleted) ──
  const { data: activeUsers, error: userErr } = await supabase
    .from('positions')
    .select('user_id')
    .neq('qty', 0)
    .order('user_id');

  if (userErr) {
    console.error('[portfolio-agent] Failed to fetch active users:', userErr.message);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }

  if (!activeUsers || activeUsers.length === 0) {
    console.log('[portfolio-agent] No active users with positions');
    return NextResponse.json({ usersChecked: 0, usersTriggered: 0, totalTriggers: 0, haikuGenerated: 0 });
  }

  // Deduplicate user IDs
  const userIds = [...new Set((activeUsers as any[]).map((p: any) => p.user_id))];
  console.log(`[portfolio-agent] Starting scan — ${userIds.length} active users`);

  // ── 2. Process in batches ──
  let usersChecked = 0;
  let usersTriggered = 0;
  let totalTriggers = 0;
  let totalHaiku = 0;
  let usersSkipped = 0;

  const batches: string[][] = [];
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    batches.push(userIds.slice(i, i + BATCH_SIZE));
  }

  console.log(`[portfolio-agent] ${batches.length} batches of up to ${BATCH_SIZE} users`);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(`[portfolio-agent] Batch ${batchIdx + 1}/${batches.length} — ${batch.length} users`);

    for (const userId of batch) {
      try {
        const result = await processUser(userId, supabase);
        usersChecked++;
        if (result.triggers > 0) {
          usersTriggered++;
          totalTriggers += result.triggers;
          totalHaiku += result.haikuGenerated;
        }
        if (result.skippedBudget) usersSkipped++;
      } catch (err: any) {
        console.error(`[portfolio-agent] Error processing user ${userId.slice(0, 8)}:`, err.message);
        usersChecked++;
      }
    }

    // Pace between batches (skip delay after last batch)
    if (batchIdx < batches.length - 1) {
      console.log(`[portfolio-agent] Batch ${batchIdx + 1} complete — pausing ${BATCH_DELAY_MS}ms`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[portfolio-agent] Complete — ${usersChecked} checked, ${usersTriggered} triggered, ${totalTriggers} triggers, ${totalHaiku} haiku, ${usersSkipped} budget-skipped, ${elapsed}s`);

  return NextResponse.json({
    usersChecked,
    usersTriggered,
    totalTriggers,
    haikuGenerated: totalHaiku,
    usersBudgetSkipped: usersSkipped,
    elapsedSeconds: parseFloat(elapsed),
  });
}

// ── Per-user processing ──
async function processUser(
  userId: string,
  supabase: any,
): Promise<{ triggers: number; haikuGenerated: number; skippedBudget: boolean }> {
  // ── Fetch user's investor style + concentration thresholds ──
  let investorStyle: string | null = null;
  let concSinglePct: number | null = null;
  let concTop3Pct: number | null = null;
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('investor_style, conc_single_pct, conc_top3_pct')
      .eq('id', userId)
      .single();
    investorStyle = userRow?.investor_style || null;
    concSinglePct = userRow?.conc_single_pct ?? null;
    concTop3Pct = userRow?.conc_top3_pct ?? null;
  } catch { /* ignore */ }

  // ── Fetch positions ──
  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .neq('qty', 0);

  if (!positions || positions.length === 0) {
    // Distinguish "no positions" from "positions unavailable"
    // A connected broker with zero positions may have holdingsUnavailable=true
    let connectedBroker: string | null = null;
    try {
      const { data: brokerConn } = await supabase
        .from('broker_connections')
        .select('connection_type')
        .eq('user_id', userId)
        .eq('status', 'connected')
        .maybeSingle();
      connectedBroker = brokerConn?.connection_type || null;
    } catch { /* ignore */ }

    if (connectedBroker) {
      console.log(`[portfolio-agent] User ${userId.slice(0, 8)} has broker ${connectedBroker} but 0 positions — skipping (may be holdingsUnavailable)`);
    } else {
      console.log(`[portfolio-agent] User ${userId.slice(0, 8)} has 0 positions (demo, genuinely empty) — skipping`);
    }
    return { triggers: 0, haikuGenerated: 0, skippedBudget: false };
  }

  // ── Fetch watchlist symbols ──
  let watchlistSymbols: string[] = [];
  try {
    const { data: watchlists } = await supabase
      .from('watchlists')
      .select('stocks')
      .eq('user_id', userId)
      .limit(5);

    const symbols = new Set<string>();
    for (const wl of (watchlists || [])) {
      const stocks = wl.stocks || [];
      for (const s of stocks) {
        if (typeof s === 'string') symbols.add(s);
        else if (s?.symbol) symbols.add(s.symbol);
      }
    }
    watchlistSymbols = [...symbols];
  } catch { /* ignore */ }

  // ── Compute account values from positions ──
  let equity = 0;
  let cash = 0;
  let totalPnl = 0;
  let dayPnl = 0;

  for (const pos of positions) {
    equity += Number(pos.market_value || 0);
    totalPnl += Number(pos.unrealized_pnl || 0);
  }

  // Try to get cash from user's account settings or use a default
  try {
    const { data: portfolioSettings } = await supabase
      .from('users')
      .select('portfolio_cash, day_pnl')
      .eq('id', userId)
      .single();
    
    if (portfolioSettings?.portfolio_cash) {
      cash = Number(portfolioSettings.portfolio_cash);
    }
    if (portfolioSettings?.day_pnl) {
      dayPnl = Number(portfolioSettings.day_pnl);
    }
  } catch { /* ignore */ }

  // Fallback: estimate cash as 20% of equity
  if (cash === 0 && equity > 0) {
    cash = Math.round(equity * 0.25); // rough estimate
  }

  const totalValue = equity + cash;
  const totalPnlPct = totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;
  const dayPnlPct = totalValue > 0 ? (dayPnl / totalValue) * 100 : 0;

  // ── Get days since last trade ──
  let daysSinceLastTrade = 999;
  try {
    const { data: lastTrade } = await supabase
      .from('orders')
      .select('filled_at')
      .eq('user_id', userId)
      .order('filled_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastTrade?.filled_at) {
      const lastDate = new Date(lastTrade.filled_at);
      daysSinceLastTrade = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    }
  } catch { /* ignore */ }

  // ── Build NoticedRuleInput ──
  const input: NoticedRuleInput = {
    account: {
      cash,
      equity,
      totalPnl,
      totalPnlPercent: Math.round(totalPnlPct * 10) / 10,
      dayPnl,
      dayPnlPercent: Math.round(dayPnlPct * 10) / 10,
    },
    positions: positions.map((p: any) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      marketValue: Number(p.market_value || 0),
      avgCost: Number(p.avg_cost || 0),
      totalPnl: Number(p.unrealized_pnl || 0),
      totalPnlPercent: Number(p.unrealized_pnl_pct || 0),
      sector: p.sector || undefined,
    })),
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

  // ── Run the pipeline ──
  const { trulyNew, haikuGenerated, budgetRemaining } = await runNoticedPipeline({
    userId,
    input,
    investorStyle,
    existingKeys,
    supabase,
    concSinglePct,
    concTop3Pct,
  });

  const skippedBudget = trulyNew.length > 0 && !haikuGenerated;
  if (skippedBudget) {
    console.log(`[portfolio-agent] User ${userId.slice(0, 8)} budget exhausted — ${trulyNew.length} triggers used fallback`);
  }

  return {
    triggers: trulyNew.length,
    haikuGenerated: haikuGenerated ? 1 : 0,
    skippedBudget,
  };
}

// ── Config: max duration for Vercel serverless ──
export const maxDuration = 55;
