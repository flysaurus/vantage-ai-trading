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

// ═══════════════════════════════════════════════════════════════
// Cross-connection repurchase window (item 3)
// ═══════════════════════════════════════════════════════════════
// Two sources feed the repurchase window:
//   • orders        — fills Vantage placed (trading-enabled logins)
//   • trade_history — fills REPORTED by a read-only login (no orders rows)
// Both requirements in the item-3 acceptance test are asserted here:
//   (A) an Alpaca + Fidelity cross-connection conflict is caught, and
//   (B) overlapping rows are counted ONCE, not twice.
import {
  unionBuyFills,
  tradeHistoryToOrderLike,
  type TradeHistoryLike,
} from '@/lib/wash-sale';

const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const FIDELITY = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';

function hist(over: Partial<TradeHistoryLike> = {}): TradeHistoryLike {
  return {
    symbol: 'AAPL',
    action: 'buy',
    quantity: 5,
    price: 95,
    executed_at: daysAgo(17),
    connection_id: FIDELITY,
    ...over,
  };
}

describe('item 3 (A): cross-connection conflict in a DIFFERENT connection is caught', () => {
  it('catches a repurchase reported only by a read-only login (Fidelity) when selling in Alpaca', () => {
    const lots = [lot({ price_at_fill: 100 })];

    // OLD behaviour: the window only saw `orders`, and the Fidelity (read-only)
    // login has NO orders rows — so the conflicting buy was invisible.
    const ordersOnly = evaluateWashSale({
      lots,
      sellQty: 10,
      salePrice: 90,
      orders: [],
      ticker: 'AAPL',
      now: NOW,
    });
    expect(ordersOnly.isWashSale).toBe(false); // the bug

    // NEW behaviour: union in the broker-reported fill from the other connection.
    const merged = unionBuyFills([], [tradeHistoryToOrderLike(hist({ executed_at: daysAgo(19) }))]);
    const fixed = evaluateWashSale({
      lots,
      sellQty: 10,
      salePrice: 90,
      orders: merged,
      ticker: 'AAPL',
      now: NOW,
    });
    expect(fixed.isWashSale).toBe(true);
    expect(fixed.recentBuy).not.toBeNull();
    expect(fixed.recentBuy!.connectionId).toBe(FIDELITY); // different connection than the sale
  });

  it('normalizes trade_history into the order shape (action→side, executed_at→filled_at, quantity/price)', () => {
    const o = tradeHistoryToOrderLike(hist({ action: 'buy', quantity: 3, price: 12.5 }));
    expect(o.side).toBe('buy');
    expect(o.status).toBe('filled');
    expect(o.filled_at).toBe(daysAgo(17));
    expect(o.filled_qty).toBe(3);
    expect(o.filled_price).toBe(12.5);
    expect(o.connection_id).toBe(FIDELITY);
  });

  it('still ignores a SELL in another connection (repurchase side only)', () => {
    const merged = unionBuyFills(
      [],
      [tradeHistoryToOrderLike(hist({ action: 'sell', executed_at: daysAgo(3) }))],
    );
    const r = evaluateWashSale({
      lots: [lot({ price_at_fill: 100 })],
      sellQty: 10,
      salePrice: 90,
      orders: merged,
      ticker: 'AAPL',
      now: NOW,
    });
    expect(r.isWashSale).toBe(false);
  });

  it('ignores a buy outside the 30-day window', () => {
    const merged = unionBuyFills([], [tradeHistoryToOrderLike(hist({ executed_at: daysAgo(31) }))]);
    const r = evaluateWashSale({
      lots: [lot({ price_at_fill: 100 })],
      sellQty: 10,
      salePrice: 90,
      orders: merged,
      ticker: 'AAPL',
      now: NOW,
    });
    expect(r.isWashSale).toBe(false);
  });
});

describe('item 3 (B): overlapping rows are counted ONCE, not twice', () => {
  // Mirrors the live shape: 74 Alpaca fills appear in BOTH `orders` and
  // `trade_history`, with per-source timestamps up to ~13h apart.
  const N = 74;

  function overlappingFills(): { orders: OrderLike[]; history: OrderLike[] } {
    const orders: OrderLike[] = [];
    const history: OrderLike[] = [];
    for (let i = 0; i < N; i += 1) {
      const base = NOW.getTime() - (i + 1) * 3_600_000; // hourly, all inside 30d
      const qty = 1 + i / 100; // unique qty per fill so keys don't collide
      orders.push(
        buy({
          symbol: 'AAPL',
          filled_at: new Date(base).toISOString(),
          created_at: new Date(base).toISOString(),
          filled_qty: qty,
          qty,
          filled_price: 100,
          connection_id: ALPACA,
        }),
      );
      // Same fill as REPORTED by the broker: 13h earlier, identical qty/price.
      const t = new Date(base - 13 * 3_600_000).toISOString();
      history.push(
        tradeHistoryToOrderLike({
          symbol: 'AAPL',
          action: 'buy',
          quantity: qty,
          price: 100,
          executed_at: t,
          connection_id: ALPACA,
        }),
      );
    }
    return { orders, history };
  }

  it('union collapses the overlap to the N orders fills', () => {
    const { orders, history } = overlappingFills();
    const merged = unionBuyFills(orders, history);
    expect(orders).toHaveLength(N);
    expect(history).toHaveLength(N);
    expect(merged).toHaveLength(N); // NOT 2N
  });

  it('evaluateWashSale reports N buys and the orders-only qty (counted once)', () => {
    const { orders, history } = overlappingFills();
    const r = evaluateWashSale({
      lots: [lot({ price_at_fill: 100 })],
      sellQty: 10,
      salePrice: 90,
      orders: unionBuyFills(orders, history),
      ticker: 'AAPL',
      now: NOW,
    });
    const ordersQty = orders.reduce((s, o) => s + Number(o.filled_qty), 0);
    const naiveQty = ordersQty * 2; // what a naive concat would report
    expect(r.isWashSale).toBe(true);
    expect(r.recentBuys).toHaveLength(N);
    expect(r.recentBuyQty).toBeCloseTo(ordersQty, 6);
    expect(r.recentBuyQty).not.toBeCloseTo(naiveQty, 6); // guards the double-count
  });

  it('dedupes duplicate rows WITHIN orders (same symbol/side/qty/price/day)', () => {
    const dup = buy({ filled_qty: 5, qty: 5, filled_price: 95, connection_id: ALPACA });
    const merged = unionBuyFills([dup, { ...dup }], []);
    expect(merged).toHaveLength(1);
  });

  it('orders wins on overlap: the surviving fill carries the orders timestamp', () => {
    const o = buy({ filled_at: daysAgo(17), filled_qty: 5, filled_price: 95, connection_id: ALPACA });
    const h = tradeHistoryToOrderLike(
      hist({ executed_at: daysAgo(17.5), quantity: 5, price: 95, connection_id: FIDELITY }),
    );
    const merged = unionBuyFills([o], [h]);
    expect(merged).toHaveLength(1);
    expect(merged[0].filled_at).toBe(daysAgo(17));
    expect(merged[0].connection_id).toBe(ALPACA);
  });

  it('keeps a genuinely distinct history fill (different qty) alongside orders', () => {
    const o = buy({ filled_qty: 5, qty: 5, filled_price: 95, connection_id: ALPACA });
    const h = tradeHistoryToOrderLike(
      hist({ quantity: 7, price: 95, connection_id: FIDELITY, executed_at: daysAgo(17.5) }),
    );
    expect(unionBuyFills([o], [h])).toHaveLength(2);
  });
});
