// POST /api/db/trade-history/sync-batch — the batched write path.
//
// Batch size is a perf concern; correctness is not negotiable. In particular a
// response of 200 must mean "written" — a failed read/insert must never be
// reported as success (that is the silent-write-failure class this codebase has
// already been bitten by).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  selectRows: [] as any[],
  readError: null as any,
  insertError: null as any,
  insertCalls: [] as any[][],
  readCount: 0,
  accountCalls: [] as any[],
}));

vi.mock('@/lib/auth/get-server-user', () => ({ requireAuth: h.requireAuth }));
vi.mock('@/lib/broker/account-id', () => ({
  resolveBrokerAccountIdForWrite: vi.fn(async (_sb: unknown, args: any) => {
    h.accountCalls.push(args);
    return 'acct-1';
  }),
}));
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from() {
      const b: any = {
        select: () => b,
        eq: () => b,
        in: () => b,
        limit: () => {
          h.readCount += 1;
          return Promise.resolve({ data: h.selectRows, error: h.readError });
        },
        insert: (rows: any[]) => {
          h.insertCalls.push(rows);
          return {
            select: () =>
              Promise.resolve({
                data: h.insertError ? null : rows.map((r, i) => ({ ...r, id: `th-${i}`, created_at: '2026-09-17T00:00:00Z' })),
                error: h.insertError,
              }),
          };
        },
      };
      return b;
    },
  }),
}));

import { POST } from '@/app/api/db/trade-history/sync-batch/route';

const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const order = (over: Record<string, unknown> = {}) => ({
  symbol: 'KO', action: 'buy', quantity: 1, price: 10, executedAt: '2026-09-16T14:00:00Z', ...over,
});
const post = (body: unknown) => POST({ json: async () => body } as any);

beforeEach(() => {
  h.selectRows = [];
  h.readError = null;
  h.insertError = null;
  h.insertCalls = [];
  h.readCount = 0;
  h.accountCalls = [];
  h.requireAuth.mockReset();
  h.requireAuth.mockResolvedValue({ authUser: { id: USER }, authError: null });
});

describe('POST /api/db/trade-history/sync-batch', () => {
  it('writes the whole batch in ONE insert and stamps the account once', async () => {
    const res = await post({
      userId: USER, connectionId: 'conn-1', snapAccountId: 'snap-1',
      orders: [order(), order({ symbol: 'MSFT' }), order({ symbol: 'SPY' })],
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.inserted).toBe(3);
    expect(h.insertCalls).toHaveLength(1);
    expect(h.insertCalls[0]).toHaveLength(3);
    expect(h.insertCalls[0][0]).toMatchObject({
      user_id: USER, symbol: 'KO', action: 'buy', quantity: 1, price: 10, connection_id: 'conn-1', account_id: 'acct-1',
    });
    // One account resolve for the batch — not one per order.
    expect(h.accountCalls).toHaveLength(1);
    expect(h.accountCalls[0]).toMatchObject({ connectionId: 'conn-1', snapAccountId: 'snap-1' });
  });

  it('skips orders the table already holds', async () => {
    h.selectRows = [{ symbol: 'KO', action: 'buy', quantity: 1, price: 10 }];
    const res = await post({ userId: USER, orders: [order(), order({ symbol: 'MSFT' })] });
    const json = await res.json();
    expect(json.inserted).toBe(1);
    expect(json.existing).toBe(1);
    expect(h.insertCalls[0]).toHaveLength(1);
    expect(h.insertCalls[0][0].symbol).toBe('MSFT');
  });

  it('writes nothing (and reads nothing) when there is nothing to sync', async () => {
    const res = await post({ userId: USER, orders: [] });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.inserted).toBe(0);
    expect(h.insertCalls).toHaveLength(0);
    expect(h.readCount).toBe(0);
  });

  it('never reports success when the insert fails', async () => {
    h.insertError = { message: 'duplicate key value violates unique constraint' };
    const res = await post({ userId: USER, orders: [order()] });
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toContain('duplicate key');
  });

  it('never inserts when the dedupe read fails (unknown state is not empty state)', async () => {
    h.readError = { message: 'boom' };
    const res = await post({ userId: USER, orders: [order()] });
    expect(res.status).toBe(500);
    expect(h.insertCalls).toHaveLength(0);
  });

  it('refuses to write trades for another user', async () => {
    const res = await post({ userId: 'someone-else', orders: [order()] });
    expect(res.status).toBe(403);
    expect(h.insertCalls).toHaveLength(0);
  });

  it('counts invalid orders instead of writing them', async () => {
    const res = await post({
      userId: USER,
      orders: [order(), order({ quantity: 0 }), order({ action: 'hold' }), order({ symbol: '' })],
    });
    const json = await res.json();
    expect(json.inserted).toBe(1);
    expect(json.invalid).toBe(3);
    expect(h.insertCalls[0]).toHaveLength(1);
  });

  it('dedupes repeats inside one payload', async () => {
    const res = await post({ userId: USER, orders: [order(), order()] });
    const json = await res.json();
    expect(json.inserted).toBe(1);
    expect(json.duplicatesInBatch).toBe(1);
  });

  it('requires an orders array', async () => {
    const res = await post({ userId: USER });
    expect(res.status).toBe(400);
  });
});
