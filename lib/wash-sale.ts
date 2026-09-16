// ═══════════════════════════════════════════════════════════════
// lib/wash-sale.ts — Deterministic wash-sale pre-trade advisory
// ═══════════════════════════════════════════════════════════════
//
// Runs at the point of SELLING (inside the existing Sell TradeTicket),
// same category of check as Trade-Gate: deterministic, pre-execution,
// and NEVER blocking — the IRS disallows the tax loss; it does not make
// the trade illegal. Advisory copy only.
//
// Scope (v1): SAME-TICKER matches only. We deliberately do NOT detect
// "substantially identical securities" across similar ETFs (VOO vs IVV) —
// that determination is discretionary and out of scope, and the warning
// copy states this limitation explicitly.
//
// Reuses the existing FIFO lot ledger (position_lots + consumeLotsFIFO
// from lib/fifo-engine.ts) — cost basis is NOT recomputed separately.
//
// No forward-looking (future repurchase) check: a future repurchase is
// undetectable at sell time by definition, so we skip it rather than
// adding a generic disclaimer.

import type { SupabaseClient } from '@supabase/supabase-js';
import { consumeLotsFIFO, type Lot } from '@/lib/fifo-engine';

export const WASH_SALE_WINDOW_DAYS = 30;

export interface WashSaleRecentBuy {
  /** ISO timestamp of the qualifying buy (filled_at, falls back to created_at). */
  filledAt: string;
  qty: number;
  price: number;
  /** broker_connections.id the fill came from (null for legacy/demo rows). */
  connectionId?: string | null;
}

export interface WashSaleResult {
  /** True → show the advisory banner. */
  isWashSale: boolean;
  /** True → sale price is below the FIFO cost basis of the lots that would be consumed. */
  isLoss: boolean;
  /** Weighted FIFO cost basis of the consumed lots (0 when no lots tracked). */
  fifoCostBasis: number;
  /** Shares matched to tracked lots (0 when no lots tracked). */
  matchedQty: number;
  /** Whether the lot ledger had any remaining lots for this ticker. */
  hasLots: boolean;
  /** Most recent qualifying BUY within the window (null if none). */
  recentBuy: WashSaleRecentBuy | null;
  /**
   * EVERY qualifying BUY within the window, de-duplicated across sources,
   * newest-first. `recentBuy` is `recentBuys[0]`. Exposed so callers (and tests)
   * can assert the window was counted once, not once per source.
   */
  recentBuys: WashSaleRecentBuy[];
  /** Total shares across `recentBuys` (de-duplicated). */
  recentBuyQty: number;
}

/** Minimal order row shape — matches public.orders columns we read. */
export interface OrderLike {
  symbol: string;
  side: string;
  status: string;
  filled_at: string | null;
  created_at: string | null;
  filled_qty?: number | null;
  qty?: number | null;
  filled_price?: number | null;
  connection_id?: string | null;
}

/** Minimal trade_history row shape — fills REPORTED by a connected broker. */
export interface TradeHistoryLike {
  symbol: string;
  action: string;
  quantity: number | null;
  price: number | null;
  executed_at: string | null;
  connection_id?: string | null;
}

/**
 * Normalize a `trade_history` row into the OrderLike shape the window math uses.
 * trade_history is a fill LOG (no order lifecycle), so status is implicitly
 * 'filled' and `executed_at` is the fill timestamp. Mapping once here keeps the
 * 60-day/30-day math identical for both sources.
 */
export function tradeHistoryToOrderLike(row: TradeHistoryLike): OrderLike {
  return {
    symbol: String(row.symbol || ''),
    side: String(row.action || '').toLowerCase(),
    status: 'filled',
    filled_at: row.executed_at,
    created_at: row.executed_at,
    filled_qty: row.quantity,
    qty: row.quantity,
    filled_price: row.price,
    connection_id: row.connection_id ?? null,
  };
}

/**
 * Pure — union BUY fills from `orders` (fills Vantage placed) with `trade_history`
 * (fills merely reported by a read-only broker), counting each fill ONCE.
 *
 * `orders` always wins on overlap. Two fills are the same fill when symbol +
 * side + qty + price agree AND their timestamps are within `skewMs` (default
 * 24h) — the same execution gets different timestamps per source (observed
 * 13h apart on the TSLA fill: orders.filled_at 13:30 vs executed_at 00:36).
 * Exact duplicates WITHIN a source (same symbol/side/qty/price/day) are also
 * collapsed, which is how the pre-existing duplicate `orders` rows drop out.
 *
 * Measured on live data: 74 of 75 Alpaca trade_history rows duplicate an
 * `orders` row, so an un-deduped union would double-count ~90% of the window.
 */
