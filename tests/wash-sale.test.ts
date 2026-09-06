// ═══════════════════════════════════════════════════════════════
// tests/wash-sale.test.ts — Unit tests for the wash-sale advisory
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/wash-sale.test.ts
//
// Covers the three required real scenarios plus boundaries:
//   1. Sell at a loss + same-ticker buy within 30 days → advisory shows
//   2. Sell at a loss + NO recent buy                      → no advisory
//   3. Sell at a GAIN (+ recent buy)                       → no advisory
//   + same-ticker scoping, buy/side/status filters, 30-day boundary,
//     FIFO specific-lot cost basis, and the no-lots/graceful cases.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  isSellAtLoss,
  findRecentBuys,
  evaluateWashSale,
  WASH_SALE_WINDOW_DAYS,
  type OrderLike,
} from '@/lib/wash-sale';
import type { Lot } from '@/lib/fifo-engine';

function lot(over: Partial<Lot> = {}): Lot {
  return {
    id: 'lot-1',
    ticker: 'AAPL',
    qty: 10,
    remaining_qty: 10,
    price_at_fill: 100,
    filled_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function buy(over: Partial<OrderLike> = {}): OrderLike {
  return {
    symbol: 'AAPL',
    side: 'buy',
    status: 'filled',
    filled_at: '2026-08-20T00:00:00.000Z',
    created_at: '2026-08-20T00:00:00.000Z',
    filled_qty: 5,
    qty: 5,
    filled_price: 95,
    ...over,
  };
}

const NOW = new Date('2026-09-06T00:00:00.000Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('isSellAtLoss', () => {
  it('detects a loss when sale price < FIFO cost basis', () => {
    const r = isSellAtLoss([lot({ price_at_fill: 100 })], 10, 90);
    expect(r.isLoss).toBe(true);
    expect(r.fifoCostBasis).toBe(100);
    expect(r.matchedQty).toBe(10);
    expect(r.hasLots).toBe(true);
  });

  it('detects a gain when sale price > FIFO cost basis', () => {
    const r = isSellAtLoss([lot({ price_at_fill: 100 })], 10, 110);
    expect(r.isLoss).toBe(false);
  });

  it('uses the FIFO (oldest) lots for a partial sell', () => {
    const lots = [
      lot({ id: 'old', filled_at: '2026-01-01T00:00:00.000Z', price_at_fill: 200, remaining_qty: 5 }),
      lot({ id: 'new', filled_at: '2026-02-01T00:00:00.000Z', price_at_fill: 100, remaining_qty: 5 }),
    ];
    // Selling 5 shares consumes only the oldest lot @ $200.
    const partial = isSellAtLoss(lots, 5, 150);
    expect(partial.fifoCostBasis).toBe(200);
    expect(partial.isLoss).toBe(true); // $150 < $200

    // Selling all 10 → weighted avg $150 → breakeven, not a loss.
    const full = isSellAtLoss(lots, 10, 150);
    expect(full.fifoCostBasis).toBe(150);
    expect(full.isLoss).toBe(false);
  });

  it('reports no lots (cannot determine) when ledger is empty', () => {
    const r = isSellAtLoss([], 10, 90);
    expect(r.isLoss).toBe(false);
    expect(r.hasLots).toBe(false);
  });

  it('caps at available shares when sellQty exceeds tracked lots', () => {
    const r = isSellAtLoss([lot({ remaining_qty: 10, price_at_fill: 100 })], 15, 90);
    expect(r.isLoss).toBe(true);
    expect(r.matchedQty).toBe(10);
    expect(r.fifoCostBasis).toBe(100);
  });
});

describe('findRecentBuys', () => {
  it('filters to same-ticker, BUY side, filled status, within window', () => {
    const orders: OrderLike[] = [
      buy(),                                                    // ✓ same ticker, buy, filled, 17d ago
      buy({ symbol: 'MSFT' }),                                  // ✗ different ticker
      buy({ side: 'sell' }),                                    // ✗ sell side
      buy({ status: 'pending' }),                               // ✗ not filled
      buy({ filled_at: daysAgo(67) }),                          // ✗ older than 30 days
      buy({ filled_at: null, created_at: daysAgo(10), filled_qty: 3, qty: 3 }),// ✓ falls back to created_at
    ];
    const r = findRecentBuys(orders, 'AAPL', WASH_SALE_WINDOW_DAYS, NOW);
    expect(r).toHaveLength(2);
    // Newest first.
    expect(r[0].filledAt).toBe(daysAgo(10));
    expect(r[0].qty).toBe(3);
  });

  it('honours the 30-day boundary (inclusive at exactly 30 days)', () => {
    const at30 = buy({ filled_at: daysAgo(30) });
    expect(findRecentBuys([at30], 'AAPL', 30, NOW)).toHaveLength(1);
    const at31 = buy({ filled_at: daysAgo(31) });
    expect(findRecentBuys([at31], 'AAPL', 30, NOW)).toHaveLength(0);
  });
});

describe('evaluateWashSale', () => {
  const lots = [lot({ price_at_fill: 100 })];

  it('SCENARIO 1: loss + recent same-ticker buy → advisory shows', () => {
    const r = evaluateWashSale({
      lots,
      sellQty: 10,
      salePrice: 90,
      orders: [buy({ filled_at: daysAgo(17), qty: 5, filled_price: 95 })],
      ticker: 'AAPL',
      now: NOW,
    });
    expect(r.isWashSale).toBe(true);
    expect(r.isLoss).toBe(true);
    expect(r.fifoCostBasis).toBe(100);
    expect(r.recentBuy).not.toBeNull();
    expect(r.recentBuy!.filledAt).toBe(daysAgo(17));
    expect(r.recentBuy!.qty).toBe(5);
    expect(r.recentBuy!.price).toBe(95);
  });

  it('SCENARIO 2: loss + NO recent buy → no advisory', () => {
    const r = evaluateWashSale({
      lots,
      sellQty: 10,
      salePrice: 90,
      orders: [],
      ticker: 'AAPL',
      now: NOW,
    });
    expect(r.isWashSale).toBe(false);
    expect(r.isLoss).toBe(true);
    expect(r.recentBuy).toBeNull();
  });

  it('SCENARIO 3: GAIN + recent buy → no advisory (wash sale only applies to losses)', () => {
    const r = evaluateWashSale({
      lots,
      sellQty: 10,
      salePrice: 110,
      orders: [buy({ filled_at: daysAgo(5) })],
      ticker: 'AAPL',
      now: NOW,
    });
    expect(r.isWashSale).toBe(false);
    expect(r.isLoss).toBe(false);
    expect(r.recentBuy).toBeNull();
  });

  it('no lots tracked → no advisory (cannot determine a loss)', () => {
    const r = evaluateWashSale({
      lots: [],
      sellQty: 10,
      salePrice: 90,
      orders: [buy()],
      ticker: 'AAPL',
      now: NOW,
    });
    expect(r.isWashSale).toBe(false);
    expect(r.hasLots).toBe(false);
  });
});
