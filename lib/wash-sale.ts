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
  };
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

  // 2. Recent BUY orders — same ticker, BUY side, filled. The 30-day window
  //    is applied in the pure findRecentBuys (single source of truth).
  let ordersQuery = supabase
    .from('orders')
    .select('symbol, side, status, filled_at, created_at, filled_qty, qty, filled_price')
    .eq('user_id', userId)
    .eq('symbol', ticker)
    .eq('side', 'buy')
    .eq('status', 'filled');

  ordersQuery = isDemo
    ? ordersQuery.eq('is_demo', true)
    : ordersQuery.eq('connection_id', accountId);

  const { data: orderRows, error: orderError } = await ordersQuery;
  if (orderError) {
    console.warn('[wash-sale] order fetch failed:', orderError.message);
  }

  return evaluateWashSale({
    lots,
    sellQty,
    salePrice,
    orders: (orderRows || []) as OrderLike[],
    ticker,
  });
}