export function unionBuyFills(
  orders: OrderLike[],
  history: OrderLike[],
  opts?: { skewMs?: number },
): OrderLike[] {
  const skewMs = opts?.skewMs ?? 24 * 60 * 60 * 1000;

  const fillKey = (o: OrderLike): string =>
    [
      String(o.symbol || '').toUpperCase(),
      String(o.side || '').toLowerCase(),
      Number(o.filled_qty ?? o.qty ?? 0).toFixed(6),
      Number(o.filled_price ?? 0).toFixed(2),
    ].join('|');

  const dayKey = (o: OrderLike): string =>
    String(o.filled_at || o.created_at || '').slice(0, 10);

  const ts = (o: OrderLike): number | null => {
    const ms = Date.parse(String(o.filled_at || o.created_at || ''));
    return Number.isFinite(ms) ? ms : null;
  };

  const out: OrderLike[] = [];
  const seen = new Set<string>();

  // Orders first — they win every overlap.
  for (const o of orders || []) {
    const k = `${fillKey(o)}|${dayKey(o)}`;
    if (seen.has(k)) continue; // collapse duplicate orders rows
    seen.add(k);
    out.push(o);
  }

  for (const h of history || []) {
    const k = `${fillKey(h)}|${dayKey(h)}`;
    if (seen.has(k)) continue; // same-day exact duplicate of an accepted fill
    const hTs = ts(h);
    const duplicateOfOrder = out.some((o) => {
      if (fillKey(o) !== fillKey(h)) return false;
      const oTs = ts(o);
      if (hTs === null || oTs === null) return true; // no timestamps → same qty+price counts as the same fill
      return Math.abs(oTs - hTs) <= skewMs;
    });
    if (duplicateOfOrder) continue; // orders wins
    seen.add(k);
    out.push(h);
  }

  return out;
}

/**
 * Pure — is this sell at a loss under FIFO?
 *
 * Reuses `consumeLotsFIFO` to find the weighted cost basis of the specific
 * lots FIFO would consume for `sellQty` shares. A loss is `salePrice <
 * fifoCostBasis`. Graceful when the ledger under-tracks the position
 * (sellQty > remaining): caps at the available remaining shares.
 */
export function isSellAtLoss(
  lots: Lot[],
  sellQty: number,
  salePrice: number,
): { isLoss: boolean; fifoCostBasis: number; matchedQty: number; hasLots: boolean } {
  const none = { isLoss: false, fifoCostBasis: 0, matchedQty: 0, hasLots: false };

  const active = (lots || []).filter((l) => l.remaining_qty > 0);
  if (active.length === 0 || sellQty <= 0 || !Number.isFinite(salePrice)) {
    return { ...none, hasLots: active.length > 0 };
  }

  let result;
  try {
    result = consumeLotsFIFO(active, sellQty);
  } catch {
    const total = active.reduce((s, l) => s + l.remaining_qty, 0);
    if (total <= 0) return { ...none, hasLots: true };
    result = consumeLotsFIFO(active, total);
  }

  const fifoCostBasis = result.avg_consumed_price;
  const matchedQty = result.total_qty_consumed;
  if (matchedQty <= 0) {
    return { isLoss: false, fifoCostBasis: 0, matchedQty: 0, hasLots: true };
  }

  return {
    isLoss: salePrice < fifoCostBasis,
    fifoCostBasis,
    matchedQty,
    hasLots: true,
  };
}

/**
 * Pure — qualifying recent BUY orders for a ticker within the window.
 *
 * Same-ticker only, BUY side only, `filled` status only. The "bought within
 * the last N calendar days" date is `filled_at` (falls back to `created_at`).
 * Returns newest-first.
 */
export function findRecentBuys(
  orders: OrderLike[],
  ticker: string,
  days: number = WASH_SALE_WINDOW_DAYS,
  now: Date = new Date(),
): WashSaleRecentBuy[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const t = ticker.toUpperCase();

  return (orders || [])
    .filter((o) => o.symbol && o.symbol.toUpperCase() === t)
    .filter((o) => (o.side || '').toLowerCase() === 'buy')
    .filter((o) => (o.status || '').toLowerCase() === 'filled')
    .map((o) => ({
      filledAt: o.filled_at || o.created_at || '',
      qty: Number(o.filled_qty ?? o.qty ?? 0),
      price: Number(o.filled_price ?? 0),
      connectionId: o.connection_id ?? null,
    }))
    .filter((o) => o.filledAt)
    .filter((o) => new Date(o.filledAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.filledAt).getTime() - new Date(a.filledAt).getTime());
}

