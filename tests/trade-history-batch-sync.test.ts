// planTradeHistoryBatch — what the batched sync is allowed to write.
//
// The batch endpoint exists to turn 35–36 sequential per-order POSTs per page
// load into ONE request. The write RULE must not change with it: it has to match
// exactly what POST /api/db/trade-history/create matches on
// (user + symbol + action + quantity + price — no execution timestamp), or the
// batch would insert rows the single route would have skipped.

import { describe, it, expect } from 'vitest';
import { planTradeHistoryBatch, tradeMatchKey } from '@/lib/db/trade-history';

const order = (over: Record<string, unknown> = {}) => ({
  symbol: 'KO', action: 'buy', quantity: 1, price: 10, executedAt: '2026-09-16T14:00:00Z', ...over,
});

describe('tradeMatchKey', () => {
  it('ignores the execution timestamp (parity with the single-order route)', () => {
    expect(tradeMatchKey({ symbol: 'ko', action: 'buy', quantity: 1, price: 10 }))
      .toBe(tradeMatchKey({ symbol: 'KO', action: 'buy', quantity: 1, price: 10, executedAt: '2020-01-01T00:00:00Z' }));
  });

  it('changes with symbol, side, size or price', () => {
    const base = tradeMatchKey({ symbol: 'KO', action: 'buy', quantity: 1, price: 10 });
    expect(tradeMatchKey({ symbol: 'MSFT', action: 'buy', quantity: 1, price: 10 })).not.toBe(base);
    expect(tradeMatchKey({ symbol: 'KO', action: 'sell', quantity: 1, price: 10 })).not.toBe(base);
    expect(tradeMatchKey({ symbol: 'KO', action: 'buy', quantity: 2, price: 10 })).not.toBe(base);
    expect(tradeMatchKey({ symbol: 'KO', action: 'buy', quantity: 1, price: 11 })).not.toBe(base);
  });

  it('accepts the broker aliases (side/qty)', () => {
    expect(tradeMatchKey({ symbol: 'KO', side: 'buy', qty: 1, price: 10 }))
      .toBe(tradeMatchKey({ symbol: 'KO', action: 'buy', quantity: 1, price: 10 }));
  });
});

describe('planTradeHistoryBatch', () => {
  it('inserts only orders the table does not already hold', () => {
    const plan = planTradeHistoryBatch(
      [{ symbol: 'KO', action: 'buy', quantity: 1, price: 10 }],
      [order(), order({ symbol: 'MSFT' })],
    );
    expect(plan.missing.map((m) => m.symbol)).toEqual(['MSFT']);
    expect(plan.existing).toBe(1);
    expect(plan.invalid).toBe(0);
    expect(plan.duplicatesInBatch).toBe(0);
  });

  it('matches an existing row even when the execution time differs', () => {
    const plan = planTradeHistoryBatch(
      [{ symbol: 'KO', action: 'buy', quantity: 1, price: 10 }],
      [order({ executedAt: '2026-09-17T09:30:00Z' })],
    );
    expect(plan.missing).toHaveLength(0);
  });

  it('counts duplicates inside the payload once, and inserts once', () => {
    const plan = planTradeHistoryBatch([], [order(), order(), order()]);
    expect(plan.missing).toHaveLength(1);
    expect(plan.duplicatesInBatch).toBe(2);
  });

  it('rejects invalid rows instead of writing them, and reports the count', () => {
    const plan = planTradeHistoryBatch([], [
      order(),
      order({ symbol: '' }),
      order({ action: 'hold' }),
      order({ quantity: 0 }),
      order({ quantity: -3 }),
      order({ price: 0 }),
      order({ price: NaN }),
    ]);
    expect(plan.missing).toHaveLength(1);
    expect(plan.invalid).toBe(6);
  });

  it('normalises symbol case before matching', () => {
    const plan = planTradeHistoryBatch([{ symbol: 'ko', action: 'buy', quantity: 1, price: 10 }], [order()]);
    expect(plan.missing).toHaveLength(0);
  });

  it('caps the batch at max', () => {
    const many = Array.from({ length: 12 }, (_, i) => order({ symbol: `S${i}` }));
    const plan = planTradeHistoryBatch([], many, { max: 5 });
    expect(plan.missing).toHaveLength(5);
  });

  it('carries the execution time onto the insert row', () => {
    const plan = planTradeHistoryBatch([], [order({ executedAt: '2026-09-17T09:30:00Z' })]);
    expect(plan.missing[0].executedAt).toBe('2026-09-17T09:30:00Z');
  });

  it('an empty batch plans nothing', () => {
    const plan = planTradeHistoryBatch([{ symbol: 'KO', action: 'buy', quantity: 1, price: 10 }], []);
    expect(plan.missing).toHaveLength(0);
    expect(plan.invalid).toBe(0);
  });
});
