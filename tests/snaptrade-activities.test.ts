import { describe, it, expect } from 'vitest';
import { normalizeActivityRow, activitiesWindow } from '@/lib/snaptrade/activities';

/**
 * Regression cover for the activity feed's normalisation + window maths.
 *
 * The live bug this guards against: the feed reported 742 rows but only 441
 * survived normalisation, which truncated the history window and would have
 * relabelled real, dated lots as "acquired before the window".
 */
describe('normalizeActivityRow', () => {
  it('keeps a BUY row with symbol object, units and price', () => {
    const rec = normalizeActivityRow({
      id: 'a1',
      symbol: { symbol: 'aapl', raw_symbol: 'AAPL' },
      type: 'BUY',
      units: 12,
      price: 186.4,
      trade_date: '2026-08-31T13:31:15Z',
    });
    expect(rec).not.toBeNull();
    expect(rec!.symbol).toBe('AAPL');
    expect(rec!.type).toBe('BUY');
    expect(rec!.units).toBe(12);
    expect(rec!.price).toBe(186.4);
    expect(rec!.trade_date).toBe('2026-08-31T13:31:15Z');
  });

  it('keeps a date-bearing row that has no symbol and no units (window bound)', () => {
    const rec = normalizeActivityRow({
      id: 'a2',
      type: 'FEE',
      amount: -1.25,
      trade_date: '2026-04-27T00:00:00Z',
    });
    expect(rec).not.toBeNull();
    expect(rec!.symbol).toBe('');
    expect(rec!.trade_date).toBe('2026-04-27T00:00:00Z');
  });

  it('drops a unit-bearing row with no symbol (unattributable)', () => {
    expect(normalizeActivityRow({ type: 'BUY', units: 5, trade_date: '2026-08-31' })).toBeNull();
  });

  it('drops a row with no date at all', () => {
    expect(normalizeActivityRow({ symbol: { symbol: 'AAPL' }, type: 'BUY', units: 1 })).toBeNull();
  });

  it('falls back to settlement_date when trade_date is missing', () => {
    const rec = normalizeActivityRow({
      symbol: { symbol: 'SPY' },
      type: 'BUY',
      units: 1,
      price: 740,
      settlement_date: '2026-05-18',
    });
    expect(rec!.trade_date).toBe('2026-05-18');
  });

  it('folds signed units to magnitude and uppercases the ticker', () => {
    const rec = normalizeActivityRow({
      symbol: { symbol: 'voo' },
      type: 'sell',
      units: -2,
      price: -680.27,
      trade_date: '2026-06-23',
    });
    expect(rec!.units).toBe(2);
    expect(rec!.price).toBe(680.27);
    expect(rec!.symbol).toBe('VOO');
    expect(rec!.type).toBe('SELL');
  });
});

describe('activitiesWindow', () => {
  it('spans every dated record, including symbol-less ones', () => {
    const win = activitiesWindow([
      { records: [{ trade_date: '2026-06-01' }, { trade_date: '2026-04-27' }] },
      { records: [{ trade_date: '2026-08-31' }] },
    ] as never);
    expect(win.start?.slice(0, 10)).toBe('2026-04-27');
    expect(win.end?.slice(0, 10)).toBe('2026-08-31');
  });

  it('returns nulls when nothing is dated', () => {
    const win = activitiesWindow([{ records: [] }] as never);
    expect(win.start).toBeNull();
    expect(win.end).toBeNull();
  });
});