/** Pure — combine loss + recent-buy into a single verdict. */
export function evaluateWashSale(input: {
  lots: Lot[];
  sellQty: number;
  salePrice: number;
  orders: OrderLike[];
  ticker: string;
  now?: Date;
}): WashSaleResult {
  const loss = isSellAtLoss(input.lots, input.sellQty, input.salePrice);

  if (!loss.isLoss) {
    return {
      isWashSale: false,
      isLoss: false,
      fifoCostBasis: loss.fifoCostBasis,
      matchedQty: loss.matchedQty,
      hasLots: loss.hasLots,
      recentBuy: null,
      recentBuys: [],
      recentBuyQty: 0,
    };
  }

  const buys = findRecentBuys(input.orders, input.ticker, WASH_SALE_WINDOW_DAYS, input.now);

  return {
    isWashSale: buys.length > 0,
    isLoss: true,
    fifoCostBasis: loss.fifoCostBasis,
    matchedQty: loss.matchedQty,
    hasLots: loss.hasLots,
    recentBuy: buys[0] ?? null,
    recentBuys: buys,
    recentBuyQty: buys.reduce((s, b) => s + (Number.isFinite(b.qty) ? b.qty : 0), 0),
  };
}

/** Where the repurchase-window fills came from, and how complete that is. */
export interface RepurchaseFillSources {
  /** BUY fills Vantage placed (live trading-enabled logins, or demo). */
  orders: OrderLike[];
  /** BUY fills merely REPORTED by a read-only login — raw trade_history rows. */
  history: TradeHistoryLike[];
  /** Connections with no order coverage, i.e. trading_enabled !== true. */
  gapConnectionIds: string[];
  /** Rows of ANY kind in scope (NULL = query failed). Drives "can we see this account?" */
  ordersCoverage: number | null;
  historyCoverage: number | null;
}

/**
 * Server-side READ of the repurchase window for ONE ticker. This is the single
 * implementation of "which buys count" — both wash-sale checkers call it, so a
 * gap only ever has to be fixed in one place.
 *
 * Why two tables:
 *   • `orders`        — fills Vantage placed. Only exists for trading-enabled logins.
 *   • `trade_history` — fills a broker REPORTS. The only record for a read-only
 *                       login (e.g. Fidelity: trading_enabled=false, 0 orders
 *                       rows but 4,081 reported fills live).
 * `trade_history` is GAP-FILL only: it is read for connections in
 * `gapConnectionIds`, and `mergeRepurchaseFills` drops any residual overlap so a
 * fill present in both tables is counted once, `orders` winning.
 *
 * The DATE BOUND is applied in SQL as well as in the pure window check. Live
 * `trade_history` is large (4,157 rows) and PostgREST caps a response at 1,000
 * rows by default, so an unbounded read could silently truncate the window.
 * A 31-day bound (one day of slack over the 30-day rule) keeps the row set small
 * and per-symbol; the exact 30-day rule is still applied by findRecentBuys.
 *
 * Read-only: SELECTs only. Non-throwing — failures degrade to empty sources.
 */
