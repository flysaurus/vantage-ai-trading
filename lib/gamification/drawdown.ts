// ─── Drawdown Tracking & Weathered a Storm Detection ─────────
//
// State machine for peak/trough/drawdown tracking on investor_scores.
// Called from two triggers:
//   A. Trade execution  — real-time (increment-trades route)
//   B. Daily cron        — catches pure-hold case (/api/cron/drawdown-check)
//
// ── State Machine ───────────────────────────────────────────
//
//   IDLE (drawdown_start = NULL)
//     → if equity < peak × 0.90: BEGIN DRAWDOWN
//
//   IN DRAWDOWN (drawdown_start IS NOT NULL)
//     → trough = MIN(trough, currentEquity)
//     → if equity ≥ peak × 0.95: RECOVER → check milestone → RESET
//
//   NEW PEAK (currentEquity > peak_equity)
//     → peak = currentEquity, trough = NULL, drawdown_start = NULL
//
// ── Milestone: Weathered a Storm ────────────────────────────
//
// Awarded when: user recovers from a ≥10% drawdown without net-selling
// during the episode (peak → recovery). "Net sell" = SUM(exit_value) >
// SUM(entry_value). Rebalance sells (net equity constant or increasing)
// are excluded by the net-sell check.
//
// Once evaluated (award or not), episode resets regardless of outcome.
// A new drawdown from a future peak starts a fresh episode.

import { createServerClient } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────

export interface DrawdownState {
  peakEquity: number;
  troughEquity: number | null;
  drawdownStart: string | null;
  isInDrawdown: boolean;
  drawdownPct: number | null; // how far below peak, as negative percentage
}

export interface DrawdownResult {
  state: DrawdownState;
  milestoneAwarded: boolean;
  milestoneAlreadyHad: boolean;
  recovered: boolean;
  panicSold: boolean;
}

// ─── Thresholds ───────────────────────────────────────────────

const DRAWDOWN_ENTRY_PCT = 0.90; // 10% below peak triggers drawdown episode
const RECOVERY_PCT = 0.95;       // back to 95% of peak = recovered

// ─── Public API ───────────────────────────────────────────────

/**
 * Update peak/trough/drawdown tracking for a single user.
 *
 * Read-modify-write cycle on investor_scores. If recovery is detected,
 * checks trade_history for panic sells and awards the weathered_storm
 * milestone if clean.
 *
 * @param currentEquity - current portfolio total equity (from broker or demo)
 * @returns result with state + award outcome
 */
