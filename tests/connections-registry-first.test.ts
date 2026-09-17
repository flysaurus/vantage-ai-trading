// Tests for GET /api/connections — ENUMERATION is registry-first.
//
// The route used to return the connect-time `snaptrade_accounts` JSONB snapshot
// verbatim as `accounts[]` + `accountCount` (stale by construction). It now
// enumerates through the shared `enumerateConnectionAccounts` helper: registry
// rows are authoritative, the snapshot is only a legacy fallback (0–1-account
// connections), and every value carries a `valueSource` label or is `null`.
//
// These tests pin that wiring: which source wins, that a snapshot-only account
// cannot add itself to a registry connection, and that a registry lookup failure
// degrades to the snapshot instead of inventing or widening an enumeration.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string } | null>,
  calls: [] as string[],
}));

vi.mock('@/lib/auth/get-server-user', () => ({
  requireAuth: async () => ({ authUser: { id: 'u1' }, authError: null }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      h.calls.push(table);
      const chain: Record<string, unknown> = {};
      const pass = () => chain;
      chain.select = pass;
      chain.eq = pass;
      chain.in = pass;
      chain.order = pass;
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: h.tables[table] ?? [],
          error: h.errors[table] ?? null,
        }).then(resolve);
      return chain;
    },
  }),
}));

import { GET } from '@/app/api/connections/route';

const SMA = { id: 'snap-sma', name: 'Taxable SMA - US Large Equity', cash: 15906.16, totalValue: 377551.36, buyingPower: 2994 };
const YOUTH = { id: 'snap-youth', name: 'ANIKET -YOUTH ACCOUNT', cash: 7981.9, totalValue: 22803.88, buyingPower: null };

const CONN = (over: Record<string, unknown> = {}) => ({
  id: 'conn-1',
  connection_type: 'snaptrade',
  brokerage_slug: 'FIDELITY',
  trading_enabled: false,
  status: 'active',
  snaptrade_connection_id: 'snap-conn-1',
  snaptrade_accounts: [SMA, YOUTH],
  created_at: '2026-08-31T00:00:00Z',
  updated_at: '2026-08-31T00:00:00Z',
  sync_completed_at: '2026-08-31T01:00:00Z',
  error_message: null,
  ...over,
});

beforeEach(() => {
  h.tables = {};
  h.errors = {};
  h.calls = [];
});

async function get() {
  const res = await GET();
  return (await res.json()) as { connections: Array<Record<string, any>> };
}

