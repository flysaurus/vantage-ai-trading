// ═══════════════════════════════════════════════════════════════
// tests/chart-connection-resolution.test.ts
//
// The waterfall reads real broker ACTIVITIES, which needs the right broker
// connection. Two traps, both of which made the key resolve to null and the
// chart silently vanish (marker stripped → prose only):
//
//   1. The app's account key is `snaptrade:<broker_connections.id>` — the
//      prefix must be stripped before matching, or a two-connection user never
//      matches anything and the lookup reports "ambiguous".
//   2. `resolveSnapTradeCredentials()` matches on `broker_connections.id`
//      (`c.id === connectionId`). The `snaptrade_connection_id` column is the
//      SnapTrade-internal authorization id; passing it back throws
//      SnapTradeAuthError, which the waterfall swallows into null.
//
// These tests pin the resolution contract with a stub Supabase client — no
// network, no prod access.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { buildChartCtx } from '../lib/ai/chart-ctx';

const ALPACA_ROW = {
  id: 'ae013e41-06b3-4f7e-83a1-74b8a54ad207',
  snaptrade_connection_id: '0f6f347e-0000-0000-0000-000000000001',
  snaptrade_accounts: [{ id: '51564504-a85f-4dbb-bcf9-6d8d9716596b' }],
};
const FIDELITY_ROW = {
  id: 'bbbbbbbb-1111-2222-3333-444444444444',
  snaptrade_connection_id: 'ec7edf41-0000-0000-0000-000000000002',
  snaptrade_accounts: [{ id: '47b6f4e3-aaaa-bbbb-cccc-dddddddddddd' }],
};

/** Minimal stand-in for the supabase client used by chart-ctx. */
function stubSupabase(rows: unknown[]) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        calls.push(table);
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
          then: undefined,
        };
        // terminal await
        q[Symbol.for('await')] = undefined;
        return {
          select: () => ({
            eq: async () => ({ data: rows, error: null }),
          }),
        };
      },
    },
  };
}

function baseInput(supabase: any, accountId: string | null) {
  return {
    portfolioSnapshot: { equity: 100_693.59, cash: 556.69, positions: [{ symbol: 'AAPL', marketValue: 1000 }] } as any,
    rawPositions: [{ symbol: 'AAPL', marketValue: 1000 }] as any,
    isDemo: false,
    accountId,
    userId: 'user-1',
    investorStyle: 'lynch',
    riskTolerance: 'Moderate',
    supabase,
  } as any;
}

describe('chart ctx — broker connection resolution for activity-backed keys', () => {
  it('strips the `snaptrade:` account prefix and returns the connection ROW id', async () => {
    const { client } = stubSupabase([ALPACA_ROW]);
    const ctx = await buildChartCtx(baseInput(client, `snaptrade:${ALPACA_ROW.id}`));
    // Row id, NOT snaptrade_connection_id — the latter makes credentials
    // resolution throw and the waterfall collapse to null.
    expect(ctx.connectionId).toBe(ALPACA_ROW.id);
    expect(ctx.connectionId).not.toBe(ALPACA_ROW.snaptrade_connection_id);
  });

  it('matches a SnapTrade account id inside snaptrade_accounts', async () => {
    const { client } = stubSupabase([ALPACA_ROW, FIDELITY_ROW]);
    const ctx = await buildChartCtx(baseInput(client, '47b6f4e3-aaaa-bbbb-cccc-dddddddddddd'));
    expect(ctx.connectionId).toBe(FIDELITY_ROW.id);
  });

  it('falls back to the single connection when the account does not match', async () => {
    const { client } = stubSupabase([ALPACA_ROW]);
    const ctx = await buildChartCtx(baseInput(client, 'snaptrade:some-unknown-id'));
    expect(ctx.connectionId).toBe(ALPACA_ROW.id);
  });

  it('returns null (never a guess) when multiple connections are ambiguous', async () => {
    const { client } = stubSupabase([ALPACA_ROW, FIDELITY_ROW]);
    const ctx = await buildChartCtx(baseInput(client, 'snaptrade:some-unknown-id'));
    expect(ctx.connectionId).toBeNull();
  });

  it('returns null when there is no account or no supabase client', async () => {
    const { client } = stubSupabase([ALPACA_ROW]);
    expect((await buildChartCtx(baseInput(client, null))).connectionId).toBeNull();
    expect((await buildChartCtx(baseInput(null, `snaptrade:${ALPACA_ROW.id}`))).connectionId).toBeNull();
  });

  it('skips rows with no snaptrade_connection_id', async () => {
    const { client } = stubSupabase([{ ...ALPACA_ROW, snaptrade_connection_id: null }]);
    const ctx = await buildChartCtx(baseInput(client, `snaptrade:${ALPACA_ROW.id}`));
    expect(ctx.connectionId).toBeNull();
  });
});

describe('pnl-waterfall — never returns a fabricated starting balance', () => {
  it('returns null without the SnapTrade client env (no data ⇒ no chart)', async () => {
    const { buildPnlWaterfall } = await import('../lib/portfolio/pnl-waterfall');
    const prev = process.env.SNAPTRADE_CLIENT_ID;
    delete process.env.SNAPTRADE_CLIENT_ID;
    const res = await buildPnlWaterfall('snaptrade:x', { userId: 'u', supabase: {} as any, equity: 1000 });
    expect(res).toBeNull();
    if (prev !== undefined) process.env.SNAPTRADE_CLIENT_ID = prev;
  });
});
