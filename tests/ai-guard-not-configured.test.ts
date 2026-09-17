// ─── ai-guard: "not configured" must not be a hard block ─────────────────────
// 2026-09-18 (Em). `get_tier_limit(user,'noticed_check_limit')` returned HTTP 200
// + `null` for a month because the feature row was never seeded — NOT an error.
// The old `getUserTierLimit` threw on that `null`, so `checkUsageLimit` failed
// CLOSED: every noticed pass logged a misleading "RPC failed" and the surface
// silently ran on deterministic fallback copy (400/400 SKIPPED rows since
// 2026-08-21, zero AI copy ever).
//
// A missing limit is "not configured" ⇒ fail OPEN (uncapped, warned). A genuine
// RPC error is still fail-closed, but logged as an RPC *error* and distinguishable.

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Cfg = { tier?: string; notices?: number; limit?: number | null; rpcError?: any };

let cfg: Cfg = {};

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        limit: () => b,
        single: async () =>
          table === 'users'
            ? { data: { tier: cfg.tier ?? 'demo' }, error: null }
            : { data: null, error: null },
        maybeSingle: async () => ({ data: null, error: null }),
        // Awaiting the builder resolves the row set (ai_generation_log count).
        then: (res: any) =>
          res(table === 'ai_generation_log' ? { count: cfg.notices ?? 0, error: null } : { data: null, error: null }),
      };
      return b;
    },
    rpc: async () => {
      if (cfg.rpcError) return { data: null, error: cfg.rpcError };
      return { data: cfg.limit === undefined ? null : cfg.limit, error: null };
    },
  }),
}));

import { checkUsageLimit } from '@/lib/ai-guard';

beforeEach(() => { cfg = {}; });

describe('checkUsageLimit — a NULL tier limit means NOT CONFIGURED', () => {
  it('allows the surface uncapped instead of hard-blocking (the noticed bug)', async () => {
    cfg = { limit: null, notices: 40 };
    const r = await checkUsageLimit('u', 'noticed', '2026-09-18', 'America/New_York');
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.remaining).toBe(999); // same "uncapped" shape as the disabled daily chat cap
  });

  it('still enforces a configured limit', async () => {
    cfg = { limit: 6, notices: 2 };
    const r = await checkUsageLimit('u', 'noticed', '2026-09-18', 'America/New_York');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(4);

    cfg = { limit: 6, notices: 6 };
    const r2 = await checkUsageLimit('u', 'noticed', '2026-09-18', 'America/New_York');
    expect(r2.allowed).toBe(false);
    expect(r2.reason).toContain('Daily noticed limit (6) reached');
  });

  it('a REAL RPC error still fails closed, with an explicit reason', async () => {
    cfg = { rpcError: { message: 'connection reset' } };
    const r = await checkUsageLimit('u', 'noticed', '2026-09-18', 'America/New_York');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('tier system unavailable');
  });
});
