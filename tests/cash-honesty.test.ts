// Cash honesty — the broker's silence is UNKNOWN, never $0.
//
// Two rules are pinned here, both learned the hard way this session:
//   1. A balances field the broker did not report (or a balances call that
//      failed) must not become a 0. A partial sum presented as a total is the
//      same fabrication, just harder to spot.
//   2. When cash is unknown, everything cash-derived (total value, day-change %)
//      is unknown too — you cannot divide by a number you do not have.
//
// Companion of `lib/broker/live-account-cash.ts` (which kills the connect-time
// snapshot as a cash source) and of the `availableCashOrNull` helper.

import { describe, it, expect } from 'vitest';
import { computeAccountSummary, sumBalancesHonest } from '@/lib/broker/account-summary';
import { availableCash, availableCashOrNull } from '@/lib/available-cash';

const POS = (over: Partial<{ units: number; price: number; costBasisPerUnit: number; dayChange: number | null }> = {}) => ({
  symbol: 'SPY',
  name: 'SPDR S&P 500',
  units: 10,
  price: 100,
  costBasisPerUnit: 90,
  dayChange: 2,
  ...over,
});

describe('sumBalancesHonest — a missing field is UNKNOWN, not 0', () => {
  it('sums what the broker reported', () => {
    const out = sumBalancesHonest([
      [{ cash: 100.5, buying_power: 200 }],
      [{ cash: 20, buying_power: 5 }],
    ]);
    expect(out).toEqual({ cash: 120.5, buyingPower: 205 });
  });

  it('a failed account fetch poisons BOTH totals (never a partial total)', () => {
    const out = sumBalancesHonest([[{ cash: 100, buying_power: 300 }], null]);
    expect(out.cash).toBeNull();
    expect(out.buyingPower).toBeNull();
  });

  it('an empty balances response is UNKNOWN, not 0', () => {
    expect(sumBalancesHonest([[]])).toEqual({ cash: null, buyingPower: null });
    expect(sumBalancesHonest([])).toEqual({ cash: null, buyingPower: null });
  });

  it('a row with cash: null leaves cash UNKNOWN while buying power still totals', () => {
    const out = sumBalancesHonest([[{ cash: null, buying_power: 42 }], [{ cash: 10, buying_power: 1 }]]);
    expect(out.cash).toBeNull();
    expect(out.buyingPower).toBe(43);
  });

  it('a row omitting buying_power (non-margin) leaves buying power UNKNOWN', () => {
    const out = sumBalancesHonest([[{ cash: 10 }]]);
    expect(out.cash).toBe(10);
    expect(out.buyingPower).toBeNull();
  });

  it('treats a real 0 as KNOWN', () => {
    const out = sumBalancesHonest([[{ cash: 0, buying_power: 0 }]]);
    expect(out).toEqual({ cash: 0, buyingPower: 0 });
  });

  it('ignores NaN / Infinity instead of adding them', () => {
    const out = sumBalancesHonest([[{ cash: Number.NaN, buying_power: Number.POSITIVE_INFINITY }]]);
    expect(out).toEqual({ cash: null, buyingPower: null });
  });
});

describe('computeAccountSummary — unknown cash cannot produce a total', () => {
  it('unknown cash ⇒ cash null, totalValue null, day-change % null', () => {
    const t = computeAccountSummary(null, null, [POS()]);
    expect(t.cash).toBeNull();
    expect(t.totalValue).toBeNull();
    expect(t.dayChangePct).toBeNull();
    expect(t.marketValue).toBe(1000); // positions are still real
    expect(t.dayChange).toBe(2);
  });

  it('known cash ⇒ total = cash + marketValue', () => {
    const t = computeAccountSummary(250, null, [POS()]);
    expect(t.cash).toBe(250);
    expect(t.totalValue).toBe(1250);
    expect(t.buyingPower).toBeNull();
    // rounded to 2dp by the shared helper
    expect(t.dayChangePct).toBeCloseTo(0.16, 6);
  });

  it('keeps the day-change percentage when cash is known and no day change exists', () => {
    const t = computeAccountSummary(250, null, [POS({ dayChange: null })]);
    expect(t.dayChange).toBeNull();
    expect(t.dayChangePct).toBeNull();
    expect(t.totalValue).toBe(1250);
  });

  it('never rounds a null into a number', () => {
    const t = computeAccountSummary(null, null, []);
    expect(t.cash).toBeNull();
    expect(t.buyingPower).toBeNull();
    expect(t.totalValue).toBeNull();
    expect(t.invested).toBe(0); // an empty book is genuinely 0
    expect(t.marketValue).toBe(0);
  });
});

describe('availableCashOrNull vs availableCash', () => {
  it('null when the broker reported neither field', () => {
    expect(availableCashOrNull({ cash: null, buyingPower: null })).toBeNull();
    expect(availableCashOrNull(null)).toBeNull();
    expect(availableCashOrNull({})).toBeNull();
  });

  it('prefers settled cash and still subtracts open reservations', () => {
    expect(availableCashOrNull({ cash: 1000, buyingPower: 5000 }, 400)).toBe(600);
  });

  it('falls back to buying power only when cash is absent', () => {
    expect(availableCashOrNull({ cash: null, buyingPower: 5000 }, 400)).toBe(4600);
  });

  it('a real 0 stays 0 (known-empty), never null', () => {
    expect(availableCashOrNull({ cash: 0, buyingPower: 5000 })).toBe(0);
  });

  it('availableCash keeps its fail-safe numeric fallback for comparisons', () => {
    expect(availableCash({ cash: null, buyingPower: null })).toBe(0);
    expect(availableCash({ cash: 50 }, 20)).toBe(30);
  });
});
