// ═══════════════════════════════════════════════════════════════
// lib/fifo-engine.ts — Pure FIFO lot consumption engine
// ═══════════════════════════════════════════════════════════════
//
// Consumes lots oldest-first (by filled_at ASC), splitting the
// final lot if partially consumed. Pure function — no DB calls,
// no side effects. Easy to unit test.
//
// Call sites (all route through the server-side wrapper):
//   1. Basket Sell-by-qty (Vantage-initiated)
//   2. Standalone position Sell (Vantage-initiated)
//   3. External sell detected via poll, basket-linked ticker
//   4. External sell detected via poll, non-basket ticker
// ═══════════════════════════════════════════════════════════════

export interface Lot {
  id: string;
  ticker: string;
  qty: number;
  remaining_qty: number;
  price_at_fill: number;
  filled_at: string; // ISO timestamp
  basket_id?: string | null;
  origin_tag?: string | null;
  source?: string | null; // 'vantage' | broker slug e.g. 'alpaca'
}

export interface ConsumedLot {
  lot_id: string;
  qty_consumed: number;
  price_at_fill: number;
  /** true if this lot was partially consumed (remaining_qty still > 0) */
  partial: boolean;
}

export interface FIFOResult {
  consumed: ConsumedLot[];
  /** Weighted average cost of consumed shares */
  avg_consumed_price: number;
  /** Total shares consumed */
  total_qty_consumed: number;
}

/**
 * Consume lots FIFO: oldest filled_at first, decrement remaining_qty,
 * split the final lot if partially consumed.
 *
 * @param lots - Array of lots for a single ticker, sorted filled_at ASC
 * @param sellQty - Number of shares to sell
 * @returns FIFOResult with consumed lots and weighted average cost
 * @throws if sellQty exceeds total remaining_qty across all lots
 */
export function consumeLotsFIFO(lots: Lot[], sellQty: number): FIFOResult {
  if (sellQty <= 0) {
    throw new Error('sellQty must be positive');
  }

  // Sort FIFO: oldest first
  const sorted = [...lots]
    .filter(l => l.remaining_qty > 0)
    .sort((a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime());

  const totalAvailable = sorted.reduce((sum, l) => sum + l.remaining_qty, 0);

  if (sellQty > totalAvailable) {
    throw new Error(
      `Cannot sell ${sellQty} shares: only ${totalAvailable} available across ${sorted.length} lots`
    );
  }

  const consumed: ConsumedLot[] = [];
  let remaining = sellQty;

  for (const lot of sorted) {
    if (remaining <= 0) break;

    const takeFromLot = Math.min(lot.remaining_qty, remaining);
    remaining -= takeFromLot;

    consumed.push({
      lot_id: lot.id,
      qty_consumed: takeFromLot,
      price_at_fill: lot.price_at_fill,
      partial: takeFromLot < lot.remaining_qty,
    });
  }

  const totalQtyConsumed = consumed.reduce((sum, l) => sum + l.qty_consumed, 0);
  const avgConsumedPrice =
    totalQtyConsumed > 0
      ? consumed.reduce((sum, l) => sum + l.qty_consumed * l.price_at_fill, 0) /
        totalQtyConsumed
      : 0;

  return {
    consumed,
    avg_consumed_price: Math.round(avgConsumedPrice * 100) / 100,
    total_qty_consumed: totalQtyConsumed,
  };
}

/**
 * Calculate the realized gain/loss for a set of consumed lots vs a given sell price.
 */
export function calculateRealizedGain(
  consumed: ConsumedLot[],
  sellPrice: number
): number {
  const totalCost = consumed.reduce(
    (sum, c) => sum + c.qty_consumed * c.price_at_fill,
    0
  );
  const totalProceeds = consumed.reduce((sum, c) => sum + c.qty_consumed, 0) * sellPrice;
  return Math.round((totalProceeds - totalCost) * 100) / 100;
}

/**
 * Get the total available (remaining) shares across all lots for a ticker
 */
export function getTotalRemainingQty(lots: Lot[]): number {
  return lots
    .filter(l => l.remaining_qty > 0)
    .reduce((sum, l) => sum + l.remaining_qty, 0);
}

/**
 * Get the lot count (number of lots with remaining_qty > 0)
 */
export function getActiveLotCount(lots: Lot[]): number {
  return lots.filter(l => l.remaining_qty > 0).length;
}

/**
 * Format FIFO description for UI display
 * e.g. "2 lots · FIFO" or "1 lot"
 */
export function formatFIFOLabel(lotCount: number, isMultiLot: boolean): string {
  if (lotCount === 0) return '';
  if (lotCount === 1) return '1 lot';
  return `${lotCount} lots${isMultiLot ? ' · FIFO' : ''}`;
}