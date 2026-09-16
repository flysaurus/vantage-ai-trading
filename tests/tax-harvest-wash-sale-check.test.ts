// ═══════════════════════════════════════════════════════════════
// tests/tax-harvest-wash-sale-check.test.ts
// ═══════════════════════════════════════════════════════════════
//
// GET /api/strategies/tax-harvest/wash-sale-check — the TLH planner's
// repurchase-window check. It previously read `orders` only, so a conflicting
// buy reported by a read-only login (Fidelity: trading_enabled=false, 0 orders
// rows, 4,081 reported fills) was invisible. It now shares the Sell-ticket
// window implementation (lib/wash-sale.ts: fetchRepurchaseFills +
// mergeRepurchaseFills) — nothing is re-implemented.
//
// The two required acceptance cases are asserted here against the REAL payload
// builder (not a copy): (a) an Alpaca+Fidelity cross-connection conflict is
// caught, (b) overlapping rows are counted once.
//
// Run: npx vitest run tests/tax-harvest-wash-sale-check.test.ts
import { describe, it, expect } from 'vitest';
import { buildWashSaleCheck } from '@/lib/tax-harvest/recent-buys';
import type { OrderLike, TradeHistoryLike } from '@/lib/wash-sale';

const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const FIDELITY = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';

const NOW = new Date('2026-09-16T00:00:00.000Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function order(over: Partial<OrderLike> = {}): OrderLike {
  return {
    symbol: 'AAPL',
    side: 'buy',
    status: 'filled',
    filled_at: daysAgo(10),
    created_at: daysAgo(10),
    filled_qty: 5,
    qty: 5,
    filled_price: 95,
    connection_id: ALPACA,
    ...over,
  };
}

function hist(over: Partial<TradeHistoryLike> = {}): TradeHistoryLike {
  return {
    symbol: 'AAPL',
    action: 'buy',
    quantity: 5,
    price: 95,
    executed_at: daysAgo(19),
    connection_id: FIDELITY,
    ...over,
  };
}

function check(over: Partial<Parameters<typeof buildWashSaleCheck>[0]> = {}) {
  return buildWashSaleCheck({
    symbol: 'AAPL',
    orders: [],
    history: [],
    gapConnectionIds: [],
    scopedConnectionId: ALPACA,
    isDemo: false,
    ordersCoverage: 0,
    historyCoverage: 0,
    now: NOW,
    ...over,
  });
}

describe('(A) cross-connection repurchase is caught', () => {
  it('blocks the harvest when the only conflicting buy is reported by Fidelity', () => {
    const r = check({
      orders: [], // Fidelity is read-only: it has ZERO rows in `orders`
      history: [hist({ executed_at: daysAgo(19) })],
      gapConnectionIds: [FIDELITY],
      ordersCoverage: 138,
      historyCoverage: 4081,
    });

    expect(r.isSafe).toBe(false);
    expect(r.recentBuys).toBe(1);
    expect(r.buyConnectionId).toBe(FIDELITY);
    expect(r.crossConnection).toBe(true);
    expect(r.daysSinceLastTrade).toBe(19);
    expect(r.lastTradeDate).toBe(daysAgo(19));
    expect(r.historyAvailable).toBe(true);
  });

  it('demonstrates the old behaviour: without the gap-fill the conflict is invisible', () => {
    // Same data, but `trade_history` not consulted (the pre-fix shape).
    const r = check({
      orders: [],
      history: [hist({ executed_at: daysAgo(19) })],
      gapConnectionIds: [], // ← no gap connections ⇒ history ignored
      ordersCoverage: 138,
      historyCoverage: 4081,
    });
    expect(r.isSafe).toBe(true); // the bug: green "safe to harvest"
    expect(r.recentBuys).toBe(0);
  });

  it('does not consult trade_history for a connection that HAS order coverage', () => {
    // Alpaca is trading-enabled ⇒ not a gap connection ⇒ its history rows are
    // never merged (orders is the authoritative record there).
    const r = check({
      orders: [],
      history: [hist({ connection_id: ALPACA, executed_at: daysAgo(4) })],
      gapConnectionIds: [FIDELITY],
      ordersCoverage: 138,
      historyCoverage: 4081,
    });
    expect(r.isSafe).toBe(true);
  });

  it('flags crossConnection only when the buy is in a different connection', () => {
    const same = check({
      orders: [order({ connection_id: ALPACA, filled_at: daysAgo(6) })],
      gapConnectionIds: [FIDELITY],
      scopedConnectionId: ALPACA,
      ordersCoverage: 138,
      historyCoverage: 4081,
    });
    expect(same.isSafe).toBe(false);
    expect(same.crossConnection).toBe(false);
    expect(same.buyConnectionId).toBe(ALPACA);

    const other = check({
      orders: [order({ connection_id: ALPACA, filled_at: daysAgo(12) })],
      history: [hist({ connection_id: FIDELITY, executed_at: daysAgo(3) })],
      gapConnectionIds: [FIDELITY],
      scopedConnectionId: ALPACA,
      ordersCoverage: 138,
      historyCoverage: 4081,
    });
    expect(other.recentBuys).toBe(2);
    expect(other.crossConnection).toBe(true); // newest buy is Fidelity's
    expect(other.buyConnectionId).toBe(FIDELITY);
    expect(other.daysSinceLastTrade).toBe(3);
  });

  it('honours the 30-day window on the normalized (executed_at) date', () => {
    const at30 = check({ history: [hist({ executed_at: daysAgo(30) })], gapConnectionIds: [FIDELITY], historyCoverage: 4081 });
    expect(at30.isSafe).toBe(false);
    const at31 = check({ history: [hist({ executed_at: daysAgo(31) })], gapConnectionIds: [FIDELITY], historyCoverage: 4081 });
    expect(at31.isSafe).toBe(true);
  });

  it('ignores sells reported in the gap connection (repurchase side only)', () => {
    const r = check({
      history: [hist({ action: 'sell', executed_at: daysAgo(2) })],
      gapConnectionIds: [FIDELITY],
      historyCoverage: 4081,
    });
    expect(r.isSafe).toBe(true);
  });
});

