/**
 * POST /api/cron/portfolio-agent
 *
 * QStash-scheduled endpoint that runs the Noticed rules engine across ALL
 * active users and generates Haiku observations for new triggers.
 *
 * Account-scoped: each user's portfolio is analysed PER ACCOUNT ('demo' +
 * each connected SnapTrade broker) so triggers fire on the real per-account
 * book, never a blended user-level merge. A shared login (2+ registered
 * sub-accounts) is enumerated as its sub-accounts — see Part B step 4.
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
import type { NoticedRuleInput } from '@/lib/noticed/engine';
import { runNoticedPipeline } from '@/lib/noticed/engine';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';
import { resolveBrokerAccountReadFilter } from '@/lib/broker/account-id';
import { resolveLiveAccountCash } from '@/lib/broker/live-account-cash';
import { resolveBrokerNoticedInput, toPortfolioPosition } from '@/lib/noticed/resolve-input';

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

// ── Per-user processing (loops over the user's accounts) ──
async function processUser(
  userId: string,
  supabase: any,
): Promise<{ triggers: number; haikuGenerated: number; skippedBudget: boolean }> {
  // ── User-level fetches (shared across the user's accounts) ──
  let investorStyle: string | null = null;
  let concSinglePct: number | null = null;
  let concTop3Pct: number | null = null;
  let targetReturnPct: number | null = null;
  let targetLossPct: number | null = null;
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('investor_style, conc_single_pct, conc_top3_pct, target_return_pct, target_loss_pct')
      .eq('id', userId)
      .single();
    investorStyle = userRow?.investor_style || null;
    concSinglePct = userRow?.conc_single_pct ?? null;
    concTop3Pct = userRow?.conc_top3_pct ?? null;
    targetReturnPct = userRow?.target_return_pct ?? null;
    targetLossPct = userRow?.target_loss_pct ?? null;
  } catch { /* ignore */ }

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

  // ── Enumerate accounts: demo + each connected SnapTrade broker ──
  const accountIds: string[] = ['demo'];
  try {
    const { data: connections } = await supabase
      .from('broker_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected');
    for (const conn of (connections || [])) {
      if (!conn.id) continue;
      // Part B step 4 — a shared login must be enumerated as its registered
      // sub-accounts, never as one blended connection-level account. The
      // registry (broker_accounts) is the same source the read/write resolvers
      // use, so this is enumeration, not inference. No rows → the connection has
      // a single account → keep the legacy 2-part id.
      let subAccounts: any[] = [];
      try {
        const { data } = await supabase
          .from('broker_accounts')
          .select('snaptrade_account_id')
          .eq('connection_id', conn.id);
        subAccounts = Array.isArray(data) ? data : [];
      } catch { /* fall through to the connection-level id */ }

      if (subAccounts.length > 0) {
        for (const a of subAccounts) {
          if (a?.snaptrade_account_id) {
            accountIds.push(`snaptrade:${conn.id}:${a.snaptrade_account_id}`);
          }
        }
      } else {
        accountIds.push(`snaptrade:${conn.id}`);
      }
    }
  } catch { /* ignore */ }

  let totalTriggers = 0;
  let totalHaiku = 0;
  let anySkippedBudget = false;

  for (const accountId of accountIds) {
    try {
      const result = await processAccount(userId, accountId, supabase, {
        investorStyle,
        concSinglePct,
        concTop3Pct,
        targetReturnPct,
        targetLossPct,
        watchlistSymbols,
      });
      totalTriggers += result.triggers;
      totalHaiku += result.haikuGenerated;
      if (result.skippedBudget) anySkippedBudget = true;
    } catch (err: any) {
      console.error(`[portfolio-agent] Error processing account ${accountId.slice(0, 12)}:`, err.message);
    }
  }

  return {
    triggers: totalTriggers,
    haikuGenerated: totalHaiku,
    skippedBudget: anySkippedBudget,
  };
}

