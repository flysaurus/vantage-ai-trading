// ─── Part B step 4: account-scoped READ — "Rufus Noticed" reader ───────────
// `lib/noticed/resolve-input.ts` (flip #2). Same standing rule as
// `lib/ai/account-positions.ts`:
//   • 2+ registered accounts → strict `account_id` filter on positions AND
//     orders AND cash, never widened (siblings' cash must not be summed)
//   • 0–1 registered accounts → unchanged connection-level query
//   • shared login with no resolvable sub-account scope → null (quiet), never
//     a merged card

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Cash is now resolved from the LIVE balances endpoint
// (`lib/broker/live-account-cash.ts`), not from the connect-time
// `snaptrade_accounts` snapshot — the snapshot carried Alpaca's July cash
// ($100,865.95) as if it were today's. Stub the live resolver here and drive it
// per test; anything it cannot establish is UNKNOWN, never a sibling sum.
vi.mock('@/lib/broker/live-account-cash', () => ({ resolveLiveAccountCash: vi.fn() }));

import { resolveBrokerNoticedInput } from '@/lib/noticed/resolve-input';
import { resolveLiveAccountCash } from '@/lib/broker/live-account-cash';

const liveCash = resolveLiveAccountCash as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { liveCash.mockReset(); });

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
    liveCash.mockImplementation(async (_u: string, _c: string, snap: string | null) =>
      snap === SMA ? 111.11 : snap === YOUTH ? 222.22 : null);
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
    // …and the resolver was asked for exactly one account each time.
    expect(liveCash).toHaveBeenCalledWith(USER, CONN, SMA);
    expect(liveCash).toHaveBeenCalledWith(USER, CONN, YOUTH);
  });

  it('IGNORES the connect-time snapshot cash (it is months stale)', async () => {
    // Snapshot claims 111.11 / 222.22; live says something else entirely.
    liveCash.mockResolvedValue(4.99);
    const { client } = makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: POSITIONS },
      broker_connections: FIDELITY_CONN,
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    const out = await resolveBrokerNoticedInput(client, USER, `snaptrade:${CONN}:${SMA}`);
    expect(out!.account.cash).toBeCloseTo(4.99, 2);
    expect(out!.account.cash).not.toBeCloseTo(111.11, 2);
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

describe('resolveBrokerNoticedInput — cash is never estimated (killed 25% fallback)', () => {
  const NULL_CASH_CONN = {
    one: {
      snaptrade_accounts: [
        { id: SMA, cash: null, totalValue: 0 },
        { id: YOUTH, cash: null, totalValue: 22963.15 },
      ],
    },
  };

  it('reports UNKNOWN cash + null percentages when the broker gives no cash', async () => {
    const { client } = makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: POSITIONS },
      broker_connections: NULL_CASH_CONN,
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    liveCash.mockResolvedValue(null);
    const out = await resolveBrokerNoticedInput(client, USER, `snaptrade:${CONN}:${YOUTH}`);
    expect(out!.account.cash).toBeNull();
    expect(out!.account.cash).not.toBe(Math.round(1000 * 0.25));
    expect(out!.account.totalPnlPercent).toBeNull();
    expect(out!.account.dayPnlPercent).toBeNull();
  });

  it('an unmatchable sub-account scope also yields unknown cash (never a sibling sum)', async () => {
    liveCash.mockResolvedValue(null);
    const { client } = makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: POSITIONS },
      broker_connections: { one: { snaptrade_accounts: [{ id: YOUTH, cash: 222.22 }] } },
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    const out = await resolveBrokerNoticedInput(client, USER, `snaptrade:${CONN}:${SMA}`);
    expect(out!.account.cash).toBeNull();
  });
});

// ─── The engine must not compute anything on an unknown denominator ───────
describe('noticed engine — unknown cash fails safe', () => {
  const baseInput = (cash: number | null) => ({
    account: { cash, equity: 1000, totalPnl: 100, totalPnlPercent: null, dayPnl: 10, dayPnlPercent: null },
    positions: [{ symbol: 'AAPL', qty: 10, marketValue: 1000, avgCost: 50, totalPnl: 100, totalPnlPercent: 20, sector: 'Technology' }],
    watchlistSymbols: [],
    daysSinceLastTrade: 3,
  }) as any;

  it('buildPortfolioSummary says "unknown" instead of inventing a total', async () => {
    const { buildPortfolioSummary } = await import('@/lib/noticed/engine');
    const s = buildPortfolioSummary(baseInput(null));
    expect(s).toContain('Cash: unknown');
    expect(s).toContain('Total: unknown');
    expect(s).not.toMatch(/Cash: \$250/); // the old 25% fabrication
  });

  it('findDriftTriggers skips entirely when cash is unknown, still works when known', async () => {
    const { findDriftTriggers } = await import('@/lib/noticed/engine');
    const spyInput = (cash: number | null) => ({
      account: { cash, equity: 100000, totalPnl: 0, totalPnlPercent: 0, dayPnl: 0, dayPnlPercent: 0 },
      positions: [{ symbol: 'SPY', qty: 1, marketValue: 100000, avgCost: 0, totalPnl: 0, totalPnlPercent: 0, sector: 'Broad Market' }],
      watchlistSymbols: [],
      daysSinceLastTrade: 3,
    }) as any;
    expect(findDriftTriggers(spyInput(null), new Set(), 'buffett')).toEqual([]);
    expect(findDriftTriggers(spyInput(0), new Set(), 'buffett').length).toBeGreaterThan(0);
  });
});

