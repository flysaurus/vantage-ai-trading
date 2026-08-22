// ═══════════════════════════════════════════════════════════════
// tests/fifo-engine.test.ts — Unit tests for the FIFO engine
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/fifo-engine.test.ts
//
// Tests cover:
//   - Basic FIFO consumption (single lot, exact match)
//   - Multi-lot FIFO ordering (oldest first)
//   - Partial lot consumption (split final lot)
//   - Edge cases: zero qty, exact total, insufficient shares
//   - Gain/loss calculation
//   - Helper functions (total qty, lot count, label formatting)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  consumeLotsFIFO,
  calculateRealizedGain,
  getTotalRemainingQty,
  getActiveLotCount,
  formatFIFOLabel,
  Lot,
} from '../lib/fifo-engine';

const makeLot = (overrides: Partial<Lot> = {}): Lot => ({
  id: 'lot-1',
  ticker: 'AAPL',
  qty: 10,
  remaining_qty: 10,
  price_at_fill: 150,
  filled_at: '2026-06-01T10:00:00Z',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────
// consumeLotsFIFO
// ─────────────────────────────────────────────────────────────

describe('consumeLotsFIFO', () => {
  it('consumes exact qty from a single lot', () => {
    const lots = [makeLot({ id: 'lot-1', remaining_qty: 10, price_at_fill: 150 })];
    const result = consumeLotsFIFO(lots, 10);

    expect(result.consumed).toHaveLength(1);
    expect(result.consumed[0]).toEqual({
      lot_id: 'lot-1',
      qty_consumed: 10,
      price_at_fill: 150,
      partial: false,
    });
    expect(result.total_qty_consumed).toBe(10);
    expect(result.avg_consumed_price).toBe(150);
  });

  it('consumes partial qty from a single lot (split)', () => {
    const lots = [makeLot({ id: 'lot-1', remaining_qty: 10, price_at_fill: 150 })];
    const result = consumeLotsFIFO(lots, 5);

    expect(result.consumed).toHaveLength(1);
    expect(result.consumed[0]).toEqual({
      lot_id: 'lot-1',
      qty_consumed: 5,
      price_at_fill: 150,
      partial: true,
    });
    expect(result.total_qty_consumed).toBe(5);
  });

  it('consumes oldest lot first (FIFO)', () => {
    const lots = [
      makeLot({ id: 'lot-late', remaining_qty: 10, price_at_fill: 200, filled_at: '2026-07-01T00:00:00Z' }),
      makeLot({ id: 'lot-early', remaining_qty: 5, price_at_fill: 100, filled_at: '2026-01-01T00:00:00Z' }),
      makeLot({ id: 'lot-mid', remaining_qty: 3, price_at_fill: 150, filled_at: '2026-04-01T00:00:00Z' }),
    ];
    const result = consumeLotsFIFO(lots, 10);

    // Should consume: lot-early (5) → lot-mid (3) → lot-late (2 of 10)
    expect(result.consumed).toHaveLength(3);
    expect(result.consumed[0]).toMatchObject({ lot_id: 'lot-early', qty_consumed: 5, partial: false });
    expect(result.consumed[1]).toMatchObject({ lot_id: 'lot-mid', qty_consumed: 3, partial: false });
    expect(result.consumed[2]).toMatchObject({ lot_id: 'lot-late', qty_consumed: 2, partial: true });
    expect(result.total_qty_consumed).toBe(10);
  });

  it('skips fully consumed lots (remaining_qty = 0)', () => {
    const lots = [
      makeLot({ id: 'lot-consumed', remaining_qty: 0, price_at_fill: 100, filled_at: '2026-01-01T00:00:00Z' }),
      makeLot({ id: 'lot-active', remaining_qty: 5, price_at_fill: 200, filled_at: '2026-06-01T00:00:00Z' }),
    ];
    const result = consumeLotsFIFO(lots, 5);

    expect(result.consumed).toHaveLength(1);
    expect(result.consumed[0]).toMatchObject({ lot_id: 'lot-active', qty_consumed: 5 });
  });

  it('calculates weighted average cost correctly', () => {
    const lots = [
      makeLot({ id: 'lot-1', remaining_qty: 5, price_at_fill: 100, filled_at: '2026-01-01T00:00:00Z' }),
      makeLot({ id: 'lot-2', remaining_qty: 5, price_at_fill: 200, filled_at: '2026-06-01T00:00:00Z' }),
    ];
    const result = consumeLotsFIFO(lots, 10);

    // (5 * 100 + 5 * 200) / 10 = 150
    expect(result.avg_consumed_price).toBe(150);
    expect(result.total_qty_consumed).toBe(10);
  });

  it('handles partial consumption with correct average', () => {
    const lots = [
      makeLot({ id: 'lot-1', remaining_qty: 10, price_at_fill: 100, filled_at: '2026-01-01T00:00:00Z' }),
      makeLot({ id: 'lot-2', remaining_qty: 10, price_at_fill: 200, filled_at: '2026-06-01T00:00:00Z' }),
    ];
    // Consume 15: all of lot-1 (10) + half of lot-2 (5)
    const result = consumeLotsFIFO(lots, 15);

    // (10 * 100 + 5 * 200) / 15 = 133.33
    expect(result.avg_consumed_price).toBe(133.33);
    expect(result.total_qty_consumed).toBe(15);
    expect(result.consumed[1].partial).toBe(true);
  });

  it('throws on insufficient shares', () => {
    const lots = [makeLot({ id: 'lot-1', remaining_qty: 5 })];
    expect(() => consumeLotsFIFO(lots, 10)).toThrow('Cannot sell 10 shares');
  });

  it('throws on zero sell qty', () => {
    const lots = [makeLot({ remaining_qty: 10 })];
    expect(() => consumeLotsFIFO(lots, 0)).toThrow('sellQty must be positive');
  });

  it('throws on negative sell qty', () => {
    const lots = [makeLot({ remaining_qty: 10 })];
    expect(() => consumeLotsFIFO(lots, -3)).toThrow('sellQty must be positive');
  });

  it('handles fractional shares', () => {
    const lots = [
      makeLot({ id: 'lot-1', remaining_qty: 0.1329, price_at_fill: 180.42, filled_at: '2026-01-01T00:00:00Z' }),
      makeLot({ id: 'lot-2', remaining_qty: 0.1110, price_at_fill: 180.09, filled_at: '2026-06-01T00:00:00Z' }),
    ];
    const result = consumeLotsFIFO(lots, 0.2);

    expect(result.total_qty_consumed).toBeCloseTo(0.2, 4);
    expect(result.consumed[0]).toMatchObject({ lot_id: 'lot-1', qty_consumed: 0.1329, partial: false });
    expect(result.consumed[1].lot_id).toBe('lot-2');
    expect(result.consumed[1].qty_consumed).toBeCloseTo(0.0671, 4);
    expect(result.consumed[1].partial).toBe(true);
  });

  it('handles many lots (>10) efficiently', () => {
    const lots = Array.from({ length: 50 }, (_, i) =>
      makeLot({
        id: `lot-${i}`,
        remaining_qty: 1,
        price_at_fill: 100 + i,
        filled_at: new Date(2026, 0, i + 1).toISOString(),
      })
    );
    const result = consumeLotsFIFO(lots, 50);
    expect(result.consumed).toHaveLength(50);
    expect(result.total_qty_consumed).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────
// calculateRealizedGain
// ─────────────────────────────────────────────────────────────

describe('calculateRealizedGain', () => {
  it('calculates gain when sell price > cost basis', () => {
    const consumed = [
      { lot_id: '1', qty_consumed: 10, price_at_fill: 100, partial: false },
    ];
    const gain = calculateRealizedGain(consumed, 150);
    // (10 * 150) - (10 * 100) = 500
    expect(gain).toBe(500);
  });

  it('calculates loss when sell price < cost basis', () => {
    const consumed = [
      { lot_id: '1', qty_consumed: 5, price_at_fill: 200, partial: false },
    ];
    const gain = calculateRealizedGain(consumed, 150);
    // (5 * 150) - (5 * 200) = -250
    expect(gain).toBe(-250);
  });

  it('handles multiple lots', () => {
    const consumed = [
      { lot_id: '1', qty_consumed: 5, price_at_fill: 100, partial: false },
      { lot_id: '2', qty_consumed: 3, price_at_fill: 200, partial: true },
    ];
    const gain = calculateRealizedGain(consumed, 180);
    // (8 * 180) - (5*100 + 3*200) = 1440 - 1100 = 340
    expect(gain).toBe(340);
  });
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

describe('getTotalRemainingQty', () => {
  it('sums only lots with remaining_qty > 0', () => {
    const lots = [
      makeLot({ remaining_qty: 5 }),
      makeLot({ remaining_qty: 0 }),
      makeLot({ remaining_qty: 3 }),
    ];
    expect(getTotalRemainingQty(lots)).toBe(8);
  });

  it('returns 0 when no lots have remaining qty', () => {
    const lots = [makeLot({ remaining_qty: 0 }), makeLot({ remaining_qty: 0 })];
    expect(getTotalRemainingQty(lots)).toBe(0);
  });
});

describe('getActiveLotCount', () => {
  it('counts only lots with remaining_qty > 0', () => {
    const lots = [
      makeLot({ remaining_qty: 5 }),
      makeLot({ remaining_qty: 0 }),
      makeLot({ remaining_qty: 3 }),
    ];
    expect(getActiveLotCount(lots)).toBe(2);
  });
});

describe('formatFIFOLabel', () => {
  it('returns empty string for 0 lots', () => {
    expect(formatFIFOLabel(0, false)).toBe('');
  });

  it('returns "1 lot" for single lot', () => {
    expect(formatFIFOLabel(1, false)).toBe('1 lot');
  });

  it('returns "N lots · FIFO" for multi-lot', () => {
    expect(formatFIFOLabel(3, true)).toBe('3 lots · FIFO');
  });

  it('returns "N lots" for multi-lot without FIFO flag', () => {
    expect(formatFIFOLabel(3, false)).toBe('3 lots');
  });
});