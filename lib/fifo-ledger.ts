// ═══════════════════════════════════════════════════════════════
// lib/fifo-ledger.ts — Server-side position_lots write path
// ═══════════════════════════════════════════════════════════════
//
// The pure engine (lib/fifo-engine.ts) computes FIFO consumption with no
// side effects. This module is the DB-backed wrapper: it reads the lot
// ledger, applies consumption (decrementing remaining_qty), and creates
// lots for new buys.
//
// Guarantees (Phase 7 — "external-sell messaging"):
//   • Lot-ledger updates are UNCONDITIONAL — they run regardless of
//     whether notification delivery succeeds, and never throw on data
//     shortfall (missing/under-tracked lots degrade gracefully).
//   • Notifications are best-effort and are called separately by the
//     caller; this module does not emit notifications at all.
// ═══════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  consumeLotsFIFO,
  type ConsumedLot,
  type Lot,
} from '@/lib/fifo-engine';

export interface LedgerConsumeResult {
  consumed: ConsumedLot[];
  avg_consumed_price: number;
  total_qty_consumed: number;
  /** Requested shares that could NOT be matched to tracked lots. */
  shortfall: number;
  /** True when the ledger had zero tracked lots for this ticker. */
  untracked: boolean;
}

export interface CreateLotInput {
  userId: string;
  /** Broker connection id (NULL = demo). Maps to position_lots.account_id. */
  accountId: string | null;
  ticker: string;
  qty: number;
  priceAtFill: number;
  filledAt: string;
  source: string;
  basketId?: string | null;
  orderId?: string | null;
  originTag?: string | null;
}

/**
 * Consume `sellQty` shares FIFO from the lot ledger for a single ticker,
 * decrementing remaining_qty on each consumed lot.
 *
 * Never throws on shortfall: if the ledger under-tracks the position
 * (e.g. external buys that predate lot tracking), it consumes what it can
 * and reports the shortfall. The ledger update itself is unconditional.
 */
export async function consumeLotsForSell(
  supabase: SupabaseClient,
  userId: string,
  accountId: string | null,
  ticker: string,
  sellQty: number,
): Promise<LedgerConsumeResult> {
  const empty: LedgerConsumeResult = {
    consumed: [],
    avg_consumed_price: 0,
    total_qty_consumed: 0,
    shortfall: Math.max(0, sellQty),
    untracked: true,
  };

  if (sellQty <= 0) {
    empty.shortfall = 0;
    return empty;
  }

  // Read active lots, oldest first (FIFO).
  let query = supabase
    .from('position_lots')
    .select('id, qty, remaining_qty, price_at_fill, filled_at')
    .eq('user_id', userId)
    .eq('ticker', ticker)
    .gt('remaining_qty', 0)
    .order('filled_at', { ascending: true });

  query = accountId === null
    ? query.is('account_id', null)
    : query.eq('account_id', accountId);

  const { data: rows, error } = await query;

  if (error) {
    console.error('[fifo-ledger] Lot fetch failed:', error.message);
    return empty;
  }

  const lots: Lot[] = (rows || []).map((r) => ({
    id: r.id,
    ticker,
    qty: Number(r.qty),
    remaining_qty: Number(r.remaining_qty),
    price_at_fill: Number(r.price_at_fill),
    filled_at: r.filled_at,
  }));

  const totalAvailable = lots.reduce((sum, l) => sum + l.remaining_qty, 0);

  if (lots.length === 0 || totalAvailable <= 0) {
    console.warn(
      `[fifo-ledger] No tracked lots for ${ticker} (user ${userId}) — ` +
        `external sell of ${sellQty} sh cannot be matched to a lot.`,
    );
    return empty;
  }

  const toConsume = Math.min(sellQty, totalAvailable);
  const result = consumeLotsFIFO(lots, toConsume);

  // Decrement remaining_qty for each consumed lot. Unconditional updates.
  for (const consumed of result.consumed) {
    const original = lots.find((l) => l.id === consumed.lot_id);
    if (!original) continue;
    const newRemaining = Math.max(0, original.remaining_qty - consumed.qty_consumed);
    const { error: updErr } = await supabase
      .from('position_lots')
      .update({ remaining_qty: newRemaining })
      .eq('id', consumed.lot_id);
    if (updErr) {
      console.error(
        `[fifo-ledger] Failed to decrement lot ${consumed.lot_id}:`,
        updErr.message,
      );
    }
  }

  return {
    consumed: result.consumed,
    avg_consumed_price: result.avg_consumed_price,
    total_qty_consumed: result.total_qty_consumed,
    shortfall: Math.max(0, sellQty - result.total_qty_consumed),
    untracked: false,
  };
}

/**
 * Create a new lot row for a buy fill. Idempotent per order_id — if a lot
 * already exists for this order (e.g. created by an earlier backfill), it
 * is left untouched.
 */
export async function createLotForBuy(
  supabase: SupabaseClient,
  input: CreateLotInput,
): Promise<{ created: boolean; id?: string }> {
  if (input.qty <= 0) {
    return { created: false };
  }

  // Idempotency guard: never double-insert the same order's lot.
  if (input.orderId) {
    const { data: existing } = await supabase
      .from('position_lots')
      .select('id')
      .eq('order_id', input.orderId)
      .limit(1);
    if (existing && existing.length > 0) {
      return { created: false };
    }
  }

  const { data, error } = await supabase
    .from('position_lots')
    .insert({
      user_id: input.userId,
      account_id: input.accountId,
      basket_id: input.basketId ?? null,
      ticker: input.ticker,
      qty: input.qty,
      remaining_qty: input.qty,
      price_at_fill: input.priceAtFill,
      filled_at: input.filledAt,
      source: input.source,
      order_id: input.orderId ?? null,
      origin_tag: input.originTag ?? 'external',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[fifo-ledger] Failed to create lot for buy:', error.message);
    return { created: false };
  }

  return { created: true, id: data?.id };
}