// ── Per-account processing ──
async function processAccount(
  userId: string,
  accountId: string,
  supabase: any,
  ctx: {
    investorStyle: string | null;
    concSinglePct: number | null;
    concTop3Pct: number | null;
    targetReturnPct: number | null;
    targetLossPct: number | null;
    watchlistSymbols: string[];
  },
): Promise<{ triggers: number; haikuGenerated: number; skippedBudget: boolean }> {
  const scope = parseAccountScope(accountId);

  // Part B step 4 — standing dual-read rule (same shape as
  // `lib/ai/account-positions.ts`): 2+ registered accounts → strict
  // `account_id` filter, never widened; 0–1 accounts → unchanged
  // connection-level query; shared login with no resolvable sub-account scope →
  // report unavailable (skip) rather than blend two accounts into one trigger.
  const readFilter = await resolveBrokerAccountReadFilter(supabase, {
    userId,
    connectionId: scope?.connectionId ?? null,
    snapAccountId: scope?.snapAccountId ?? null,
  });
  if (readFilter.reason === 'shared_login_no_scope') {
    console.warn(
      `[portfolio-agent] shared login ${String(accountId).slice(0, 12)} without a sub-account scope — skipping (not merging)`,
    );
    return { triggers: 0, haikuGenerated: 0, skippedBudget: false };
  }

  // ── BROKER scopes: delegate to the SAME resolver the API route uses ──────
  //
  // 2026-09-18 (Em): this function used to re-implement the position mapping
  // locally, coercing a stored NULL P&L to zero ("no signal", not "no data").
  // Broker `positions` rows
  // store NO P&L (live-verified: 349/349 null on Fidelity Taxable SMA), so that
  // coercion fed `totalPnlPercent: 0` for every position → no milestone band
  // could ever cross → the stale-resolve pass resolved EVERY milestone card on
  // every cron pass (every 30 min in market hours), while the API path — which
  // derives P&L — re-created them on the next page load. That was the
  // resolved↔active flip: two mappers disagreeing, not unstable data.
  //
  // One mapper, imported. Never re-implemented.
  if (scope && !scope.isDemo && scope.connectionId) {
    const brokerInput = await resolveBrokerNoticedInput(
      supabase,
      userId,
      accountId,
      ctx.watchlistSymbols,
    );
    if (!brokerInput) {
      // Covers a shared login with no resolvable sub-account scope (never
      // merge), an unresolvable registry lookup, and an account with no
      // holdings — all of them "skip", none of them "blend".
      console.log(
        `[portfolio-agent] Account ${accountId.slice(0, 12)} — no resolvable scope or no holdings — skipping (never merging)`,
      );
      return { triggers: 0, haikuGenerated: 0, skippedBudget: false };
    }
    return runPipelineForInput(brokerInput);
  }

  // ── DEMO / non-broker scope: original local assembly below ──
  // ── Fetch positions scoped to this account ──
  let positionsQuery = supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .neq('qty', 0);
  if (scope) positionsQuery = applyAccountScopeFilter(positionsQuery, scope);
  if (readFilter.filterAccountId) {
    positionsQuery = positionsQuery.eq('account_id', readFilter.filterAccountId);
  }
  const { data: positions } = await positionsQuery;

  if (!positions || positions.length === 0) {
    console.log(`[portfolio-agent] Account ${accountId.slice(0, 12)} has 0 positions — skipping`);
    return { triggers: 0, haikuGenerated: 0, skippedBudget: false };
  }

  // ── Compute account values from positions ──
  // Same shared mapper as the broker path above — the demo branch must not
  // carry a second P&L rule either.
  const mappedPositions = (positions as any[]).map(toPortfolioPosition);
  let equity = 0;
  let totalPnl = 0;
  for (const pos of mappedPositions) {
    equity += pos.marketValue;
    totalPnl += pos.totalPnl;
  }

  // ── Cash: demo → demo_portfolio_state.cash_balance; broker → snap account cash ──
  // Reported ONLY when the broker actually provides a value; missing/null →
  // UNKNOWN, never estimated (see the removed 25%-of-equity guess below).
  let cash: number | null = null;
  try {
    if (scope?.isDemo) {
      const { data: demoState } = await supabase
        .from('demo_portfolio_state')
        .select('cash_balance')
        .eq('user_id', userId)
        .maybeSingle();
      if (demoState?.cash_balance != null) cash = Number(demoState.cash_balance);
    } else if (scope?.connectionId) {
      // Live balances, not the connect-time `snaptrade_accounts` snapshot — the
      // snapshot was months stale (it still held Alpaca's July cash). Unknown
      // when it cannot be established; never merged across sub-accounts.
      // See lib/broker/live-account-cash.ts.
      cash = await resolveLiveAccountCash(userId, scope.connectionId, scope.snapAccountId ?? null);
    }
  } catch { /* unknown */ }
  if (cash == null) {
    console.warn(`[portfolio-agent] cash unavailable for ${accountId} — reporting unknown (not estimated)`);
  }

  let dayPnl = 0;
  try {
    const { data: portfolioSettings } = await supabase
      .from('users')
      .select('day_pnl')
      .eq('id', userId)
      .single();
    if (portfolioSettings?.day_pnl) dayPnl = Number(portfolioSettings.day_pnl);
  } catch { /* ignore */ }

  // ⚠️ Removed 2026-09-16 (Em): the old `cash === 0 → 25% × equity` estimate lived
  // here and in `lib/noticed/resolve-input.ts`. It GUESSED cash and presented it as
  // real, corrupting every percentage derived from it. Unknown beats a wrong number.
  // Do not reintroduce it.

  // Any percentage dividing by the total value is UNKNOWN when cash is unknown.
  const totalValue = cash == null ? null : equity + cash;
  const totalPnlPct = totalValue != null && totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : null;
  const dayPnlPct = totalValue != null && totalValue > 0 ? (dayPnl / totalValue) * 100 : null;

  // ── Days since last trade (scoped to account) ──
  let daysSinceLastTrade = 999;
  try {
    let lastTradeQuery = supabase
      .from('orders')
      .select('filled_at')
      .eq('user_id', userId);
    if (scope) lastTradeQuery = applyAccountScopeFilter(lastTradeQuery, scope);
    if (readFilter.filterAccountId) {
      lastTradeQuery = lastTradeQuery.eq('account_id', readFilter.filterAccountId);
    }
    const { data: lastTrade } = await lastTradeQuery
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
      totalPnlPercent: totalPnlPct == null ? null : Math.round(totalPnlPct * 10) / 10,
      dayPnl,
      dayPnlPercent: dayPnlPct == null ? null : Math.round(dayPnlPct * 10) / 10,
    },
    positions: mappedPositions,
    watchlistSymbols: ctx.watchlistSymbols,
    daysSinceLastTrade,
  };

  // ── Run the pipeline for the assembled input ──
  //
  // Shared by the broker delegation above and the demo assembly below so the
  // two can never diverge again. Declared as a (hoisted) function declaration
  // so the broker path can call it before this point in the body.
  async function runPipelineForInput(
    input: NoticedRuleInput,
  ): Promise<{ triggers: number; haikuGenerated: number; skippedBudget: boolean }> {
    // ── Get existing trigger keys (scoped to account) ──
    const { data: existing } = await supabase
      .from('noticed_items')
      .select('trigger_key')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .eq('resolved', false);

    const existingKeys = new Set<string>((existing || []).map((e: any) => e.trigger_key));

    const { trulyNew, haikuGenerated } = await runNoticedPipeline({
      userId,
      accountId,
      input,
      investorStyle: ctx.investorStyle,
      existingKeys,
      supabase,
      concSinglePct: ctx.concSinglePct,
      concTop3Pct: ctx.concTop3Pct,
      targetReturnPct: ctx.targetReturnPct,
      targetLossPct: ctx.targetLossPct,
    });

    const skippedBudget = trulyNew.length > 0 && !haikuGenerated;
    if (skippedBudget) {
      console.log(`[portfolio-agent] Account ${accountId.slice(0, 12)} budget exhausted — ${trulyNew.length} triggers used fallback`);
    }

    return {
      triggers: trulyNew.length,
      haikuGenerated: haikuGenerated ? 1 : 0,
      skippedBudget,
    };
  }

  return runPipelineForInput(input);
}

// ── Config: max duration for Vercel serverless ──
export const maxDuration = 55;
