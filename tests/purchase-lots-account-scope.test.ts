// ─── Part B §6 item 6: account-scoped FIFO tax-lot READ ────────────────────
// `loadPurchaseLots` must never blend lots/orders across sub-accounts of a
// shared broker login. Contract locked here:
//   • shared login (2+ registered sub-accounts) + a resolvable snapAccountId
//     → ONLY that sub-account's lots, scoped by `position_lots.broker_account_id`
//       (and `orders.account_id` on the fallback) — never the connection
//   • shared login + NO usable sub-account scope
//     → `scope: 'unavailable'`, empty lots, and NO position_lots / orders query
//   • 0–1 registered sub-accounts → unchanged legacy connection-scoped read
//   • unattributable legacy rows (broker_account_id IS NULL) are EXCLUDED from a
//     scoped read and reported via `unattributedLots` — never silently blended
//   • demo / registry-lookup failure → unchanged legacy behaviour

import { describe, it, expect } from 'vitest';
import { loadPurchaseLots } from '@/lib/tax-harvest/purchase-dates';

// Fidelity shared login: one connection, TWO sub-accounts.
const CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const SMA = '47b6f4e3-419e-43fc-ae3d-b67ea579f57d';
const YOUTH = 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe';
const SMA_ROW = '09934c3e-ec8f-4073-a9ae-784746106d57';
const YOUTH_ROW = '096d87ba-aff1-49c7-9a75-9f6000ffb498';
// Alpaca Paper: a SINGLE-account connection (legacy rows stay readable).
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';

/**
 * Minimal PostgREST-shaped stub that APPLIES the recorded filters to an
 * in-memory dataset, so assertions about scoping are truthful (a query that is
 * scoped to account A returns only account A's rows). Awaitable + chainable.
 */
function makeSupabase(
  data: { accounts?: any[] | null; lots?: any[]; orders?: any[]; accountsError?: any } = {},
) {
  const calls = { tables: [] as string[], filters: [] as [string, string, unknown][] };
  const datasets: Record<string, any[]> = {
    broker_accounts: data.accounts ?? [],
    position_lots: data.lots ?? [],
    orders: data.orders ?? [],
  };

  const builder = (table: string): any => {
    const eq: Record<string, unknown> = {};
    const neq: Record<string, unknown> = {};
    const isNull = new Set<string>();
    const gt: Array<[string, number]> = [];
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { eq[c] = v; calls.filters.push([table, c, v]); return b; },
      neq: (c: string, v: unknown) => { neq[c] = v; calls.filters.push([table, c, v]); return b; },
      is: (c: string, v: unknown) => { if (v === null) isNull.add(c); calls.filters.push([table, c, v]); return b; },
      gt: (c: string, v: unknown) => { gt.push([c, Number(v)]); calls.filters.push([table, c, v]); return b; },
      order: () => b,
      maybeSingle: () => b,
      then: (res: (v: any) => void) => {
        if (table === 'broker_accounts' && data.accountsError) {
          res({ data: null, error: data.accountsError });
          return;
        }
        const rows = (datasets[table] ?? []).filter((r) => {
          for (const [c, v] of Object.entries(eq)) if (r[c] !== v) return false;
          for (const [c, v] of Object.entries(neq)) if (r[c] === v) return false;
          for (const c of isNull) if (r[c] !== null && r[c] !== undefined) return false;
          for (const [c, v] of gt) if (!(Number(r[c]) > v)) return false;
          return true;
        });
        res({ data: rows, error: null, count: rows.length });
      },
    };
    return b;
  };

  const client: any = { from: (t: string) => { calls.tables.push(t); return builder(t); } };
  return { client, calls };
}

const filtersFor = (calls: any, table: string) =>
  calls.filters.filter((f: any[]) => f[0] === table).map((f: any[]) => [f[1], f[2]]);
const flatTickers = (byTicker: Record<string, any[]>) =>
  Object.values(byTicker).flat().map((l) => l.id);

