import { describe, expect, it } from 'vitest';
import { buildWaterfallFromRecords } from '@/lib/portfolio/pnl-waterfall';
import type { ActivityRecord } from '@/lib/tax-harvest/lot-reconstruction';

const WINDOW = { start: '2024-01-01T00:00:00.000Z', end: '2024-06-01T00:00:00.000Z' };

/** A small, fully-typed activity fixture: buys, a partial sell, income, fees. */
const RECORDS: ActivityRecord[] = [
  { symbol: 'AAPL', type: 'BUY', units: 10, price: 100, trade_date: '2024-01-05T00:00:00.000Z', fee: 1 },
  { symbol: 'AAPL', type: 'SELL', units: 4, price: 120, trade_date: '2024-02-10T00:00:00.000Z', fee: 1 },
  { symbol: 'AAPL', type: 'DIVIDEND', units: 0, price: 0, trade_date: '2024-03-15T00:00:00.000Z', amount: 25 },
  { symbol: 'AAPL', type: 'FEE', units: 0, price: 0, trade_date: '2024-04-01T00:00:00.000Z', amount: 5 },
  { symbol: 'MSFT', type: 'BUY', units: 2, price: 300, trade_date: '2024-01-20T00:00:00.000Z' },
];

describe('buildWaterfallFromRecords', () => {
  it('returns null when there is no usable activity history', () => {
    expect(buildWaterfallFromRecords([], 10_000, WINDOW)).toBeNull();
  });

  it('builds start → gains → income → fees → end steps', () => {
    const result = buildWaterfallFromRecords(RECORDS, 10_000, WINDOW);
    expect(result).not.toBeNull();
    const kinds = result!.steps.map((s) => s.kind);
    expect(kinds[0]).toBe('start');
    expect(kinds[kinds.length - 1]).toBe('end');
    expect(kinds).toContain('gain');
    expect(kinds).toContain('income');
    expect(kinds).toContain('fee');
  });

  it('NEVER synthesises a starting balance — the start step has delta null', () => {
    const result = buildWaterfallFromRecords(RECORDS, 10_000, WINDOW)!;
    expect(result.unknownStart).toBe(true);
    expect(result.steps[0].kind).toBe('start');
    expect(result.steps[0].delta).toBeNull();
    // The start label is the honest unknown-start disclosure.
    expect(result.steps[0].label).toMatch(/Unknown start/i);
    expect(result.steps[0].label).toMatch(/before/i);
  });

  it('computes realised gains from the on-file FIFO replay', () => {
    const result = buildWaterfallFromRecords(RECORDS, 10_000, WINDOW)!;
    const gain = result.steps.find((s) => s.kind === 'gain')!;
    // Bought 10 @ 100; sold 4 @ 120 → (4 × 120 − 1) − 4 × 100 = 79.
    expect(gain.delta).toBe(79);
  });

  it('nets income positively and fees negatively, ends at current equity', () => {
    const result = buildWaterfallFromRecords(RECORDS, 10_000, WINDOW)!;
    const income = result.steps.find((s) => s.kind === 'income')!;
    const fee = result.steps.find((s) => s.kind === 'fee')!;
    const end = result.steps.find((s) => s.kind === 'end')!;
    expect(income.delta).toBe(25);
    expect(fee.delta).toBeLessThan(0);
    expect(end.delta).toBe(10_000);
  });

  it('carries a disclosure note referencing the on-file window and the unknown start', () => {
    const result = buildWaterfallFromRecords(RECORDS, 10_000, WINDOW)!;
    expect(result.note).toMatch(/2024-01-01/);
    expect(result.note).toMatch(/starting balance is not shown/i);
    expect(result.windowStart).toBe('2024-01-01T00:00:00.000Z');
  });

  it('flags a partial realised gain when a sell cannot be fully matched', () => {
    const partial: ActivityRecord[] = [
      { symbol: 'TSLA', type: 'BUY', units: 2, price: 200, trade_date: '2024-01-05T00:00:00.000Z' },
      { symbol: 'TSLA', type: 'SELL', units: 5, price: 250, trade_date: '2024-02-05T00:00:00.000Z' },
    ];
    const result = buildWaterfallFromRecords(partial, 5_000, WINDOW)!;
    const gain = result.steps.find((s) => s.kind === 'gain')!;
    expect(gain.partial).toBe(true);
    expect(result.note).toMatch(/matched against buys on file/i);
  });

  it('survives an activity window with no known start date', () => {
    const result = buildWaterfallFromRecords(RECORDS, 10_000, { start: null, end: null })!;
    expect(result.steps[0].delta).toBeNull();
    expect(result.steps[0].label).toMatch(/earliest record on file/i);
  });
});
