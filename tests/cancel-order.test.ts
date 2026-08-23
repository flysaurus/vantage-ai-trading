// tests/cancel-order.test.ts — Regression tests for the demo-broker
// order-cancel flow. Guards the "cancel modal closes but order stays open"
// bug at the broker layer (the UI layer fix lives in PortfolioContext.cancelOrder).
//
// Run: npx vitest run tests/cancel-order.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DemoBroker } from '../lib/broker/demo-broker';

function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

describe('demo broker cancel order', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = makeStorage();
    (globalThis as any).window = {};
  });

  it('cancels an OPEN order by id, refunds reserved cash, and returns success', async () => {
    const broker = new DemoBroker('test-user', null, 'test@example.com');
    (broker as any).fetchQuote = vi.fn(async () => ({ price: 150, change: 1 }));
    (broker as any).isMarketOpen = () => false; // force market closed → order stays OPEN

    const cashBefore = (broker as any).state.cashBalance;

    const res = await broker.placeOrder({
      symbol: 'AAPL',
      side: 'BUY',
      shares: 10,
      type: 'market',
    } as any);

    expect(res.success).toBe(true);
    expect(res.status).toBe('OPEN');
    const orderId = res.orderId;

    const stateOrders = (broker as any).state.orders as any[];
    const placed = stateOrders.find((o: any) => o.id === orderId);
    expect(placed).toBeTruthy();
    expect(placed.status).toBe('OPEN');
    // Reserved cash is deducted while pending.
    expect((broker as any).state.cashBalance).toBeLessThan(cashBefore);

    const cancelRes = await broker.cancelOrder(orderId);
    expect(cancelRes.success).toBe(true);

    const after = stateOrders.find((o: any) => o.id === orderId);
    expect(after.status).toBe('CANCELLED');
    // Reserved cash is returned on cancel.
    expect((broker as any).state.cashBalance).toBe(cashBefore);
  });

  it('returns failure for an unknown order id', async () => {
    const broker = new DemoBroker('test-user', null, 'test@example.com');
    const res = await broker.cancelOrder('does-not-exist');
    expect(res.success).toBe(false);
    expect(res.message).toContain('not found');
  });

  it('returns failure when trying to cancel an already-terminal order', async () => {
    const broker = new DemoBroker('test-user', null, 'test@example.com');
    (broker as any).fetchQuote = vi.fn(async () => ({ price: 150, change: 1 }));
    (broker as any).isMarketOpen = () => true; // market open → fills immediately

    const res = await broker.placeOrder({
      symbol: 'AAPL',
      side: 'BUY',
      shares: 10,
      type: 'market',
    } as any);

    expect(res.status).toBe('FILLED');
    const cancelRes = await broker.cancelOrder(res.orderId);
    expect(cancelRes.success).toBe(false);
  });
});