const TWO_ACCOUNTS = [
  { id: SMA_ROW, connection_id: CONN, snaptrade_account_id: SMA },
  { id: YOUTH_ROW, connection_id: CONN, snaptrade_account_id: YOUTH },
];

const lot = (over: Record<string, any>) => ({
  id: 'x', user_id: USER, ticker: 'AAPL', qty: 1, remaining_qty: 1,
  price_at_fill: 10, filled_at: '2024-01-01T00:00:00.000Z', ...over,
});

describe('loadPurchaseLots — shared login (2 sub-accounts)', () => {
  const lots = [
    lot({ id: 'youth-aapl', ticker: 'AAPL', account_id: CONN, broker_account_id: YOUTH_ROW }),
    lot({ id: 'sma-msft', ticker: 'MSFT', account_id: CONN, broker_account_id: SMA_ROW }),
    lot({ id: 'legacy-tsla', ticker: 'TSLA', account_id: CONN, broker_account_id: null }),
  ];

  it('narrows to the resolvable sub-account ONLY, and never widens to the connection', async () => {
    const { client, calls } = makeSupabase({ accounts: TWO_ACCOUNTS, lots });
    const out = await loadPurchaseLots(client, {
      userId: USER, connectionId: CONN, snapAccountId: YOUTH,
    });

    expect(out.scope).toBe('account');
    expect(out.source).toBe('lots');
    // Only the youth sub-account's lot — the sibling's and the legacy row are gone.
    expect(Object.keys(out.lotsByTicker)).toEqual(['AAPL']);
    expect(flatTickers(out.lotsByTicker)).toEqual(['youth-aapl']);

    const f = filtersFor(calls, 'position_lots');
    expect(f).toContainEqual(['broker_account_id', YOUTH_ROW]);
    expect(f).not.toContainEqual(['broker_account_id', SMA_ROW]);
    // No widen at the data level: the sibling's and the legacy row never appear.
    // (The only connection-keyed position_lots filter present is the
    // unattributable-rows COUNT, which returns a number, not lots.)
    const ids = flatTickers(out.lotsByTicker);
    expect(ids).not.toContain('sma-msft');
    expect(ids).not.toContain('legacy-tsla');
  });

  it('excludes unattributable legacy rows from a scoped read (and reports the count)', async () => {
    const { client } = makeSupabase({ accounts: TWO_ACCOUNTS, lots });
    const out = await loadPurchaseLots(client, {
      userId: USER, connectionId: CONN, snapAccountId: YOUTH,
    });
    // The TSLA row has no broker_account_id → not presented as belonging to YOUTH.
    expect(flatTickers(out.lotsByTicker)).not.toContain('legacy-tsla');
    // …but its existence is disclosed, not silently swallowed.
    expect(out.unattributedLots).toBe(1);
  });

  it('reports unavailable (empty + no widen) when a shared login has NO sub-account scope', async () => {
    const { client, calls } = makeSupabase({ accounts: TWO_ACCOUNTS, lots });
    const out = await loadPurchaseLots(client, {
      userId: USER, connectionId: CONN, snapAccountId: null,
    });

    expect(out.scope).toBe('unavailable');
    expect(out.source).toBe('none');
    expect(out.lotsByTicker).toEqual({});
    expect(out.unattributedLots).toBe(0);
    // The merged book must never be read: no position_lots / orders query at all.
    expect(calls.tables).not.toContain('position_lots');
    expect(calls.tables).not.toContain('orders');
  });

  it('reports unavailable when the named sub-account is NOT registered on the connection', async () => {
    const { client, calls } = makeSupabase({ accounts: TWO_ACCOUNTS, lots });
    const out = await loadPurchaseLots(client, {
      userId: USER, connectionId: CONN,
      snapAccountId: 'ffffffff-0000-0000-0000-000000000000',
    });

    expect(out.scope).toBe('unavailable');
    expect(out.lotsByTicker).toEqual({});
    expect(calls.tables).not.toContain('position_lots');
  });

  it('scopes the ORDERS fallback by orders.account_id (not the whole connection)', async () => {
    const orders = [
      { id: 'youth-order', user_id: USER, symbol: 'AAPL', side: 'buy', qty: 1, filled_price: 10,
        filled_at: '2024-01-02T00:00:00Z', connection_id: CONN, account_id: YOUTH_ROW },
      { id: 'sma-order', user_id: USER, symbol: 'MSFT', side: 'buy', qty: 1, filled_price: 20,
        filled_at: '2024-01-03T00:00:00Z', connection_id: CONN, account_id: SMA_ROW },
    ];
    // No lots for this scoped account → forces the orders fallback.
    const { client, calls } = makeSupabase({ accounts: TWO_ACCOUNTS, lots: [], orders });
    const out = await loadPurchaseLots(client, {
      userId: USER, connectionId: CONN, snapAccountId: YOUTH,
    });

    expect(out.scope).toBe('account');
    expect(out.source).toBe('orders');
    expect(flatTickers(out.lotsByTicker)).toEqual(['youth-order']);

    const f = filtersFor(calls, 'orders');
    expect(f).toContainEqual(['account_id', YOUTH_ROW]);
    // Must NOT fall back to the connection-level read (the merge).
    expect(f).not.toContainEqual(['connection_id', CONN]);
  });
});

