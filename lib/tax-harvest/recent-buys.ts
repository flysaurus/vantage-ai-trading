// ─── lib/tax-harvest/recent-buys.ts ──────────────────────────
//
// Pure shaping for GET /api/strategies/tax-harvest/wash-sale-check.
//
// The endpoint answers one question for the TLH planner: "does a BUY of this
// ticker already sit inside the 30-day repurchase window, so harvesting this
// loss would be disallowed?"
//
// The wash-sale rule is TAXPAYER-WIDE, so that answer must not be narrowed to
// the harvesting account — a repurchase in a different connected account
// disallows the loss just the same. The window therefore comes from
// `fetchRepurchaseFills` + `mergeRepurchaseFills` (lib/wash-sale.ts), the same
// single implementation the Sell-ticket advisory uses; nothing is re-implemented
// here. `scopedConnectionId` only ever *labels* the answer (did the newest buy
// come from another connection?), it never narrows it.
//
// Kept pure so the two required acceptance cases (cross-connection catch,
// overlapping rows counted once) test real code rather than a copy of it.

import {
  WASH_SALE_WINDOW_DAYS,
  findRecentBuys,
  mergeRepurchaseFills,
  type OrderLike,
  type TradeHistoryLike,
} from '@/lib/wash-sale';

export interface WashSaleCheckPayload {
  symbol: string;
  /** true ⇒ nothing in the repurchase window ⇒ harvesting is not blocked. */
  isSafe: boolean;
  /** false ⇒ we hold no fills at all for this account, so the check can't run. */
  historyAvailable: boolean;
  daysSinceLastTrade: number | null;
  lastTradeDate: string | null;
  /** Number of de-duplicated qualifying buys in the window. */
  recentBuys: number;
  /** Echo of whether a caller-supplied scope was in play (compat field). */
  accountScoped: boolean;
  /** true ⇒ the newest qualifying buy is in a DIFFERENT connected account. */
  crossConnection: boolean;
  /** broker_connections.id of the newest qualifying buy (null = unknown/demo). */
  buyConnectionId: string | null;
}

export function buildWashSaleCheck(input: {
  symbol: string;
  orders: OrderLike[];
  history: TradeHistoryLike[];
  gapConnectionIds: string[];
  /** broker_connections.id the caller is harvesting from (null = demo/legacy). */
  scopedConnectionId: string | null;
  isDemo: boolean;
  /** All-rows coverage counts (null = the coverage query failed). */
  ordersCoverage: number | null;
  historyCoverage: number | null;
  now?: Date;
}): WashSaleCheckPayload {
  const now = input.now ?? new Date();
  const ticker = String(input.symbol || '').toUpperCase();

  const merged = mergeRepurchaseFills({
    orders: input.orders,
    history: input.history,
    gapConnectionIds: input.gapConnectionIds,
  });
  const buys = findRecentBuys(merged, ticker, WASH_SALE_WINDOW_DAYS, now);
  const newest = buys[0] ?? null;

  // Coverage: "can we see this account at all?" — a fill in EITHER table means
  // yes. Both counts null means the count query failed → assume yes, so the
  // legacy "Clear" answer is unchanged for callers we cannot check.
  const historyAvailable =
    input.ordersCoverage === null && input.historyCoverage === null
      ? true
      : (input.ordersCoverage ?? 0) + (input.historyCoverage ?? 0) > 0;

  const daysSinceLastTrade = newest
    ? Math.floor((now.getTime() - new Date(newest.filledAt).getTime()) / 86_400_000)
    : null;

  const buyConnectionId = newest?.connectionId ?? null;

  return {
    symbol: ticker,
    isSafe: buys.length === 0,
    historyAvailable,
    daysSinceLastTrade,
    lastTradeDate: newest?.filledAt ?? null,
    recentBuys: buys.length,
    accountScoped: Boolean(input.scopedConnectionId) || input.isDemo,
    crossConnection: Boolean(
      input.scopedConnectionId && buyConnectionId && buyConnectionId !== input.scopedConnectionId,
    ),
    buyConnectionId,
  };
}
