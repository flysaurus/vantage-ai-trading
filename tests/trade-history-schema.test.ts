// ─── trade_history schema contract ──────────────────────────────────────────
// Locks the column names and the row/insert mapping. These routes shipped
// asking PostgREST for `total_value`, `side`, `qty`, `filled_price`, `status`,
// `filled_at` and `alpaca_order_id` — none of which exist on the table — so
// get-all/get-single/create/sync all returned 500 on EVERY request and the
// trade-history page silently rendered empty. The real column list below is
// the one PostgREST reports for `trade_history` (2026-09-12).

import { describe, it, expect } from 'vitest';
import {
  TRADE_HISTORY_COLUMNS,
  TRADE_HISTORY_SELECT,
  toTradeRecord,
  toTradeInsert,
  tradeDedupeKey,
} from '@/lib/db/trade-history';

/** The actual PostgREST column set for `trade_history`. */
const REAL_SCHEMA = [
  'action',
  'commission',
  'connection_id',
  'created_at',
  'executed_at',
  'id',
  'is_demo',
  'notes',
  'price',
  'quantity',
  'symbol',
  'updated_at',
  'user_id',
];

/** Columns the broken routes used to reference. None of them exist. */
const PHANTOM_COLUMNS = ['total_value', 'side', 'qty', 'filled_price', 'filled_at', 'status', 'alpaca_order_id', 'type'];

describe('trade_history columns', () => {
  it('matches the real table, column for column', () => {
    expect([...TRADE_HISTORY_COLUMNS].sort()).toEqual([...REAL_SCHEMA].sort());
  });

  it('the SELECT string names only real columns', () => {
    const selected = TRADE_HISTORY_SELECT.split(',').map((s) => s.trim());
    expect(selected.length).toBeGreaterThan(0);
    for (const col of selected) expect(REAL_SCHEMA).toContain(col);
  });

  it('no phantom column appears anywhere in the shared schema module', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('lib/db/trade-history.ts', 'utf8'),
    );
    // The names may be *mentioned* in comments explaining the old bug, but never
    // as an identifier being selected or inserted.
    for (const col of PHANTOM_COLUMNS) {
      expect(src).not.toMatch(new RegExp(`select\\([^)]*${col}`, 'i'));
      expect(src).not.toMatch(new RegExp(`\\b${col}:\\s`, 'i'));
    }
  });

  it('every route under api/db/trade-history selects via the shared constant', async () => {
    const fs = await import('node:fs');
    for (const f of ['get-all', 'get-single', 'create', 'sync']) {
      const src = fs.readFileSync(`app/api/db/trade-history/${f}/route.ts`, 'utf8');
      expect(src).toContain('TRADE_HISTORY_SELECT');
      for (const col of PHANTOM_COLUMNS) {
        expect(src).not.toMatch(new RegExp(`select\\([^)]*${col}`, 'i'));
      }
    }
  });
});

describe('toTradeRecord', () => {
  it('derives totalValue as quantity × price (there is no such column)', () => {
    const rec = toTradeRecord({
      id: 't1', user_id: 'u1', symbol: 'nvda', action: 'buy',
      quantity: '2.5', price: '410.20', commission: '1', notes: null,
      executed_at: '2026-08-27T14:00:00Z', created_at: '2026-08-27T14:00:01Z',
      is_demo: false, connection_id: 'c1',
    });
    expect(rec.symbol).toBe('NVDA');
    expect(rec.quantity).toBe(2.5);
    expect(rec.price).toBe(410.2);
    expect(rec.totalValue).toBeCloseTo(1025.5, 6);
    expect(rec.executedAt).toBe('2026-08-27T14:00:00Z');
    expect(rec.connectionId).toBe('c1');
    expect(rec.isDemo).toBe(false);
  });

  it('coerces numeric strings and survives nulls without NaN', () => {
    const rec = toTradeRecord({ id: 't2', symbol: 'qqq', quantity: null, price: null });
    expect(rec.quantity).toBe(0);
    expect(rec.price).toBe(0);
    expect(rec.totalValue).toBe(0);
    expect(Number.isNaN(rec.totalValue)).toBe(false);
  });
});

describe('toTradeInsert', () => {
  it('emits only real columns', () => {
    const row = toTradeInsert(
      { symbol: 'amd', action: 'sell', quantity: 3, price: 150, commission: 0.5, notes: 'x', executedAt: '2026-09-01T00:00:00Z' },
      { userId: 'u1', connectionId: 'c9', isDemo: false },
    );
    for (const key of Object.keys(row)) expect(REAL_SCHEMA).toContain(key);
    expect(row.symbol).toBe('AMD');
    expect(row.action).toBe('sell');
    expect(row.quantity).toBe(3);
    expect(row.price).toBe(150);
    expect(row.user_id).toBe('u1');
    expect(row.connection_id).toBe('c9');
  });

  it('folds legacy callers’ alias fields into the real ones', () => {
    const row = toTradeInsert(
      { symbol: 'spy', side: 'buy', qty: 1, filled_price: 500, filled_at: '2026-09-02T00:00:00Z' },
      { userId: 'u1' },
    );
    expect(row.action).toBe('buy');
    expect(row.quantity).toBe(1);
    expect(row.price).toBe(500);
    expect(row.executed_at).toBe('2026-09-02T00:00:00Z');
    expect((row as any).side).toBeUndefined();
    expect((row as any).qty).toBeUndefined();
    expect((row as any).filled_price).toBeUndefined();
  });

  it('never writes a phantom total_value / status column', () => {
    const row = toTradeInsert(
      { symbol: 'spy', action: 'buy', quantity: 2, price: 10 },
      { userId: 'u1' },
    );
    expect((row as any).total_value).toBeUndefined();
    expect((row as any).status).toBeUndefined();
  });
});

describe('tradeDedupeKey', () => {
  it('recognises a re-synced order from its own fields (no order-id column)', () => {
    const a = tradeDedupeKey({ symbol: 'nvda', action: 'buy', quantity: 2, price: 410.2, executed_at: '2026-08-27T14:00:00.123Z' });
    const b = tradeDedupeKey({ symbol: 'NVDA', side: 'buy', qty: '2', price: '410.2', filled_at: '2026-08-27T14:00:00.900Z' });
    expect(a).toBe(b);
  });

  it('distinguishes different trades', () => {
    const a = tradeDedupeKey({ symbol: 'nvda', action: 'buy', quantity: 2, price: 410.2, executed_at: '2026-08-27T14:00:00Z' });
    const b = tradeDedupeKey({ symbol: 'nvda', action: 'sell', quantity: 2, price: 410.2, executed_at: '2026-08-27T14:00:00Z' });
    expect(a).not.toBe(b);
  });
});
