// ═══════════════════════════════════════════════════════════════
// tests/basket-cancel.test.ts — Unit tests for basket-cancel fan-out
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/basket-cancel.test.ts
//
// Covers the selection logic behind PortfolioContext.cancelBasketOrder's
// real-SnapTrade branch:
//   - legs match by basketId (basket_id) OR basketOrderId
//   - only WORKING legs (open/pending/submitted) are fanned out
//   - filled / cancelled legs are ALWAYS excluded (never re-cancelled)
//   - empty result → "no open basket orders" branch
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { selectWorkingBasketLegs, type BasketLeg } from '../lib/basket-cancel';

const BID = 'basket-123';

describe('selectWorkingBasketLegs', () => {
  it('matches legs by basketId', () => {
    const orders: BasketLeg[] = [
      { id: 'a', status: 'open', basketId: BID },
      { id: 'b', status: 'open', basketId: 'other' },
    ];
    expect(selectWorkingBasketLegs(orders, BID).map((o) => o.id)).toEqual(['a']);
  });

  it('matches legs by basketOrderId', () => {
    const orders: BasketLeg[] = [
      { id: 'a', status: 'open', basketOrderId: BID },
      { id: 'b', status: 'open', basketId: BID },
    ];
    expect(selectWorkingBasketLegs(orders, BID).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('keeps working statuses: open, pending, submitted', () => {
    const orders: BasketLeg[] = [
      { id: 'open', status: 'open', basketId: BID },
      { id: 'pending', status: 'pending', basketId: BID },
      { id: 'submitted', status: 'submitted', basketId: BID },
    ];
    expect(selectWorkingBasketLegs(orders, BID).map((o) => o.id)).toEqual([
      'open',
      'pending',
      'submitted',
    ]);
  });

  it('EXCLUDES filled legs (must never be re-cancelled)', () => {
    const orders: BasketLeg[] = [
      { id: 'filled', status: 'filled', basketId: BID },
      { id: 'working', status: 'open', basketId: BID },
    ];
    expect(selectWorkingBasketLegs(orders, BID).map((o) => o.id)).toEqual(['working']);
  });

  it('EXCLUDES cancelled and rejected legs', () => {
    const orders: BasketLeg[] = [
      { id: 'cancelled', status: 'cancelled', basketId: BID },
      { id: 'rejected', status: 'rejected', basketId: BID },
      { id: 'working', status: 'submitted', basketId: BID },
    ];
    expect(selectWorkingBasketLegs(orders, BID).map((o) => o.id)).toEqual(['working']);
  });

  it('returns empty when no legs match the basket id', () => {
    const orders: BasketLeg[] = [{ id: 'x', status: 'open', basketId: 'other' }];
    expect(selectWorkingBasketLegs(orders, BID)).toEqual([]);
  });

  it('returns empty when every matching leg is terminal (→ "no open basket orders" branch)', () => {
    const orders: BasketLeg[] = [
      { id: 'f1', status: 'filled', basketId: BID },
      { id: 'c1', status: 'cancelled', basketId: BID },
    ];
    expect(selectWorkingBasketLegs(orders, BID)).toEqual([]);
  });

  it('treats a real partially_filled broker order as working (mapped to "open" by useOrders)', () => {
    // useOrders maps broker `partially_filled` → app status `open`, so the
    // remainder of a partial fill is still cancellable and appears as working.
    const orders: BasketLeg[] = [
      { id: 'partial', status: 'open', basketId: BID },
      { id: 'done', status: 'filled', basketId: BID },
    ];
    expect(selectWorkingBasketLegs(orders, BID).map((o) => o.id)).toEqual(['partial']);
  });
});

describe('fan-out behavior (the Promise.all over working legs)', () => {
  it('only cancels working legs, never filled ones', async () => {
    const orders: BasketLeg[] = [
      { id: 'w1', status: 'open', basketId: BID },
      { id: 'w2', status: 'submitted', basketId: BID },
      { id: 'f1', status: 'filled', basketId: BID },
      { id: 'c1', status: 'cancelled', basketId: BID },
    ];

    const workingLegs = selectWorkingBasketLegs(orders, BID);
    const cancelled: string[] = [];
    // Mirror of PortfolioContext: await Promise.all(workingLegs.map(l => cancelOrder(l.id)))
    await Promise.all(
      workingLegs.map((leg) => Promise.resolve(cancelled.push(leg.id))),
    );

    expect(cancelled.sort()).toEqual(['w1', 'w2']);
    expect(cancelled).not.toContain('f1');
    expect(cancelled).not.toContain('c1');
  });
});