describe('(B) overlapping rows are counted once', () => {
  // A gap connection can still hold SOME orders rows (trading was enabled at
  // some point). Its trade_history rows then overlap those orders rows — the
  // same fill must not be counted twice.
  const ORDER_ROWS = 74; // Alpaca
  const OVERLAP_ROWS = 5; // Fidelity rows present in BOTH tables

  function fixture() {
    const orders: OrderLike[] = [];
    for (let i = 0; i < ORDER_ROWS; i += 1) {
      const t = daysAgo(1 + i / 24);
      orders.push(order({ connection_id: ALPACA, filled_at: t, created_at: t, filled_qty: 1 + i / 100, qty: 1 + i / 100, filled_price: 100 }));
    }
    const history: TradeHistoryLike[] = [];
    for (let i = 0; i < OVERLAP_ROWS; i += 1) {
      const t = new Date(Date.parse(daysAgo(2 + i)) - 13 * 3_600_000).toISOString(); // ~13h skew
      const qty = 10 + i;
      orders.push(order({ connection_id: FIDELITY, filled_at: t, created_at: t, filled_qty: qty, qty, filled_price: 42 }));
      history.push(hist({ connection_id: FIDELITY, executed_at: t, quantity: qty, price: 42 }));
    }
    return { orders, history };
  }

  it('counts the 74 + 5 rows as 79, not 84', () => {
    const { orders, history } = fixture();
    const r = check({
      orders,
      history,
      gapConnectionIds: [FIDELITY],
      ordersCoverage: 138,
      historyCoverage: 4081,
    });
    expect(orders).toHaveLength(ORDER_ROWS + OVERLAP_ROWS);
    expect(history).toHaveLength(OVERLAP_ROWS);
    expect(r.recentBuys).toBe(79);
    expect(r.recentBuys).not.toBe(84); // what a naive concat would report
  });

  it('counts a pure 74/74 overlap once (74, not 148)', () => {
    const orders: OrderLike[] = [];
    const history: TradeHistoryLike[] = [];
    for (let i = 0; i < 74; i += 1) {
      const t = daysAgo(1 + i / 24);
      const qty = 1 + i / 100;
      orders.push(order({ connection_id: FIDELITY, filled_at: t, created_at: t, filled_qty: qty, qty, filled_price: 100 }));
      history.push(hist({ connection_id: FIDELITY, executed_at: new Date(Date.parse(t) - 13 * 3_600_000).toISOString(), quantity: qty, price: 100 }));
    }
    const r = check({ orders, history, gapConnectionIds: [FIDELITY], ordersCoverage: 138, historyCoverage: 4081 });
    expect(r.recentBuys).toBe(74);
  });
});

describe('coverage / honesty of the "not checked" label', () => {
  it('reports historyAvailable=false only when BOTH sources are empty', () => {
    expect(check({ ordersCoverage: 0, historyCoverage: 0 }).historyAvailable).toBe(false);
    expect(check({ ordersCoverage: 0, historyCoverage: 4081 }).historyAvailable).toBe(true);
    expect(check({ ordersCoverage: 12, historyCoverage: 0 }).historyAvailable).toBe(true);
  });

  it('treats failed coverage counts (null) as "assume we can see it" (legacy answer kept)', () => {
    expect(check({ ordersCoverage: null, historyCoverage: null }).historyAvailable).toBe(true);
  });
});

describe('demo + scope echo', () => {
  it('demo is accountScoped and never cross-connection', () => {
    const r = check({ isDemo: true, scopedConnectionId: null, orders: [order({ connection_id: null, filled_at: daysAgo(5) })], ordersCoverage: 1 });
    expect(r.accountScoped).toBe(true);
    expect(r.crossConnection).toBe(false);
    expect(r.isSafe).toBe(false);
  });

  it('legacy unscoped live call is still labelled accountScoped=false', () => {
    const r = check({ scopedConnectionId: null });
    expect(r.accountScoped).toBe(false);
    expect(r.crossConnection).toBe(false);
  });
});
