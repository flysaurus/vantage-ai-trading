import { describe, it, expect } from 'vitest';
import {
  holdingPeriodFor,
  toTaxLots,
  computePositionHoldingPeriod,
  summarizeTaxEstimate,
  annualSavingsRange,
  SHORT_TERM_ASSUMED_RATE,
  LONG_TERM_ASSUMED_RATE,
} from '@/lib/tax-harvest/holding-period';

const ASOF = new Date('2026-09-12T12:00:00Z');

function lot(over: { id: string; filledAt: string; priceAtFill: number; qty?: number; remainingQty?: number }) {
  return {
    id: over.id,
    qty: over.qty ?? 10,
    remainingQty: over.remainingQty ?? 10,
    priceAtFill: over.priceAtFill,
    filledAt: over.filledAt,
  };
}

describe('holdingPeriodFor', () => {
  it('classifies shares held under a year as short-term', () => {
    expect(holdingPeriodFor('2026-09-01T00:00:00Z', ASOF)).toBe('short');
    expect(holdingPeriodFor('2025-10-01T00:00:00Z', ASOF)).toBe('short');
  });

  it('classifies shares held over a year as long-term', () => {
    expect(holdingPeriodFor('2025-09-11T00:00:00Z', ASOF)).toBe('long');
    expect(holdingPeriodFor('2023-01-15T00:00:00Z', ASOF)).toBe('long');
  });

  it('treats exactly one year as still short-term (IRS: long = MORE than one year)', () => {
    expect(holdingPeriodFor('2025-09-12T12:00:00Z', ASOF)).toBe('short');
    expect(holdingPeriodFor('2025-09-12T11:59:59Z', ASOF)).toBe('long');
  });

  it('returns null for missing / invalid / future dates', () => {
    expect(holdingPeriodFor(null, ASOF)).toBeNull();
    expect(holdingPeriodFor('', ASOF)).toBeNull();
    expect(holdingPeriodFor('not-a-date', ASOF)).toBeNull();
    expect(holdingPeriodFor('2027-01-01T00:00:00Z', ASOF)).toBeNull();
  });
});

describe('toTaxLots', () => {
  it('maps DB rows, drops empty lots, sorts oldest first', () => {
    const parsed = toTaxLots([
      lot({ id: 'b', filledAt: '2026-05-01T00:00:00Z', priceAtFill: 20 }),
      lot({ id: 'a', filledAt: '2024-05-01T00:00:00Z', priceAtFill: 10 }),
      { id: 'z', ticker: 'X', qty: 5, remainingQty: 0, priceAtFill: 5, filledAt: '2025-01-01T00:00:00Z' },
    ] as any);
    expect(parsed.map(l => l.id)).toEqual(['a', 'b']);
  });

  it('returns [] for null/undefined input', () => {
    expect(toTaxLots(null)).toEqual([]);
    expect(toTaxLots(undefined)).toEqual([]);
  });
});

