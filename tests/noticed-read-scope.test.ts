// ─── Part B step 4: account-scoped READ — "Rufus Noticed" reader ───────────
// `lib/noticed/resolve-input.ts` (flip #2). Same standing rule as
// `lib/ai/account-positions.ts`:
//   • 2+ registered accounts → strict `account_id` filter on positions AND
//     orders AND cash, never widened (siblings' cash must not be summed)
//   • 0–1 registered accounts → unchanged connection-level query
//   • shared login with no resolvable sub-account scope → null (quiet), never
//     a merged card

import { describe, it, expect } from 'vitest';
import { resolveBrokerNoticedInput } from '@/lib/noticed/resolve-input';

const CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const SMA = '47b6f4e3-419e-43fc-ae3d-b67ea579f57d';
const YOUTH = 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe';
const SMA_ROW = '09934c3e-ec8f-4073-a9ae-784746106d57';
const YOUTH_ROW = '096d87ba-aff1-49c7-9a75-9f6000ffb498';
const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';

/** Chainable, awaitable PostgREST stub; one config per table. */
function makeSupabase(tables: Record<string, { many?: any; one?: any; error?: any }>) {
  const calls: { table: string; filters: [string, unknown][] }[] = [];
  const builder = (table: string): any => {
    const rec = { table, filters: [] as [string, unknown][] };
    calls.push(rec);
    const cfg = tables[table] || {};
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return b; },
      neq: (c: string, v: unknown) => { rec.filters.push([c, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: cfg.one ?? null, error: cfg.error ?? null }),
      single: async () => ({ data: cfg.one ?? null, error: cfg.error ?? null }),
      then: (res: any) => res({ data: cfg.many ?? cfg.one ?? null, error: cfg.error ?? null }),
    };
    return b;
  };
  return { client: { from: (t: string) => builder(t) }, calls };
}

const filtersFor = (calls: any[], table: string) =>
  calls.filter((c) => c.table === table).flatMap((c) => c.filters);

const TWO = [
  { id: SMA_ROW, snaptrade_account_id: SMA },
  { id: YOUTH_ROW, snaptrade_account_id: YOUTH },
];
const FIDELITY_CONN = {
  one: {
    snaptrade_accounts: [
      { id: SMA, cash: 111.11, totalValue: 0 },
      { id: YOUTH, cash: 222.22, totalValue: 22963.15 },
    ],
  },
};
const POSITIONS = [{ symbol: 'AAPL', qty: 10, market_value: 1000, avg_cost: 50, unrealized_pnl: 500 }];

describe('resolveBrokerNoticedInput — shared login (2 registered accounts)', () => {
  it('filters positions to the scoped sub-account', async () => {
    const { client, calls } = makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: POSITIONS },
      broker_connections: FIDELITY_CONN,
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    const out = await resolveBrokerNoticedInput(client, USER, `snaptrade:${CONN}:${YOUTH}`);
    expect(out).not.toBeNull();
    expect(filtersFor(calls, 'positions')).toContainEqual(['account_id', YOUTH_ROW]);
    expect(filtersFor(calls, 'positions')).toContainEqual(['connection_id', CONN]);
  });

  it('uses ONLY the scoped sub-account cash (never sums siblings)', async () => {
    const mk = (scope: string) => makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: POSITIONS },
      broker_connections: FIDELITY_CONN,
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    const a = mk('x');
    const sma = await resolveBrokerNoticedInput(a.client, USER, `snaptrade:${CONN}:${SMA}`);
    const b = mk('x');
    const youth = await resolveBrokerNoticedInput(b.client, USER, `snaptrade:${CONN}:${YOUTH}`);
    expect(sma!.account.cash).toBeCloseTo(111.11, 2);
    expect(youth!.account.cash).toBeCloseTo(222.22, 2);
  });

  it('scopes the "days since last trade" orders read to the sub-account', async () => {
    const { client, calls } = makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: POSITIONS },
      broker_connections: FIDELITY_CONN,
      users: { one: { day_pnl: 0 } },
      orders: { one: { filled_at: new Date(Date.now() - 3 * 86400000).toISOString() } },
    });
    const out = await resolveBrokerNoticedInput(client, USER, `snaptrade:${CONN}:${SMA}`);
    expect(filtersFor(calls, 'orders')).toContainEqual(['account_id', SMA_ROW]);
    expect(out!.daysSinceLastTrade).toBe(3);
  });

  it('shared login with no sub-account scope → null, and no positions query', async () => {
    const { client, calls } = makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: POSITIONS },
      broker_connections: FIDELITY_CONN,
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    const out = await resolveBrokerNoticedInput(client, USER, `snaptrade:${CONN}`);
    expect(out).toBeNull();
    expect(calls.some((c) => c.table === 'positions')).toBe(false);
  });
});

describe('resolveBrokerNoticedInput — single-account connection (unchanged)', () => {
  it('keeps the connection-scoped query, no account filter, cash still summed', async () => {
    const { client, calls } = makeSupabase({
      broker_accounts: { many: [{ id: 'alpaca-row', snaptrade_account_id: 'alp' }] },
      positions: { many: POSITIONS },
      broker_connections: { one: { snaptrade_accounts: [{ id: 'alp', cash: 100865.95 }] } },
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    const out = await resolveBrokerNoticedInput(
      client, USER, 'snaptrade:ae013e41-06b3-4f7e-83a1-74b8a54ad207:alp',
    );
    expect(out).not.toBeNull();
    expect(filtersFor(calls, 'positions').some((f) => f[0] === 'account_id')).toBe(false);
    expect(out!.account.cash).toBeCloseTo(100865.95, 2);
  });
});
