// ─── Part B step 4: account-scoped READ — reconcile engine (flip #4) ──────
// `lib/reconcile.ts`. Same standing rule:
//   • 2+ registered accounts → reconcile EXACTLY ONE account (broker side
//     narrowed to that account too, DB side filtered by `account_id`)
//   • 0–1 registered accounts → unchanged connection-level diff
//   • shared login with no resolvable sub-account scope → REFUSE
//     (ReconcileAccountScopeError), never a merged report
//   • the FIFO-lot axis is suppressed (not merged) on a scoped account

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  accounts: [] as any[],
  positionsByAccount: (() => [] as any[]) as (acct: string) => any[],
  listCalls: 0,
}));

vi.mock('@/lib/snaptrade/auth', () => ({
  snapTradeFetch: async (path: string) =>
    path.endsWith('/positions') ? h.positionsByAccount(path.split('/')[2]) : [],
}));
vi.mock('@/lib/snaptrade/client', () => ({
  listAccounts: async () => {
    h.listCalls++;
    return h.accounts;
  },
  getAccountBalances: async () => [],
}));

import { runReconciliation, ReconcileAccountScopeError } from '@/lib/reconcile';

const CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const SMA = '47b6f4e3-419e-43fc-ae3d-b67ea579f57d';
const YOUTH = 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe';
const SMA_ROW = '09934c3e-ec8f-4073-a9ae-784746106d57';
const YOUTH_ROW = '096d87ba-aff1-49c7-9a75-9f6000ffb498';
const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';

function makeSupabase(tables: Record<string, { many?: any[]; one?: any }>) {
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
      maybeSingle: async () => ({ data: cfg.one ?? null, error: null }),
      single: async () => ({ data: cfg.one ?? null, error: null }),
      then: (res: any) => res({ data: cfg.many ?? [], error: null }),
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

const input = (supabase: any, snapAccountId: string | null) => ({
  supabase,
  userId: USER,
  connectionId: CONN,
  brokerConnectionId: CONN,
  brokerSlug: 'FIDELITY',
  snaptradeUserId: 'su',
  snaptradeUserSecret: 'ss',
  snapAccountId,
});

beforeEach(() => {
  h.accounts = [
    { id: SMA, total_value: 0, name: 'Taxable SMA' },
    { id: YOUTH, total_value: 22963.15, name: 'ANIKET -YOUTH ACCOUNT' },
  ];
  h.positionsByAccount = (acct) => (acct === YOUTH ? [{ symbol: { symbol: { symbol: 'AAPL' } }, units: 10, average_price: 50, price: 100 }] : []);
  h.listCalls = 0;
});

describe('runReconciliation — shared login (2 registered accounts)', () => {
  it('refuses without a sub-account scope (never merges)', async () => {
    const { client } = makeSupabase({ broker_accounts: { many: TWO } });
    await expect(runReconciliation(input(client, null) as any)).rejects.toBeInstanceOf(
      ReconcileAccountScopeError,
    );
  });

  it('scopes BOTH sides to the named account', async () => {
    const { client, calls } = makeSupabase({
      broker_accounts: { many: TWO },
      orders: { many: [] },
      positions: { many: [] },
      position_lots: { many: [] },
    });
    const report = await runReconciliation(input(client, YOUTH) as any);
    expect(report.brokerName).toBe('SnapTrade - Fidelity');
    expect(filtersFor(calls, 'positions')).toContainEqual(['account_id', YOUTH_ROW]);
    expect(filtersFor(calls, 'orders')).toContainEqual(['account_id', YOUTH_ROW]);
    expect(filtersFor(calls, 'positions')).not.toContainEqual(['account_id', SMA_ROW]);
  });

  it('suppresses the FIFO-lot axis rather than comparing a merged lot set', async () => {
    const { client } = makeSupabase({
      broker_accounts: { many: TWO },
      orders: { many: [] },
      positions: { many: [{ symbol: 'AAPL', qty: 10, avg_cost: 50 }] },
      position_lots: { many: [{ ticker: 'AAPL', remaining_qty: 999 }] },
    });
    const report = await runReconciliation(input(client, YOUTH) as any);
    expect(report.positions.lotsReconciled).toBe(false);
    expect(report.positions.lotMismatches).toBe(0);
    expect(report.positions.note).toMatch(/account stamp/i);
  });

  it('refuses a scope the broker does not expose', async () => {
    const { client } = makeSupabase({ broker_accounts: { many: TWO } });
    await expect(
      runReconciliation(input(client, 'ghost-account') as any),
    ).rejects.toBeInstanceOf(ReconcileAccountScopeError);
  });
});

describe('runReconciliation — single-account connection (unchanged)', () => {
  it('keeps the connection-level diff and reconciles lots', async () => {
    const { client, calls } = makeSupabase({
      broker_accounts: { many: [{ id: 'alpaca-row', snaptrade_account_id: 'alp' }] },
      orders: { many: [] },
      positions: { many: [{ symbol: 'AAPL', qty: 10, avg_cost: 50 }] },
      position_lots: { many: [{ ticker: 'AAPL', remaining_qty: 10 }] },
    });
    const report = await runReconciliation(input(client, 'alp') as any);
    expect(filtersFor(calls, 'positions').some((f) => f[0] === 'account_id')).toBe(false);
    expect(report.positions.lotsReconciled).toBe(true);
    expect(report.positions.lotMismatches).toBe(0);
  });
});