export async function fetchRepurchaseFills(
  supabase: SupabaseClient,
  input: {
    userId: string;
    ticker: string;
    isDemo: boolean;
    /** Also count all-rows coverage for the user (2 extra head queries). */
    withCoverage?: boolean;
  },
): Promise<RepurchaseFillSources> {
  const { userId, ticker, isDemo, withCoverage = false } = input;
  const out: RepurchaseFillSources = {
    orders: [],
    history: [],
    gapConnectionIds: [],
    ordersCoverage: null,
    historyCoverage: null,
  };
  if (!ticker) return out;

  const cutoff = new Date(Date.now() - (WASH_SALE_WINDOW_DAYS + 1) * 86_400_000).toISOString();

  // ── Fills Vantage placed ──
  try {
    let q = supabase
      .from('orders')
      .select('symbol, side, status, filled_at, created_at, filled_qty, qty, filled_price, connection_id')
      .eq('user_id', userId)
      .eq('symbol', ticker)
      .eq('side', 'buy')
      .eq('status', 'filled')
      .gte('created_at', cutoff);
    q = isDemo
      ? q.eq('is_demo', true)
      : q.eq('is_demo', false).not('connection_id', 'is', null);
    const { data, error } = await q;
    if (error) console.warn('[wash-sale] order fetch failed:', error.message);
    out.orders = (data || []) as OrderLike[];
  } catch (e) {
    console.warn('[wash-sale] order fetch failed:', (e as Error).message);
  }

  // ── Fills a read-only connection reported (live only) ──
  if (!isDemo) {
    try {
      const { data: connRows, error: connError } = await supabase
        .from('broker_connections')
        .select('id, trading_enabled, status')
        .eq('user_id', userId);
      if (connError) console.warn('[wash-sale] connection fetch failed:', connError.message);

      out.gapConnectionIds = (connRows || [])
        .filter((c: any) => c.trading_enabled !== true)
        .map((c: any) => c.id);

      if (out.gapConnectionIds.length > 0) {
        const { data: thRows, error: thError } = await supabase
          .from('trade_history')
          .select('symbol, action, quantity, price, executed_at, connection_id')
          .eq('user_id', userId)
          .eq('symbol', ticker)
          .eq('action', 'buy')
          .eq('is_demo', false)
          .gte('executed_at', cutoff)
          .in('connection_id', out.gapConnectionIds);
        if (thError) console.warn('[wash-sale] trade_history fetch failed:', thError.message);
        out.history = (thRows || []) as TradeHistoryLike[];
      }
    } catch (e) {
      console.warn('[wash-sale] gap-fill failed:', (e as Error).message);
    }
  }

  if (withCoverage) {
    try {
      let oc = supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      oc = isDemo ? oc.eq('is_demo', true) : oc.eq('is_demo', false).not('connection_id', 'is', null);
      const { count, error } = await oc;
      if (!error) out.ordersCoverage = count ?? null;
    } catch { /* stays null = unknown */ }
    if (!isDemo && out.gapConnectionIds.length > 0) {
      try {
        const { count, error } = await supabase
          .from('trade_history')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_demo', false)
          .in('connection_id', out.gapConnectionIds);
        if (!error) out.historyCoverage = count ?? null;
      } catch { /* stays null = unknown */ }
    }
  }

  return out;
}

/** Pure — union `orders` with gap-fill `trade_history` rows, each counted once. */
export function mergeRepurchaseFills(
  src: Pick<RepurchaseFillSources, 'orders' | 'history' | 'gapConnectionIds'>,
): OrderLike[] {
  const gaps = new Set(src.gapConnectionIds || []);
  const history = (src.history || [])
    .filter((h) => h.connection_id && gaps.has(h.connection_id))
    .map((h) => tradeHistoryToOrderLike(h));
  return unionBuyFills(src.orders || [], history);
}

/**
 * Server-side check: read the FIFO lot ledger + recent BUY orders for a
 * ticker, then evaluate. Non-throwing — a data/DB shortfall degrades to
 * "no advisory" (never blocks a trade on this check).
 *
 * @param accountId broker_connections.id for live accounts; NULL = demo.
 * @param isDemo     scopes orders by is_demo for the demo account.
 */
export async function checkWashSale(
  supabase: SupabaseClient,
  input: {
    userId: string;
    accountId: string | null;
    isDemo: boolean;
    ticker: string;
    sellQty: number;
    salePrice: number;
  },
): Promise<WashSaleResult> {
  const { userId, accountId, isDemo, ticker, sellQty, salePrice } = input;

  const empty: WashSaleResult = {
    isWashSale: false,
    isLoss: false,
    fifoCostBasis: 0,
    matchedQty: 0,
    hasLots: false,
    recentBuy: null,
    recentBuys: [],
    recentBuyQty: 0,
  };

  if (!ticker || sellQty <= 0 || !Number.isFinite(salePrice)) return empty;

  // 1. Active lots — same scoping as consumeLotsForSell (account_id NULL = demo).
  let lotsQuery = supabase
    .from('position_lots')
    .select('id, ticker, qty, remaining_qty, price_at_fill, filled_at')
    .eq('user_id', userId)
    .eq('ticker', ticker)
    .gt('remaining_qty', 0)
    .order('filled_at', { ascending: true });

  lotsQuery = accountId === null
    ? lotsQuery.is('account_id', null)
    : lotsQuery.eq('account_id', accountId);

  const { data: lotRows, error: lotError } = await lotsQuery;
  if (lotError) {
    console.warn('[wash-sale] lot fetch failed:', lotError.message);
  }

  const lots: Lot[] = (lotRows || []).map((r: any) => ({
    id: r.id,
    ticker,
    qty: Number(r.qty),
    remaining_qty: Number(r.remaining_qty),
    price_at_fill: Number(r.price_at_fill),
    filled_at: r.filled_at,
  }));

  // 2. Repurchase window — one shared implementation, see fetchRepurchaseFills
  //    for the cross-connection + two-source (orders ∪ trade_history) rationale.
  const src = await fetchRepurchaseFills(supabase, { userId, ticker, isDemo });

  return evaluateWashSale({
    lots,
    sellQty,
    salePrice,
    orders: mergeRepurchaseFills(src),
    ticker,
  });
}
