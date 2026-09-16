// ─── Part B §6 (item 4): the P&L waterfall must not merge a shared login ────
// SnapTrade returns activities PER AUTHORIZATION (`/authorizations/<id>/accounts`),
// so an unfiltered read of the Fidelity login blends "Taxable SMA" with
// "ANIKET - YOUTH" and charts the sum as one account's history.
//
// Rule: 2+ registered sub-accounts → read ONLY the active one; if the active
// sub-account cannot be resolved → report unavailable (null), never merge.
// 0–1 registered accounts → unchanged connection scope.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  fetchCalls: [] as any[],
  accountRows: null as any,
  connectionRows: null as any,
}));

vi.mock('@/lib/snaptrade/client', () => ({
  resolveSnapTradeCredentials: vi.fn(async () => ({
    snaptradeUserId: 'snap-user',
    snaptradeUserSecret: 'secret',
    connectionId: 'auth-1',
  })),
  SnapTradeAuthError: class SnapTradeAuthError extends Error {},
  SnapTradeAmbiguousError: class SnapTradeAmbiguousError extends Error {},
}));

vi.mock('@/lib/snaptrade/auth', () => ({
  snapTradeFetch: vi.fn(async () => [
    { id: 'sma-id', name: 'Taxable SMA' },
    { id: 'youth-id', name: 'ANIKET - YOUTH ACCOUNT' },
  ]),
}));

vi.mock('@/lib/snaptrade/activities', () => ({
  activitiesWindow: () => ({ start: '2026-01-02', end: '2026-09-01' }),
  fetchActivitiesForAuthorization: vi.fn(async (_u: string, _a: string, _ep: unknown, accounts: any[]) => {
    h.fetchCalls.push(accounts);
    return accounts.map((a) => ({
      accountId: a.id,
      records: [
        { type: 'BUY', symbol: 'KO', units: 10, price: 60, trade_date: '2026-02-01' },
        { type: 'DIVIDEND', symbol: 'KO', amount: 5, trade_date: '2026-03-01' },
      ],
    }));
  }),
}));

import { buildPnlWaterfall } from '@/lib/portfolio/pnl-waterfall';

const USER = 'u1';
const CONN = 'conn-1';
const SMA = 'sma-id';
const YOUTH = 'youth-id';

const client = () => ({
  from: (table: string) => ({
    select: () => ({
      eq: () => Promise.resolve({
        data: table === 'broker_accounts' ? h.accountRows : h.connectionRows,
        error: null,
      }),
    }),
  }),
});

beforeEach(() => {
  process.env.SNAPTRADE_CLIENT_ID = 'test-client';
  h.fetchCalls = [];
  h.accountRows = [
    { id: 'reg-sma', snaptrade_account_id: SMA },
    { id: 'reg-youth', snaptrade_account_id: YOUTH },
  ];
  h.connectionRows = [
    {
      id: CONN,
      snaptrade_connection_id: 'auth-1',
      snaptrade_accounts: [{ id: SMA, name: 'Taxable SMA' }, { id: YOUTH, name: 'ANIKET - YOUTH ACCOUNT' }],
    },
  ];
});

describe('buildPnlWaterfall — shared login account scoping', () => {
  it('reads ONLY the active sub-account (never the sibling)', async () => {
    const res = await buildPnlWaterfall(`snaptrade:${CONN}:${SMA}`, {
      userId: USER,
      connectionId: CONN,
      supabase: client() as any,
      equity: 377551,
    });
    expect(res).not.toBeNull();
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0].map((a: any) => a.id)).toEqual([SMA]);
    expect(res!.note).toMatch(/scoped to Taxable SMA only/);
    expect(res!.note).toMatch(/excluded rather than merged/);
  });

  it('an unresolvable sub-account on a shared login is UNAVAILABLE — no merge, no chart', async () => {
    const res = await buildPnlWaterfall(`snaptrade:${CONN}`, {
      userId: USER,
      connectionId: CONN,
      supabase: client() as any,
      equity: 377551,
    });
    expect(res).toBeNull();
    expect(h.fetchCalls).toHaveLength(0); // no activity was even requested
  });

  it('a sub-account id that matches no registered row is UNAVAILABLE', async () => {
    const res = await buildPnlWaterfall(`snaptrade:${CONN}:ghost-id`, {
      userId: USER,
      connectionId: CONN,
      supabase: client() as any,
    });
    expect(res).toBeNull();
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('a single-account connection keeps the connection scope (unchanged, no scoped note)', async () => {
    h.accountRows = [{ id: 'reg-alp', snaptrade_account_id: 'alp-id' }];
    h.connectionRows = [
      { id: CONN, snaptrade_connection_id: 'auth-1', snaptrade_accounts: [{ id: 'alp-id' }] },
    ];
    const res = await buildPnlWaterfall(`snaptrade:${CONN}:alp-id`, {
      userId: USER,
      connectionId: CONN,
      supabase: client() as any,
      equity: 99617,
    });
    expect(res).not.toBeNull();
    expect(h.fetchCalls[0].length).toBe(2); // both accounts on the authorization
    expect(res!.note).not.toMatch(/excluded rather than merged/);
  });

  it('an account id matching no connection is UNAVAILABLE (never an arbitrary pick)', async () => {
    h.connectionRows = [
      { id: 'conn-a', snaptrade_connection_id: 'auth-a', snaptrade_accounts: [{ id: 'a1' }] },
      { id: 'conn-b', snaptrade_connection_id: 'auth-b', snaptrade_accounts: [{ id: 'b1' }] },
    ];
    const res = await buildPnlWaterfall('snaptrade:conn-zzz', {
      userId: USER,
      supabase: client() as any,
    });
    expect(res).toBeNull();
    expect(h.fetchCalls).toHaveLength(0);
  });
});