describe('computePositionHoldingPeriod', () => {
  it('splits a position across short- and long-term lots', () => {
    const lots = toTaxLots([
      lot({ id: 'old', filledAt: '2024-01-10T00:00:00Z', priceAtFill: 100, qty: 5, remainingQty: 5 }),
      lot({ id: 'new', filledAt: '2026-06-10T00:00:00Z', priceAtFill: 200, qty: 5, remainingQty: 5 }),
    ] as any);

    const r = computePositionHoldingPeriod(
      { symbol: 'TEST', qty: 10, avgCost: 150, currentPrice: 90, marketValue: 900 },
      lots,
      ASOF,
    );

    expect(r.label).toBe('Mixed');
    expect(r.knownQty).toBe(10);
    expect(r.unknownQty).toBe(0);
    // long: 5 sh @ 100 cost → value 450 → loss 50
    expect(r.longTermLoss).toBeCloseTo(50, 6);
    // short: 5 sh @ 200 cost → value 450 → loss 550
    expect(r.shortTermLoss).toBeCloseTo(550, 6);
    expect(r.longTermSavings).toBeCloseTo(50 * LONG_TERM_ASSUMED_RATE, 6);
    expect(r.shortTermSavings).toBeCloseTo(550 * SHORT_TERM_ASSUMED_RATE, 6);
    expect(r.estimatedSavings).toBeCloseTo(50 * 0.15 + 550 * 0.24, 6);
    // Only the long-term lot gained? no — both lost, so no gains
    expect(r.shortTermGain).toBeLessThan(0);
    expect(r.lots.map(l => l.holdingPeriod)).toEqual(['long', 'short']);
  });

  it('marks positions with no tracked lots as unknown and estimates nothing', () => {
    const r = computePositionHoldingPeriod(
      { symbol: 'FID', qty: 10, avgCost: 300, currentPrice: 200, marketValue: 2000 },
      [],
      ASOF,
    );
    expect(r.label).toBe('Unknown');
    expect(r.knownQty).toBe(0);
    expect(r.unknownQty).toBe(10);
    expect(r.unknownLoss).toBeCloseTo(1000, 6);
    expect(r.shortTermLoss).toBe(0);
    expect(r.longTermLoss).toBe(0);
    expect(r.estimatedSavings).toBe(0);
    expect(r.effectiveRate).toBeNull();
  });

  it('uses FIFO order so the oldest shares cover the position first', () => {
    const lots = toTaxLots([
      lot({ id: 'old', filledAt: '2024-01-10T00:00:00Z', priceAtFill: 100, qty: 4, remainingQty: 4 }),
      lot({ id: 'new', filledAt: '2026-06-10T00:00:00Z', priceAtFill: 200, qty: 4, remainingQty: 4 }),
    ] as any);
    // Only 4 shares held → FIFO consumes the old lot only.
    const r = computePositionHoldingPeriod(
      { symbol: 'TEST', qty: 4, avgCost: 150, currentPrice: 90, marketValue: 360 },
      lots,
      ASOF,
    );
    expect(r.knownQty).toBe(4);
    expect(r.longTermQty).toBe(4);
    expect(r.shortTermQty).toBe(0);
    expect(r.unknownQty).toBe(0);
  });

  it('leaves the uncovered remainder in the unknown bucket', () => {
    const lots = toTaxLots([
      lot({ id: 'old', filledAt: '2024-01-10T00:00:00Z', priceAtFill: 100, qty: 3, remainingQty: 3 }),
    ] as any);
    const r = computePositionHoldingPeriod(
      { symbol: 'TEST', qty: 10, avgCost: 150, currentPrice: 90, marketValue: 900 },
      lots,
      ASOF,
    );
    expect(r.knownQty).toBe(3);
    expect(r.unknownQty).toBe(7);
    expect(r.longTermLoss).toBeCloseTo(30, 6); // 3 × (100 − 90)
    expect(r.unknownLoss).toBeCloseTo(7 * 60, 6); // 7 × (150 − 90) avg-cost based
    expect(r.estimatedSavings).toBeCloseTo(30 * LONG_TERM_ASSUMED_RATE, 6);
  });

  it('reports no loss when shares are profitable', () => {
    const lots = toTaxLots([
      lot({ id: 'old', filledAt: '2024-01-10T00:00:00Z', priceAtFill: 50, qty: 10, remainingQty: 10 }),
    ] as any);
    const r = computePositionHoldingPeriod(
      { symbol: 'WIN', qty: 10, avgCost: 50, currentPrice: 90, marketValue: 900 },
      lots,
      ASOF,
    );
    expect(r.longTermLoss).toBe(0);
    expect(r.estimatedSavings).toBe(0);
    expect(r.effectiveRate).toBeNull();
  });

  it('ignores lots with an unusable acquisition date', () => {
    const r = computePositionHoldingPeriod(
      { symbol: 'BAD', qty: 5, avgCost: 100, currentPrice: 50, marketValue: 250 },
      [{ id: 'x', qty: 5, remainingQty: 5, priceAtFill: 100, filledAt: 'garbage' }],
      ASOF,
    );
    expect(r.knownQty).toBe(0);
    expect(r.unknownQty).toBe(5);
  });
});

describe('summarizeTaxEstimate', () => {
  it('rolls up short/long/unknown buckets and position counts', () => {
    const mixed = computePositionHoldingPeriod(
      { symbol: 'A', qty: 10, avgCost: 150, currentPrice: 90, marketValue: 900 },
      toTaxLots([
        lot({ id: 'o', filledAt: '2024-01-10T00:00:00Z', priceAtFill: 100, qty: 5, remainingQty: 5 }),
        lot({ id: 'n', filledAt: '2026-06-10T00:00:00Z', priceAtFill: 200, qty: 5, remainingQty: 5 }),
      ] as any),
      ASOF,
    );
    const unknown = computePositionHoldingPeriod(
      { symbol: 'B', qty: 2, avgCost: 100, currentPrice: 60, marketValue: 120 },
      [],
      ASOF,
    );
    const s = summarizeTaxEstimate([mixed, unknown]);
    expect(s.totalLosses).toBeCloseTo(50 + 550 + 80, 6);
    expect(s.shortTermLoss).toBeCloseTo(550, 6);
    expect(s.longTermLoss).toBeCloseTo(50, 6);
    expect(s.unknownLoss).toBeCloseTo(80, 6);
    expect(s.estimatedSavings).toBeCloseTo(550 * 0.24 + 50 * 0.15, 6);
    expect(s.classifiedPositionCount).toBe(1);
    expect(s.unclassifiedPositionCount).toBe(1);
    expect(s.mixedPositionCount).toBe(1);
  });

  it('handles an empty portfolio', () => {
    const s = summarizeTaxEstimate([]);
    expect(s.totalLosses).toBe(0);
    expect(s.estimatedSavings).toBe(0);
    expect(s.unclassifiedPositionCount).toBe(0);
  });
});

describe('annualSavingsRange', () => {
  it('projects a 25%–50% slice of the rate-corrected estimate', () => {
    expect(annualSavingsRange(100)).toEqual({ low: 25, high: 50 });
  });

  it('returns null when there is nothing to project', () => {
    expect(annualSavingsRange(0)).toBeNull();
    expect(annualSavingsRange(-10)).toBeNull();
    expect(annualSavingsRange(NaN)).toBeNull();
  });
});