export async function updateDrawdownTracking(
  anonymousId: string,
  currentEquity: number,
  supabase?: any
): Promise<DrawdownResult> {
  const db = supabase || createServerClient();
  const milestoneAlreadyHad = false;

  if (!anonymousId || currentEquity == null || currentEquity <= 0) {
    return nullResult();
  }

  // ── 1. Read current state ──────────────────────────────────
  const { data: row, error: readErr } = await (db as any)
    .from('investor_scores')
    .select('peak_equity, trough_equity, drawdown_start, milestones_earned')
    .eq('anonymous_id', anonymousId)
    .maybeSingle();

  if (readErr || !row) {
    // No scores row — can't track drawdowns without trading history
    return nullResult();
  }

  let peakEquity = row.peak_equity ? Number(row.peak_equity) : 0;
  let troughEquity = row.trough_equity ? Number(row.trough_equity) : null;
  let drawdownStart = row.drawdown_start || null;

  // Check if milestone already awarded (separate milestones table)
  const { data: existingWs } = await (db as any)
    .from('milestones')
    .select('id')
    .eq('anonymous_id', anonymousId)
    .eq('milestone_key', 'weathered_storm')
    .maybeSingle();

  const alreadyHasMilestone = !!existingWs;

  // ── 2. New peak? ───────────────────────────────────────────
  if (currentEquity > peakEquity) {
    peakEquity = currentEquity;
    troughEquity = null;
    drawdownStart = null;
  }

  // ── 3. Enter drawdown? ─────────────────────────────────────
  const isInDrawdown = drawdownStart !== null;
  const thresholdEquity = peakEquity * DRAWDOWN_ENTRY_PCT;

  if (!isInDrawdown && currentEquity < thresholdEquity) {
    // Episode begins
    drawdownStart = new Date().toISOString();
    troughEquity = currentEquity;
  }

  // ── 4. Update trough (if in drawdown) ──────────────────────
  if (isInDrawdown || drawdownStart !== null) {
    if (troughEquity === null || currentEquity < troughEquity) {
      troughEquity = currentEquity;
    }
  }

  // ── 5. Check for recovery ──────────────────────────────────
  let milestoneAwarded = false;
  let panicSold = false;
  let recovered = false;

  if (drawdownStart !== null && currentEquity >= peakEquity * RECOVERY_PCT) {
    recovered = true;

    // Check for panic sells during the episode (peak → now)
    if (!alreadyHasMilestone) {
      panicSold = await detectPanicSells(db, anonymousId, drawdownStart);
      if (!panicSold) {
        // Award the milestone (milestones are a separate table, not a column)
        const { error: awardErr, count } = await (db as any)
          .from('milestones')
          .upsert(
            {
              anonymous_id: anonymousId,
              milestone_key: 'weathered_storm',
              milestone_label: 'Weathered a Storm',
              awarded_at: new Date().toISOString(),
            },
            { onConflict: 'anonymous_id,milestone_key', ignoreDuplicates: true },
          );

        if (!awardErr && count !== 0) {
          milestoneAwarded = true;
          // Increment the score counter
          await (db as any)
            .from('investor_scores')
            .update({
              milestones_earned: (row.milestones_earned || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('anonymous_id', anonymousId);

          console.log(
            `[drawdown] 🏆 Weathered a Storm awarded to ${anonymousId.slice(0, 8)}... ` +
            `(peak: ${peakEquity.toFixed(0)}, trough: ${troughEquity?.toFixed(0)}, recovered at: ${currentEquity.toFixed(0)})`
          );
        }
      } else {
        console.log(
          `[drawdown] ❌ ${anonymousId.slice(0, 8)}... recovered from drawdown but net-sold during episode — milestone NOT awarded`
        );
      }
    }

    // Reset episode regardless of outcome
    troughEquity = null;
    drawdownStart = null;
  }

  // ── 6. Write back ──────────────────────────────────────────
  const updatePayload: Record<string, any> = {
    peak_equity: peakEquity,
    trough_equity: troughEquity,
    drawdown_start: drawdownStart,
    updated_at: new Date().toISOString(),
  };

  const { error: writeErr } = await (db as any)
    .from('investor_scores')
    .update(updatePayload)
    .eq('anonymous_id', anonymousId);

  if (writeErr) {
    // Handle missing columns gracefully (retry logic)
    if (/column/i.test(writeErr.message) || /does not exist/i.test(writeErr.message)) {
      console.warn('[drawdown] Column missing, retrying with stripped payload:', writeErr.message);
      const safePayload = stripUnknownColumns(updatePayload, writeErr.message);
      if (Object.keys(safePayload).length > 0) {
        await (db as any)
          .from('investor_scores')
          .update(safePayload)
          .eq('anonymous_id', anonymousId);
      }
    } else {
      console.error(`[drawdown] Write error for ${anonymousId.slice(0, 8)}...:`, writeErr.message);
    }
  }

  const drawdownPct = peakEquity > 0
    ? ((currentEquity - peakEquity) / peakEquity) * 100
    : 0;

  return {
    state: {
      peakEquity,
      troughEquity,
      drawdownStart: drawdownStart || null,
      isInDrawdown: drawdownStart !== null,
      drawdownPct: parseFloat(drawdownPct.toFixed(2)),
    },
    milestoneAwarded,
    milestoneAlreadyHad: alreadyHasMilestone,
    recovered,
    panicSold,
  };
}

/**
 * Run drawdown tracking for all active users.
 * Called by the daily cron (/api/cron/drawdown-check).
 * Handles per-user failures gracefully — one failure doesn't kill the batch.
 *
 * @returns summary with success/failure counts
 */
export async function runDailyDrawdownCheck(
  supabase: any
): Promise<{ processed: number; succeeded: number; failed: number; awards: number }> {
  const summary = { processed: 0, succeeded: 0, failed: 0, awards: 0 };

  // Fetch all active investor_scores that have ever traded
  const { data: rows, error } = await (supabase as any)
    .from('investor_scores')
    .select('anonymous_id, user_id')
    .gt('trades_executed', 0);

  if (error || !rows || rows.length === 0) {
    console.log('[drawdown/cron] No active trading accounts found');
    return summary;
  }

  console.log(`[drawdown/cron] Processing ${rows.length} accounts...`);

  for (const row of rows) {
    summary.processed++;
    try {
      const equity = await resolvePortfolioEquity(
        supabase,
        row.anonymous_id,
        row.user_id
      );

      if (equity == null || equity <= 0) {
        console.warn(
          `[drawdown/cron] ${row.anonymous_id.slice(0, 8)}... — could not resolve equity, skipping`
        );
        summary.failed++;
        continue;
      }

      const result = await updateDrawdownTracking(row.anonymous_id, equity, supabase);
      summary.succeeded++;
      if (result.milestoneAwarded) summary.awards++;
    } catch (err: any) {
      console.error(
        `[drawdown/cron] Failed for ${row.anonymous_id?.slice(0, 8)}...:`,
        err.message
      );
      summary.failed++;
    }
  }

  console.log(
    `[drawdown/cron] Done — ${summary.processed} processed, ` +
    `${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.awards} awards`
  );

  return summary;
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Resolve current portfolio equity for a user.
 * Broker-connected → try Alpaca. Demo → compute from style.
 * Returns null if equity cannot be determined.
 */
async function resolvePortfolioEquity(
  supabase: any,
  anonymousId: string,
  userId: string | null
): Promise<number | null> {
  // ── Try broker-connected path ──
  if (userId) {
    try {
      const { data: profile } = await (supabase as any)
        .from('users')
        .select('broker_connected, investor_style')
        .eq('id', userId)
        .maybeSingle();

      if (profile?.broker_connected) {
        // Try Alpaca account API via internal fetch
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const accountRes = await fetch(`${appUrl}/api/broker/session`, {
          headers: {
            // Pass the user context via a custom header that the broker route understands
            'x-user-id': userId,
            'x-cron-secret': process.env.CRON_SECRET || '',
          },
        });

        if (accountRes.ok) {
          const data = await accountRes.json();
          if (data?.equity && data.equity > 0) {
            return Number(data.equity);
          }
        }
      }

      // Fall back to demo with profile's style
      if (profile?.investor_style) {
        return resolveDemoEquity(profile.investor_style);
      }
    } catch (err: any) {
      console.warn(`[drawdown] Broker fetch failed for user ${userId.slice(0, 8)}...:`, err.message);
    }
  }

  // ── Try anonymous profile path ──
  const { data: anonProfile } = await (supabase as any)
    .from('anonymous_profiles')
    .select('investor_style')
    .eq('anonymous_id', anonymousId)
    .maybeSingle();

  if (anonProfile?.investor_style) {
    return resolveDemoEquity(anonProfile.investor_style);
  }

  return null;
}

// ─── Demo equity computation ──────────────────────────────────
// Replicates the portfolio/summary endpoint's demo equity logic
// but optimized for batch use (caller should cache quotes).

let _cachedDemoEquities: Map<string, number> | null = null;

async function resolveDemoEquity(investorStyle: string): Promise<number | null> {
  // Lazy-load demo data to avoid heavy imports in non-cron contexts
  try {
    const { getDemoAccount, getDemoSymbols } = await import('@/lib/demo-data');
    const { getBatchQuotes } = await import('@/lib/market-data');

    // Use cached prices if available (set by runDailyDrawdownCheck)
    if (_cachedDemoEquities) {
      const cached = _cachedDemoEquities.get(investorStyle);
      if (cached !== undefined) return cached;
    }

    const symbols = getDemoSymbols(investorStyle as any);
    const quotes = await getBatchQuotes(symbols);

    const livePrices: Record<string, any> = {};
    quotes.forEach((quote: any, symbol: string) => {
      livePrices[symbol] = {
        price: quote.price,
        change: quote.change ?? 0,
        changePercent: quote.changePercent ?? 0,
        previousClose: quote.previousClose ?? quote.price,
      };
    });

    const account = getDemoAccount(investorStyle as any, livePrices);
    return account?.equity || null;
  } catch (err: any) {
    console.warn(`[drawdown] Demo equity failed for style ${investorStyle}:`, err.message);
    return null;
  }
}

/**
 * Set batch-cached demo equity values (called by cron before iteration).
 */
export async function prefetchDemoEquities(styles: string[]): Promise<void> {
  try {
    const { getDemoAccount, getDemoSymbols } = await import('@/lib/demo-data');
    const { getBatchQuotes } = await import('@/lib/market-data');

    // Collect all unique symbols across all styles
    const allSymbols = new Set<string>();
    for (const style of styles) {
      try {
        getDemoSymbols(style as any).forEach((s: string) => allSymbols.add(s));
      } catch { /* skip unknown styles */ }
    }

    // Batch fetch all quotes once
    const quotes = await getBatchQuotes([...allSymbols]);
    const livePrices: Record<string, any> = {};
    quotes.forEach((quote: any, symbol: string) => {
      livePrices[symbol] = {
        price: quote.price,
        change: quote.change ?? 0,
        changePercent: quote.changePercent ?? 0,
        previousClose: quote.previousClose ?? quote.price,
      };
    });

    // Compute equity for each style
    _cachedDemoEquities = new Map();
    for (const style of styles) {
      try {
        const account = getDemoAccount(style as any, livePrices);
        if (account?.equity) {
          _cachedDemoEquities.set(style, account.equity);
        }
      } catch { /* skip */ }
    }
  } catch (err: any) {
    console.warn('[drawdown] Prefetch demo equities failed:', err.message);
    _cachedDemoEquities = null;
  }
}

// ─── Panic Sell Detection ────────────────────────────────────

/**
 * Check if the user net-sold during the drawdown episode.
 * "Net sell" = SUM(sell total_value) > SUM(buy total_value) in the window.
 *
 * Window: drawdown_start → now (or recovery time).
 * Net buys or holding steady does NOT disqualify.
 */
async function detectPanicSells(
  supabase: any,
  anonymousId: string,
  drawdownStart: string
): Promise<boolean> {
  try {
    // We need user_id to query trade_history
    const { data: scores } = await (supabase as any)
      .from('investor_scores')
      .select('user_id')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    const userId = scores?.user_id;
    if (!userId) {
      // No user_id — can't check trade_history. Assume no panic sells
      // (anonymous users are always demo; this is a reasonable default)
      return false;
    }

    const { data: trades, error } = await (supabase as any)
      .from('trade_history')
      .select('action, quantity, price')
      .eq('user_id', userId)
      .gte('executed_at', drawdownStart)
      .order('executed_at', { ascending: true });

    if (error || !trades || trades.length === 0) {
      // No trades during episode — clean
      return false;
    }

    let totalBuys = 0;
    let totalSells = 0;

    for (const trade of trades) {
      const qty = Number(trade.quantity) || 0;
      const price = Number(trade.price) || 0;
      const value = qty * price;
      if (trade.action === 'buy') {
        totalBuys += value;
      } else if (trade.action === 'sell') {
        totalSells += value;
      }
      // Other actions (dividends, splits, etc.) ignored
    }

    // Net sell = sold more than bought
    return totalSells > totalBuys;
  } catch (err: any) {
    console.warn(`[drawdown] Panic sell check failed for ${anonymousId.slice(0, 8)}...:`, err.message);
    // On error, be conservative — don't disqualify
    return false;
  }
}

// ─── Column stripping (same pattern as computeAndWriteScore) ──

function stripUnknownColumns(
  payload: Record<string, any>,
  errorMessage: string
): Record<string, any> {
  const colMatch = errorMessage.match(/column\s+"?(\w+)"?\s/i);
  if (!colMatch) return { updated_at: payload.updated_at };

  const badCol = colMatch[1].toLowerCase();
  const safe: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.toLowerCase() !== badCol) {
      safe[key] = value;
    }
  }
  return safe;
}

// ─── Fallback ─────────────────────────────────────────────────

function nullResult(): DrawdownResult {
  return {
    state: {
      peakEquity: 0,
      troughEquity: null,
      drawdownStart: null,
      isInDrawdown: false,
      drawdownPct: null,
    },
    milestoneAwarded: false,
    milestoneAlreadyHad: false,
    recovered: false,
    panicSold: false,
  };
}
