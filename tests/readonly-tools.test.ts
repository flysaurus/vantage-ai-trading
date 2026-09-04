// ═══════════════════════════════════════════════════════════════
// tests/readonly-tools.test.ts — Phase 2a read-only account tools
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/readonly-tools.test.ts
//
// Covers executeReadonlyTool. Every tool here is READ-ONLY — it grounds the AI
// advisor with real account data on demand, never mutates anything. The pure
// tools (getPortfolio / getStyleTargets / getRebalancePlan) are tested against
// a live PortfolioSnapshot; the supabase-backed list tools use a thenable
// mock builder (await-anywhere chain).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { executeReadonlyTool, type ReadonlyToolContext } from '../lib/ai/readonly-tools';
import type { PortfolioSnapshot } from '../lib/ai/account-actions';

// ── Thenable supabase mock: `await` at ANY point in the fluent chain resolves
// to the per-table result. Methods are all fluent (return `this`), so
// .select().eq().order().limit() composes; the `.then` makes it awaitable.
function mockSupabase(results: Record<string, { data: any; error?: any }>) {
  const from = (table: string) => {
    const result = results[table] ?? { data: [], error: null };
    const builder: any = {
      then(resolve: any) { return resolve(result); },
    };
    for (const m of ['select', 'update', 'insert', 'eq', 'neq', 'in', 'order', 'limit', 'single', 'maybeSingle']) {
      builder[m] = () => builder;
    }
    return builder;
  };
  return { from };
}

const SNAPSHOT: PortfolioSnapshot = {
  equity: 100000,
  cash: 50000,
  positions: [
    { symbol: 'AAPL', name: 'Apple', qty: 10, price: 200, marketValue: 2000 },
    { symbol: 'NVDA', name: 'NVIDIA', qty: 5, price: 800, marketValue: 4000 },
  ],
};

function ctx(overrides: Partial<ReadonlyToolContext> = {}): ReadonlyToolContext {
  return {
    supabase: {},
    userId: 'u1',
    portfolioSnapshot: SNAPSHOT,
    investorStyle: 'lynch',
    accountId: null,
    ...overrides,
  };
}

describe('executeReadonlyTool — getPortfolio', () => {
  it('returns live equity/cash/positions from the snapshot', async () => {
    const r = JSON.parse(await executeReadonlyTool('getPortfolio', {}, ctx()));
    expect(r.equity).toBe(100000);
    expect(r.cash).toBe(50000);
    expect(r.positionCount).toBe(2);
    expect(r.positions).toEqual([
      { symbol: 'AAPL', name: 'Apple', qty: 10, price: 200, marketValue: 2000 },
      { symbol: 'NVDA', name: 'NVIDIA', qty: 5, price: 800, marketValue: 4000 },
    ]);
  });

  it('falls back to a graceful error when no portfolio is loaded', async () => {
    const r = JSON.parse(await executeReadonlyTool('getPortfolio', {}, ctx({ portfolioSnapshot: null })));
    expect(r.error).toContain('No portfolio loaded');
    expect(r.positions).toEqual([]);
    expect(r.equity).toBe(0);
  });
});

describe('executeReadonlyTool — getStyleTargets', () => {
  it('uses the user current style when style is omitted', async () => {
    const r = JSON.parse(await executeReadonlyTool('getStyleTargets', {}, ctx({ investorStyle: 'munger' })));
    expect(r.style).toBe('munger');
    expect(Array.isArray(r.targets)).toBe(true);
    expect(typeof r.styleName).toBe('string');
  });

  it('normalizes an explicit style key (case-insensitive)', async () => {
    const r = JSON.parse(await executeReadonlyTool('getStyleTargets', { style: 'Buffett' }, ctx()));
    expect(r.style).toBe('buffett');
  });

  it('falls back to the current style for an invalid key', async () => {
    const r = JSON.parse(await executeReadonlyTool('getStyleTargets', { style: 'bogus' }, ctx({ investorStyle: 'munger' })));
    expect(r.style).toBe('munger');
  });
});

describe('executeReadonlyTool — getRebalancePlan', () => {
  it('returns a computed proposal (read-only, never executes)', async () => {
    const r = JSON.parse(await executeReadonlyTool('getRebalancePlan', {}, ctx()));
    expect(r.equity).toBe(100000);
    expect(r.cash).toBe(50000);
    expect(Array.isArray(r.lines)).toBe(true);
    expect(typeof r.styleName).toBe('string');
    expect(typeof r.summary).toBe('string');
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it('tolerates a null portfolio (zero equity, empty lines)', async () => {
    const r = JSON.parse(await executeReadonlyTool('getRebalancePlan', {}, ctx({ portfolioSnapshot: null })));
    expect(r.equity).toBe(0);
    expect(Array.isArray(r.lines)).toBe(true);
  });
});

describe('executeReadonlyTool — supabase-backed list tools', () => {
  it('listBaskets maps rows for an authenticated user', async () => {
    const supabase = mockSupabase({
      baskets: {
        data: [{ id: 'b1', name: 'AI Boom', status: 'active', is_active: true, created_at: '2026-01-01T00:00:00Z' }],
        error: null,
      },
    });
    const r = JSON.parse(await executeReadonlyTool('listBaskets', {}, ctx({ supabase })));
    expect(r.baskets).toEqual([{ id: 'b1', name: 'AI Boom', status: 'active', isActive: true, createdAt: '2026-01-01T00:00:00Z' }]);
  });

  it('list tools return a note for anonymous users (no supabase call)', async () => {
    const r = JSON.parse(await executeReadonlyTool('listBaskets', {}, ctx({ userId: 'anonymous', supabase: mockSupabase({}) })));
    expect(r.baskets).toEqual([]);
    expect(r.note).toContain('No authenticated user');
  });

  it('surfaces supabase errors instead of throwing', async () => {
    const supabase = mockSupabase({ baskets: { data: null, error: { message: 'boom' } } });
    const r = JSON.parse(await executeReadonlyTool('listBaskets', {}, ctx({ supabase })));
    expect(r.error).toBe('boom');
  });
});

describe('executeReadonlyTool — unknown tool', () => {
  it('returns a structured error', async () => {
    const r = JSON.parse(await executeReadonlyTool('doesNotExist', {}, ctx()));
    expect(r.error).toContain('Unknown tool');
  });
});
