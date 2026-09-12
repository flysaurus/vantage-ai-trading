import { describe, it, expect } from 'vitest';
import {
  orderRowsToLots,
  groupLotsByTicker,
  scopedAccountFilter,
  scopedConnectionFilter,
  type PurchaseDateLotRow,
} from '@/lib/tax-harvest/purchase-dates';

// ─── Tiny chainable query recorder (jest-style stub) ──────────
// Every builder method returns the same stub so we can assert which
// column/value the scope helpers applied without a real Supabase client.
function makeQuery() {
  const calls: Array<{ method: string; column: string; value: unknown }> = [];
  const q: any = {
    eq(column: string, value: unknown) {
      calls.push({ method: 'eq', column, value });
      return q;
    },
    is(column: string, value: unknown) {
      calls.push({ method: 'is', column, value });
      return q;
    },
  };
  return { q, calls };
}

const lot = (over: Partial<PurchaseDateLotRow>): PurchaseDateLotRow => ({
  id: 'x',
  ticker: 'AAPL',
  qty: 1,
  remainingQty: 1,
  priceAtFill: 10,
  filledAt: '2024-01-01T00:00:00.000Z',
  source: 'orders',
  ...over,
});

describe('orderRowsToLots', () => {
  it('keeps only buy-side rows (case-insensitive)', () => {
    const rows = [
      { id: '1', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10, filled_at: '2024-01-02T00:00:00Z' },
      { id: '2', symbol: 'AAPL', side: 'sell', qty: 1, filled_price: 10, filled_at: '2024-01-03T00:00:00Z' },
      { id: '3', symbol: 'AAPL', side: 'BUY', qty: 1, filled_price: 10, filled_at: '2024-01-04T00:00:00Z' },
      { id: '4', symbol: 'AAPL', side: 'buy_to_cover', qty: 1, filled_price: 10, filled_at: '2024-01-05T00:00:00Z' },
      { id: '5', symbol: 'AAPL', side: 'buy_to_open', qty: 1, filled_price: 10, filled_at: '2024-01-06T00:00:00Z' },
    ];
    const lots = orderRowsToLots(rows);
    expect(lots).toHaveLength(3);
    expect(lots.map((l) => l.id)).toEqual(['1', '3', '4']);
    expect(lots.every((l) => l.source === 'orders')).toBe(true);
  });

  it('prefers filled_qty over qty', () => {
    const lots = orderRowsToLots([
      { id: '1', symbol: 'AAPL', side: 'buy', qty: 9, filled_qty: 4, filled_price: 10, filled_at: '2024-01-02T00:00:00Z' },
    ]);
    expect(lots[0].qty).toBe(4);
    expect(lots[0].remainingQty).toBe(4);
  });

  it('falls back to qty when filled_qty is null', () => {
    const lots = orderRowsToLots([
      { id: '1', symbol: 'AAPL', side: 'buy', qty: 7, filled_qty: null, filled_price: 10, filled_at: '2024-01-02T00:00:00Z' },
    ]);
    expect(lots[0].qty).toBe(7);
  });

  it('prefers filled_at over created_at', () => {
    const lots = orderRowsToLots([
      {
        id: '1',
        symbol: 'AAPL',
        side: 'buy',
        qty: 1,
        filled_price: 10,
        filled_at: '2024-03-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(lots[0].filledAt).toBe('2024-03-01T00:00:00Z');
  });

  it('falls back to created_at when filled_at is missing', () => {
    const lots = orderRowsToLots([
      { id: '1', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10, filled_at: null, created_at: '2024-02-01T00:00:00Z' },
    ]);
    expect(lots[0].filledAt).toBe('2024-02-01T00:00:00Z');
  });

  it('drops zero-qty, zero-price and dateless rows', () => {
    const lots = orderRowsToLots([
      { id: 'q0', symbol: 'AAPL', side: 'buy', qty: 0, filled_price: 10, filled_at: '2024-01-01T00:00:00Z' },
      { id: 'p0', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 0, filled_at: '2024-01-01T00:00:00Z' },
      { id: 'nodate', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10, filled_at: null, created_at: null },
      { id: 'ok', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10, filled_at: '2024-01-01T00:00:00Z' },
    ]);
    expect(lots).toHaveLength(1);
    expect(lots[0].id).toBe('ok');
  });

  it('sorts lots oldest-first', () => {
    const lots = orderRowsToLots([
      { id: 'c', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10, filled_at: '2024-03-01T00:00:00Z' },
      { id: 'a', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10, filled_at: '2024-01-01T00:00:00Z' },
      { id: 'b', symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10, filled_at: '2024-02-01T00:00:00Z' },
    ]);
    expect(lots.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('tolerates null / undefined / empty input', () => {
    expect(orderRowsToLots(null)).toEqual([]);
    expect(orderRowsToLots(undefined)).toEqual([]);
    expect(orderRowsToLots([])).toEqual([]);
  });
});

describe('groupLotsByTicker', () => {
  it('uppercases tickers and preserves oldest-first order', () => {
    const grouped = groupLotsByTicker([
      lot({ id: '1', ticker: 'aapl', filledAt: '2024-01-01T00:00:00Z' }),
      lot({ id: '2', ticker: 'AAPL', filledAt: '2024-02-01T00:00:00Z' }),
    ]);
    expect(Object.keys(grouped)).toEqual(['AAPL']);
    expect(grouped.AAPL.map((l) => l.id)).toEqual(['1', '2']);
  });

  it('skips blank tickers', () => {
    const grouped = groupLotsByTicker([
      lot({ id: '1', ticker: '' }),
      lot({ id: '2', ticker: '   ' }),
      lot({ id: '3', ticker: 'MSFT' }),
    ]);
    expect(Object.keys(grouped)).toEqual(['MSFT']);
    expect(grouped.MSFT).toHaveLength(1);
  });

  it('tolerates null / undefined input', () => {
    expect(groupLotsByTicker(null)).toEqual({});
    expect(groupLotsByTicker(undefined)).toEqual({});
  });
});

describe('scopedAccountFilter', () => {
  it('applies .eq(account_id, connectionId) for a live connection', () => {
    const { q, calls } = makeQuery();
    const uuid = '11111111-2222-4333-8444-555555555555';
    const returned = scopedAccountFilter(q, { connectionId: uuid, isDemo: false });
    expect(returned).toBe(q);
    expect(calls).toEqual([{ method: 'eq', column: 'account_id', value: uuid }]);
  });

  it('applies .is(account_id, null) for demo', () => {
    const { q, calls } = makeQuery();
    scopedAccountFilter(q, { connectionId: null, isDemo: true });
    expect(calls).toEqual([{ method: 'is', column: 'account_id', value: null }]);
  });

  it('leaves the query untouched when neither is supplied', () => {
    const { q, calls } = makeQuery();
    const returned = scopedAccountFilter(q, { connectionId: null, isDemo: false });
    expect(returned).toBe(q);
    expect(calls).toHaveLength(0);
  });
});

describe('scopedConnectionFilter', () => {
  it('applies .eq(connection_id, connectionId) for a live connection', () => {
    const { q, calls } = makeQuery();
    const uuid = '11111111-2222-4333-8444-555555555555';
    scopedConnectionFilter(q, { connectionId: uuid, isDemo: false });
    expect(calls).toEqual([{ method: 'eq', column: 'connection_id', value: uuid }]);
  });

  it('applies .is(connection_id, null) for demo', () => {
    const { q, calls } = makeQuery();
    scopedConnectionFilter(q, { connectionId: null, isDemo: true });
    expect(calls).toEqual([{ method: 'is', column: 'connection_id', value: null }]);
  });

  it('leaves the query untouched when neither is supplied', () => {
    const { q, calls } = makeQuery();
    scopedConnectionFilter(q, {});
    expect(calls).toHaveLength(0);
  });

  it('prefers demo scope over a stale connectionId', () => {
    const { q, calls } = makeQuery();
    scopedConnectionFilter(q, { connectionId: 'ignored', isDemo: true });
    expect(calls).toEqual([{ method: 'is', column: 'connection_id', value: null }]);
  });
});