describe('resolveBrokerNoticedInput — single-account connection (unchanged)', () => {
  it('keeps the connection-scoped query, no account filter, and does NOT use the stale snapshot cash', async () => {
    // The snapshot's 100865.95 is Alpaca's cash from connection time. Live is 468.81.
    liveCash.mockResolvedValue(468.81);
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
    expect(out!.account.cash).toBeCloseTo(468.81, 2);
    expect(out!.account.cash).not.toBeCloseTo(100865.95, 2); // stale snapshot value
  });
});

// ─── 2026-09-18: the milestone resolved↔active flip — ONE mapper, not two ────
// The noticed cron route used to re-implement this mapping locally and coerced a
// NULL P&L to 0 (`Number(p.unrealized_pnl_pct || 0)`). Live broker rows store NO
// P&L (Fidelity Taxable SMA: 349/349 null, verified in prod), so the cron fed the
// rules engine `totalPnlPercent: 0` for every position → no milestone band could
// cross → the stale-resolve pass resolved EVERY milestone card on every 30-minute
// cron pass, while this resolver (the API path) derived P&L and re-created them.
// These tests pin the derivation the two callers must now share.
describe('resolveBrokerNoticedInput — derives P&L when the broker stores none', () => {
  // Shape produced by the live sync: market_value + avg_cost only.
  const NULL_PNL_POSITIONS = [
    { symbol: 'VALE', qty: 10.13, market_value: 143.14, avg_cost: 9.5252, unrealized_pnl: null, unrealized_pnl_pct: null },
    { symbol: 'XOM', qty: 1, market_value: 90, avg_cost: 100, unrealized_pnl: null, unrealized_pnl_pct: null },
  ];

  const resolve = async () => {
    liveCash.mockResolvedValue(2994.1);
    const { client } = makeSupabase({
      broker_accounts: { many: TWO },
      positions: { many: NULL_PNL_POSITIONS },
      broker_connections: FIDELITY_CONN,
      users: { one: { day_pnl: 0 } },
      orders: { one: null },
    });
    return resolveBrokerNoticedInput(client, USER, `snaptrade:${CONN}:${SMA}`);
  };

  it('derives totalPnl / totalPnlPercent from market value − cost basis', async () => {
    const out = await resolve();
    expect(out).not.toBeNull();
    const vale = out!.positions.find((p) => p.symbol === 'VALE')!;
    const xom = out!.positions.find((p) => p.symbol === 'XOM')!;
    expect(vale.totalPnl).toBeCloseTo(143.14 - 10.13 * 9.5252, 2);
    expect(vale.totalPnlPercent).toBeCloseTo(48.3, 0);
    expect(xom.totalPnlPercent).toBeCloseTo(-10, 0);
    // The regression: a coerced zero means "no signal", not "no data".
    expect(vale.totalPnlPercent).not.toBe(0);
    expect(out!.account.equity).toBeCloseTo(233.14, 2);
  });

  it('feeds the rules engine a milestone trigger (the cron used to feed 0%)', async () => {
    const { findNewTriggers } = await import('@/lib/noticed/engine');
    const out = await resolve();
    const keys = findNewTriggers(out!, new Set()).map((t) => t.trigger_key);
    expect(keys).toContain('MILESTONE_VALE_+25');
    expect(keys).toContain('MILESTONE_XOM_-10');

    // Failing control: the OLD cron mapping produced no trigger at all.
    const coerced = {
      ...out!,
      positions: out!.positions.map((p) => ({ ...p, totalPnl: 0, totalPnlPercent: 0 })),
    };
    const coercedKeys = findNewTriggers(coerced, new Set()).map((t) => t.trigger_key);
    expect(coercedKeys).not.toContain('MILESTONE_VALE_+25');
  });
});

// ─── 2026-09-18: the cron must delegate to the shared resolver ────────────────
// Static scan, deliberately: the whole bug was a *second* mapper that nothing
// pointed at. If a third one appears, this fails.
describe('portfolio-agent cron uses the shared noticed input resolver', () => {
  const src = readFileSync('app/api/cron/portfolio-agent/route.ts', 'utf8');

  it('imports and calls resolveBrokerNoticedInput for broker scopes', () => {
    expect(src).toMatch(/import\s*\{[^}]*resolveBrokerNoticedInput[^}]*\}\s*from\s*'@\/lib\/noticed\/resolve-input'/);
    expect(src).toMatch(/await resolveBrokerNoticedInput\(/);
  });

  it('never re-derives P&L with a `|| 0` coercion', () => {
    expect(src).not.toMatch(/unrealized_pnl_pct\s*\|\|\s*0/);
    expect(src).not.toMatch(/unrealized_pnl\s*\|\|\s*0/);
    expect(src).not.toMatch(/totalPnlPercent:\s*Number\(/);
  });
});