describe('loadPurchaseLots — single-account connection (unchanged legacy behaviour)', () => {
  it('keeps the connection-scoped read and stays on the legacy account_id filter', async () => {
    const lots = [
      lot({ id: 'a1', ticker: 'SPY', account_id: ALPACA, broker_account_id: null }),
      lot({ id: 'a2', ticker: 'QQQ', account_id: ALPACA, broker_account_id: null }),
    ];
    const { client, calls } = makeSupabase({
      accounts: [{ id: 'alpaca-row', connection_id: ALPACA, snaptrade_account_id: 'alp' }],
      lots,
    });
    const out = await loadPurchaseLots(client, {
      userId: USER, connectionId: ALPACA, snapAccountId: 'alp',
    });

    expect(out.scope).toBe('connection');
    expect(out.source).toBe('lots');
    expect(flatTickers(out.lotsByTicker).sort()).toEqual(['a1', 'a2']);
    expect(out.unattributedLots).toBe(0);

    const f = filtersFor(calls, 'position_lots');
    expect(f).toContainEqual(['account_id', ALPACA]);
    expect(f.some((x: any[]) => x[0] === 'broker_account_id')).toBe(false);
  });
});

describe('loadPurchaseLots — demo and lookup failure keep legacy behaviour', () => {
  it('demo reads the local ledger via account_id IS NULL', async () => {
    const lots = [
      lot({ id: 'demo-lot', ticker: 'AAPL', account_id: null, broker_account_id: null }),
      lot({ id: 'live-lot', ticker: 'MSFT', account_id: ALPACA, broker_account_id: null }),
    ];
    const { client, calls } = makeSupabase({ lots });
    const out = await loadPurchaseLots(client, { userId: USER, isDemo: true });

    expect(out.scope).toBe('connection');
    expect(flatTickers(out.lotsByTicker)).toEqual(['demo-lot']);
    expect(filtersFor(calls, 'position_lots')).toContainEqual(['account_id', null]);
    // Demo never consults the broker_accounts registry.
    expect(calls.tables).not.toContain('broker_accounts');
  });

  it('registry lookup failure behaves as before (connection scope), not unavailable', async () => {
    const lots = [lot({ id: 'a1', ticker: 'SPY', account_id: CONN, broker_account_id: null })];
    const { client } = makeSupabase({ accounts: null, accountsError: { message: 'boom' }, lots });
    const out = await loadPurchaseLots(client, {
      userId: USER, connectionId: CONN, snapAccountId: YOUTH,
    });

    expect(out.scope).toBe('connection');
    expect(flatTickers(out.lotsByTicker)).toEqual(['a1']);
  });
});
