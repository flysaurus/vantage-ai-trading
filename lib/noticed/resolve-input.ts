import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';
import { resolveLiveAccountCash } from '@/lib/broker/live-account-cash';
import { resolveBrokerAccountReadFilter } from '@/lib/broker/account-id';
import type { NoticedRuleInput, PortfolioPosition } from './engine';

/**
 * Normalise a raw position row (broker `positions` table snake_case OR demo
 * `demo_portfolio_state` camelCase JSON) into the engine's PortfolioPosition.
 */
export function toPortfolioPosition(p: any): PortfolioPosition {
  const qty = Number(p.qty ?? p.shares ?? 0);
  const marketValue = Number(p.marketValue ?? p.market_value ?? 0);
  const avgCost = Number(p.avgCost ?? p.avg_cost ?? 0);
  const costBasis = qty * avgCost;

  let totalPnl = Number(p.totalPnl ?? p.unrealized_pnl ?? 0);
  let totalPnlPercent = Number(p.totalPnlPercent ?? p.unrealized_pnl_pct ?? 0);
  // Broker rows often leave unrealized_pnl null (they carry live `market_value`
  // + per-share `avg_cost` only) — derive P&L so milestone triggers still fire.
  const hasStoredPnl = p.totalPnl != null || p.unrealized_pnl != null ||
    p.totalPnlPercent != null || p.unrealized_pnl_pct != null;
  if (!hasStoredPnl && marketValue > 0 && costBasis > 0) {
    totalPnl = marketValue - costBasis;
    totalPnlPercent = (totalPnl / costBasis) * 100;
  }

  return {
    symbol: p.symbol,
    qty,
    marketValue,
    avgCost,
    totalPnl,
    totalPnlPercent,
    sector: p.sector || undefined,
  };
}

/**
 * Resolve the NoticedRuleInput for a BROKER account server-side from the
 * canonical `positions` table + broker cash.
 *
 * This is the authority for live/paper broker accounts: the client must NOT be
 * able to write demo (or another account's) positions under a broker account id
 * — that was the cross-account bleed. Demo accounts are intentionally NOT
 * handled here (demo positions live in `demo_portfolio_state` with cost-basis
 * pricing, so the client remains the source of live-priced demo positions).
 *
 * Returns null when the scope is not a broker account or the account has no
 * positions (caller should then return an empty/quiet result).
 */
export async function resolveBrokerNoticedInput(
  supabase: any,
  userId: string,
  accountId: string,
  watchlistSymbols: string[] = [],
): Promise<NoticedRuleInput | null> {
  const scope = parseAccountScope(accountId);
  if (!scope || scope.isDemo || !scope.connectionId) return null;

  // Part B step 4 — the standing dual-read rule (same shape as
  // `lib/ai/account-positions.ts`):
  //   2+ registered accounts on the connection → strict `account_id` filter,
  //     never widened; 0–1 accounts → the connection-level query is unchanged;
  //     shared login with no resolvable sub-account scope → report unavailable,
  //     never merge two accounts into one card.
  const readFilter = await resolveBrokerAccountReadFilter(supabase, {
    userId,
    connectionId: scope.connectionId,
    snapAccountId: scope.snapAccountId ?? null,
  });
  if (readFilter.reason === 'shared_login_no_scope') {
    console.warn(
      '[noticed] shared login without a sub-account scope — not merging holdings',
    );
    return null; // caller returns a quiet/empty result — never a merged card
  }

  let positionsQuery = supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .neq('qty', 0);
  positionsQuery = applyAccountScopeFilter(positionsQuery, scope);
  if (readFilter.filterAccountId) {
    positionsQuery = positionsQuery.eq('account_id', readFilter.filterAccountId);
  }
  const { data: positions } = await positionsQuery;
  if (!positions || positions.length === 0) return null;

  const mapped = (positions as any[]).map(toPortfolioPosition);

  let equity = 0;
  let totalPnl = 0;
  for (const p of mapped) {
    equity += p.marketValue;
    totalPnl += p.totalPnl;
  }

  // Broker cash for THIS account. Reported ONLY when the broker actually
  // provides a value; a missing/null cash is reported as UNKNOWN — never
  // estimated. On a shared login only the scoped sub-account's cash may be
  // used (summing the siblings' cash is the same merge bug on the cash axis).
  //
  // ⚠️ Removed 2026-09-16 (Em): the old `cash === 0 → 25% × equity` fallback
  // GUESSED a number and presented it as real cash. It fired because Fidelity
  // sub-accounts return `cash: null`. Same failure class as every other leak
  // this migration closed — except it failed UNSAFE (real-looking wrong number)
  // instead of safely ("unknown"). Do not reintroduce it.
  // ⚠️ Source changed 2026-09-16: `broker_connections.snaptrade_accounts` is a
  // CONNECT-TIME snapshot (written once in app/api/connections/callback) and it
  // was never refreshed — it fed Alpaca's July cash ($100,865.95) to this
  // pipeline as "today" while the account held $468.81. A stale number rendered
  // as current fails the same way a guessed one does, so cash now comes from
  // the live balances endpoint and is otherwise UNKNOWN (never merged, never
  // estimated). See lib/broker/live-account-cash.ts.
  const cash = await resolveLiveAccountCash(userId, scope.connectionId, scope.snapAccountId ?? null);
  if (cash == null) {
    console.warn(`[noticed] cash unavailable for ${accountId} — reporting unknown (not estimated)`);
  }

  let dayPnl = 0;
  try {
    const { data: ps } = await supabase
      .from('users')
      .select('day_pnl')
      .eq('id', userId)
      .single();
    if (ps?.day_pnl) dayPnl = Number(ps.day_pnl);
  } catch { /* ignore */ }

  // Any percentage that divides by the total value is UNKNOWN when cash is
  // unknown — a percentage built on a guessed denominator is the same
  // fabrication one step removed.
  const totalValue = cash == null ? null : equity + cash;
  const totalPnlPct = totalValue != null && totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : null;
  const dayPnlPct = totalValue != null && totalValue > 0 ? (dayPnl / totalValue) * 100 : null;

  // Days since last trade, scoped to this account (orders.filled_at).
  // A shared login narrows to the sub-account too; `orders.account_id` is not
  // stamped yet (cron gap recorded in docs/part-b-account-model-migration.md),
  // so on that path the honest answer is the 999 sentinel = "unknown" rather
  // than the sibling's trade date.
  let daysSinceLastTrade = 999;
  try {
    let lastTradeQuery = supabase.from('orders').select('filled_at').eq('user_id', userId);
    lastTradeQuery = applyAccountScopeFilter(lastTradeQuery, scope);
    if (readFilter.filterAccountId) {
      lastTradeQuery = lastTradeQuery.eq('account_id', readFilter.filterAccountId);
    }
    const { data: lastTrade } = await lastTradeQuery
      .order('filled_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastTrade?.filled_at) {
      daysSinceLastTrade = Math.floor((Date.now() - new Date(lastTrade.filled_at).getTime()) / 86400000);
    }
  } catch { /* ignore */ }

  return {
    account: {
      cash,
      equity,
      totalPnl,
      totalPnlPercent: totalPnlPct == null ? null : Math.round(totalPnlPct * 10) / 10,
      dayPnl,
      dayPnlPercent: dayPnlPct == null ? null : Math.round(dayPnlPct * 10) / 10,
    },
    positions: mapped,
    watchlistSymbols,
    daysSinceLastTrade,
  };
}