describe('GET /api/connections — registry-first enumeration', () => {
  it('enumerates from broker_accounts, not the snapshot', async () => {
    h.tables.broker_connections = [CONN()];
    h.tables.broker_accounts = [
      { id: 'ba-1', connection_id: 'conn-1', snaptrade_account_id: 'snap-sma', name: 'Taxable SMA', status: 'open' },
      { id: 'ba-2', connection_id: 'conn-1', snaptrade_account_id: 'snap-youth', name: 'ANIKET', status: 'open' },
    ];

    const { connections } = await get();
    const c = connections[0];

    expect(h.calls).toContain('broker_accounts');
    expect(c.accountCount).toBe(2);
    expect(c.accountsSource).toBe('registry');
    expect(c.accounts.map((a: any) => a.brokerAccountId)).toEqual(['ba-1', 'ba-2']);
    expect(c.accounts.map((a: any) => a.snapAccountId)).toEqual(['snap-sma', 'snap-youth']);
  });

  it('never widens the enumeration with a snapshot account the registry does not know', async () => {
    h.tables.broker_connections = [
      CONN({ snaptrade_accounts: [SMA, YOUTH, { id: 'snap-ghost', name: 'DELETED', totalValue: 999 }] }),
    ];
    h.tables.broker_accounts = [
      { id: 'ba-1', connection_id: 'conn-1', snaptrade_account_id: 'snap-sma', name: 'Taxable SMA', status: 'open' },
    ];

    const { connections } = await get();
    expect(connections[0].accountCount).toBe(1);
    expect(connections[0].accounts.map((a: any) => a.snapAccountId)).toEqual(['snap-sma']);
  });

  it('skips registry rows marked closed', async () => {
    h.tables.broker_connections = [CONN()];
    h.tables.broker_accounts = [
      { id: 'ba-1', connection_id: 'conn-1', snaptrade_account_id: 'snap-sma', name: 'Taxable SMA', status: 'open' },
      { id: 'ba-2', connection_id: 'conn-1', snaptrade_account_id: 'snap-youth', name: 'GONE', status: 'closed' },
    ];

    const { connections } = await get();
    expect(connections[0].accountCount).toBe(1);
  });

  it('falls back to the snapshot for a connection with no registry rows (legacy path)', async () => {
    h.tables.broker_connections = [CONN()];
    h.tables.broker_accounts = [];

    const { connections } = await get();
    const c = connections[0];
    expect(c.accountCount).toBe(2);
    expect(c.accountsSource).toBe('snapshot');
    expect(c.accounts.map((a: any) => a.snapAccountId)).toEqual(['snap-sma', 'snap-youth']);
    // Values come from the connect-time snapshot and are LABELLED as such —
    // the raw JSONB is never returned as though it were current.
    expect(c.accounts.every((a: any) => a.valueSource === 'snapshot')).toBe(true);
    expect(c.accounts[0].cash).toBe(15906.16);
    expect('snaptrade_accounts' in c).toBe(false);
  });

  it('a snapshot totalValue of 0 is UNKNOWN, not $0', async () => {
    h.tables.broker_connections = [
      CONN({ snaptrade_accounts: [{ id: 'snap-x', name: 'X', totalValue: 0, cash: null }] }),
    ];
    h.tables.broker_accounts = [];

    const { connections } = await get();
    const a = connections[0].accounts[0];
    expect(a.totalValue).toBeNull();
    expect(a.cash).toBeNull();
    expect(a.valueSource).toBe('unknown');
  });

  it('registry lookup failure degrades to the snapshot instead of inventing accounts', async () => {
    h.tables.broker_connections = [CONN()];
    h.tables.broker_accounts = [];
    h.errors.broker_accounts = { message: 'relation does not exist' };

    const { connections } = await get();
    const c = connections[0];
    expect(c.accountCount).toBe(2);
    expect(c.accountsSource).toBe('snapshot');
  });

  it('enumerates nothing rather than a fabricated account when both sources are empty', async () => {
    h.tables.broker_connections = [CONN({ snaptrade_accounts: [] })];
    h.tables.broker_accounts = [];

    const { connections } = await get();
    const c = connections[0];
    // The helper's connection-level fallback: one entry, all values unknown.
    expect(c.accountCount).toBe(1);
    expect(c.accountsSource).toBe('none');
    expect(c.accounts[0]).toMatchObject({
      snapAccountId: null,
      brokerAccountId: null,
      totalValue: null,
      cash: null,
      buyingPower: null,
      valueSource: 'unknown',
    });
  });

  it('leaves other connections untouched and keeps the connection metadata', async () => {
    h.tables.broker_connections = [
      CONN(),
      CONN({ id: 'conn-2', brokerage_slug: 'ALPACA-PAPER', snaptrade_accounts: [] }),
    ];
    h.tables.broker_accounts = [
      { id: 'ba-1', connection_id: 'conn-2', snaptrade_account_id: 'snap-alp', name: 'Alpaca Paper', status: 'open' },
    ];

    const { connections } = await get();
    const byId = Object.fromEntries(connections.map((c: any) => [c.id, c]));
    expect(byId['conn-1'].accountCount).toBe(2); // snapshot legacy path
    expect(byId['conn-2'].accountCount).toBe(1); // registry path
    expect(byId['conn-2'].accountsSource).toBe('registry');
    expect(byId['conn-2'].brokerage_slug).toBe('ALPACA-PAPER');
    expect(byId['conn-2'].last_synced).toBe('2026-08-31T01:00:00Z');
  });
});
