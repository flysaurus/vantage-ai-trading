// ─── Part B step 4: account-scoped READ (dual-read) ────────────────────────
// The AI portfolio reader (`lib/ai/account-positions.ts`) is the first reader
// flipped. Contract locked here:
//   • connection with 2+ registered accounts + a matching sub-account scope
//     → the positions query MUST carry `.eq('account_id', <broker_accounts.id>)`
//   • 2+ registered accounts but NO usable sub-account scope
//     → holdings reported unavailable, and NO positions query is issued
//       (never merge a shared login — the original bug)
//   • 0–1 registered accounts → today's connection-scoped query, unfiltered
//   • broker_accounts lookup failure → today's connection-scoped query
//   • 'demo' / unknown ids → untouched legacy paths

import { describe, it, expect } from 'vitest';
import { resolveBrokerAccountReadFilter } from '@/lib/broker/account-id';
import { resolveAccountPositions } from '@/lib/ai/account-positions';

const CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const SMA = '47b6f4e3-419e-43fc-ae3d-b67ea579f57d';
const YOUTH = 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe';
const SMA_ROW = '09934c3e-ec8f-4073-a9ae-784746106d57';
const YOUTH_ROW = '096d87ba-aff1-49c7-9a75-9f6000ffb498';
const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';

/** Minimal PostgREST-shaped stub. Awaitable, records filters per table. */
function makeSupabase(opts: {
  accounts?: any[] | null;
  accountsError?: any;
  positions?: any[] | null;
  positionsError?: any;
} = {}) {
  const calls = { tables: [] as string[], filters: [] as [string, string, unknown][] };
  const builder = (table: string): any => {
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { calls.filters.push([table, c, v]); return b; },
      neq: (c: string, v: unknown) => { calls.filters.push([table, c, v]); return b; },
      then: (res: any) =>
        res(
          table === 'broker_accounts'
            ? { data: opts.accounts ?? null, error: opts.accountsError ?? null }
            : { data: opts.positions ?? null, error: opts.positionsError ?? null },
        ),
    };
    return b;
  };
  const client: any = { from: (t: string) => { calls.tables.push(t); return builder(t); } };
  return { client, calls };
}

const filtersFor = (calls: any, table: string) =>
  calls.filters.filter((f: any[]) => f[0] === table).map((f: any[]) => [f[1], f[2]]);

const TWO = [
  { id: SMA_ROW, snaptrade_account_id: SMA },
  { id: YOUTH_ROW, snaptrade_account_id: YOUTH },
];

describe('resolveBrokerAccountReadFilter', () => {
  it('shared login (2 accounts) + matching scope → filters by that account row', async () => {
    const { client } = makeSupabase({ accounts: TWO });
    const f = await resolveBrokerAccountReadFilter(client, {
      userId: USER, connectionId: CONN, snapAccountId: YOUTH,
    });
    expect(f.reason).toBe('shared_login_account');
    expect(f.filterAccountId).toBe(YOUTH_ROW);
    expect(f.registeredAccounts).toBe(2);
  });

  it('shared login without a sub-account scope → no filter, never merges', async () => {
    const { client } = makeSupabase({ accounts: TWO });
    const f = await resolveBrokerAccountReadFilter(client, {
      userId: USER, connectionId: CONN, snapAccountId: null,
    });
    expect(f.reason).toBe('shared_login_no_scope');
    expect(f.filterAccountId).toBeNull();
  });

  it('shared login + named sub-account that is NOT registered → no filter', async () => {
    const { client } = makeSupabase({ accounts: TWO });
    const f = await resolveBrokerAccountReadFilter(client, {
      userId: USER, connectionId: CONN, snapAccountId: 'ffffffff-0000-0000-0000-000000000000',
    });
    expect(f.reason).toBe('shared_login_no_scope');
    expect(f.filterAccountId).toBeNull();
  });

  it('single-account connection → connection scope (no filter), legacy rows stay readable', async () => {
    const { client } = makeSupabase({ accounts: [{ id: 'alpaca-row', snaptrade_account_id: 'x' }] });
    const f = await resolveBrokerAccountReadFilter(client, {
      userId: USER, connectionId: 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', snapAccountId: 'x',
    });
    expect(f.reason).toBe('single_account');
    expect(f.filterAccountId).toBeNull();
  });

  it('lookup error → behave as before (connection scope)', async () => {
    const { client } = makeSupabase({ accounts: null, accountsError: { message: 'boom' } });
    const f = await resolveBrokerAccountReadFilter(client, {
      userId: USER, connectionId: CONN, snapAccountId: YOUTH,
    });
    expect(f.reason).toBe('lookup_failed');
    expect(f.filterAccountId).toBeNull();
  });
});

describe('resolveAccountPositions — first flipped reader', () => {
  it('scopes the positions query to the named sub-account on a shared login', async () => {
    const { client, calls } = makeSupabase({ accounts: TWO, positions: [{ symbol: 'AAPL' }] });
    const out = await resolveAccountPositions(client, USER, `snaptrade:${CONN}:${YOUTH}`);
    expect(out.positions).toEqual([{ symbol: 'AAPL' }]);
    expect(out.holdingsUnavailable).toBe(false);
    expect(filtersFor(calls, 'positions')).toContainEqual(['connection_id', CONN]);
    expect(filtersFor(calls, 'positions')).toContainEqual(['account_id', YOUTH_ROW]);
    expect(out.accountId).toBe(`snaptrade:${CONN}:${YOUTH}`);
  });

  it('picks the SIBLING row for the sibling scope (no cross-talk)', async () => {
    const { client, calls } = makeSupabase({ accounts: TWO, positions: [] });
    await resolveAccountPositions(client, USER, `snaptrade:${CONN}:${SMA}`);
    expect(filtersFor(calls, 'positions')).toContainEqual(['account_id', SMA_ROW]);
    expect(filtersFor(calls, 'positions')).not.toContainEqual(['account_id', YOUTH_ROW]);
  });

  it('shared login with no sub-account scope → holdings unavailable, no positions query', async () => {
    const { client, calls } = makeSupabase({ accounts: TWO, positions: [{ symbol: 'AAPL' }] });
    const out = await resolveAccountPositions(client, USER, `snaptrade:${CONN}`);
    expect(out.holdingsUnavailable).toBe(true);
    expect(out.positions).toEqual([]);
    expect(calls.tables).not.toContain('positions');
  });

  it('single-account connection keeps the unscoped (legacy) query', async () => {
    const { client, calls } = makeSupabase({
      accounts: [{ id: 'alpaca-row', snaptrade_account_id: 'alp' }],
      positions: [{ symbol: 'SPY' }],
    });
    const out = await resolveAccountPositions(client, USER, 'snaptrade:ae013e41-06b3-4f7e-83a1-74b8a54ad207:alp');
    expect(out.positions).toEqual([{ symbol: 'SPY' }]);
    expect(filtersFor(calls, 'positions').some((f: any[]) => f[0] === 'account_id')).toBe(false);
  });
});
