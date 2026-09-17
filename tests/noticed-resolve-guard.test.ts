// ─── Noticed pipeline: never resolve active cards off an empty snapshot ────
//
// The Fidelity Taxable SMA (349 positions) showed "nothing under Rufus
// Noticed". Root cause: the stale-resolve pass at the end of
// `runNoticedPipeline` compares the CURRENTLY-FIRING trigger set against the
// active rows and resolves anything that is not firing. Every rule engine needs
// positions, so a degraded read (a `positions/sync` mid delete+insert, a
// holdings-unavailable account, a failed broker call) fires nothing — and the
// pass then resolves the ENTIRE feed in one go, from a snapshot that was never
// a real observation of the portfolio.
//
// Rule: resolve only when the input is usable (`snapshotIsUsableForResolve`).
// Control: with a real snapshot, still-stale cards must still resolve.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const updates: any[] = [];
const inserts: any[] = [];
const queries: string[] = [];
/** Rows returned by every awaiting select (test-controlled). */
let selectRows: any[] = [];

function chainStub(): any {
  const make = (): any =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop !== 'string') return undefined;
          if (prop === 'then') {
            return (resolve: any, reject?: any) =>
              Promise.resolve({ data: selectRows, error: null }).then(resolve, reject);
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return async () => ({ data: null, error: null });
          }
          if (prop === 'update') {
            return (vals: any) => {
              updates.push(vals);
              return make();
            };
          }
          if (prop === 'insert') {
            return (vals: any) => {
              inserts.push(vals);
              return make();
            };
          }
          if (prop === 'from') {
            return (t: string) => {
              queries.push(t);
              return make();
            };
          }
          return (..._args: any[]) => make();
        },
      },
    );
  return make();
}

const stub = chainStub();

vi.mock('@/lib/supabase', () => ({ createServerClient: () => stub }));
vi.mock('@/lib/ai-guard', () => ({
  checkUsageLimit: async () => ({ allowed: false, remaining: 0 }),
}));
vi.mock('@/lib/ai-provider', () => ({
  callChatAI: async () => '',
}));

import { runNoticedPipeline, snapshotIsUsableForResolve } from '@/lib/noticed/engine';
import type { NoticedRuleInput } from '@/lib/noticed/engine';

const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const SMA = 'snaptrade:0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc:47b6f4e3-419e-43fc-ae3d-b67ea579f57d';

function makeInput(overrides: Partial<NoticedRuleInput> = {}): NoticedRuleInput {
  return {
    account: {
      cash: 0,
      equity: 100000,
      totalPnl: 0,
      totalPnlPercent: 0,
      dayPnl: 0,
      dayPnlPercent: 0,
    },
    positions: [],
    watchlistSymbols: [],
    daysSinceLastTrade: 3,
    availableCash: 0,
    ...overrides,
  };
}

async function run(input: NoticedRuleInput, existingKeys = new Set<string>()) {
  return runNoticedPipeline({
    userId: USER,
    accountId: SMA,
    input,
    investorStyle: 'buffett',
    existingKeys,
    supabase: stub,
  } as any);
}

beforeEach(() => {
  updates.length = 0;
  inserts.length = 0;
  queries.length = 0;
  selectRows = [];
});

const resolvingUpdates = () => updates.filter((u) => u?.resolved === true);

describe('snapshotIsUsableForResolve', () => {
  it('rejects a missing or empty position list', () => {
    expect(snapshotIsUsableForResolve(makeInput())).toBe(false);
    expect(snapshotIsUsableForResolve(makeInput({ positions: undefined as any }))).toBe(false);
  });

  it('accepts a snapshot with at least one position', () => {
    expect(
      snapshotIsUsableForResolve(
        makeInput({
          positions: [
            { symbol: 'AAPL', qty: 1, marketValue: 100, avgCost: 100, totalPnl: 0, totalPnlPercent: 0 },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe('runNoticedPipeline stale-resolve guard', () => {
  it('does NOT resolve active cards when the snapshot has no positions', async () => {
    await run(makeInput(), new Set(['MILESTONE_VALE_+25']));

    expect(resolvingUpdates()).toEqual([]);
    // the resolve pass never even queried the active rows
    const lookedForActive =
      queries.includes('noticed_items') && updates.some((u) => u?.resolved === true);
    expect(lookedForActive).toBe(false);
  });

  it('still resolves stale cards with a real snapshot (control)', async () => {
    const input = makeInput({
      positions: [
        // 0% gain: no milestone band fires, so the previously-active card is
        // genuinely stale and must be resolved.
        { symbol: 'CTAS', qty: 10, marketValue: 1000, avgCost: 100, totalPnl: 0, totalPnlPercent: 0 },
      ],
    });
    // the active-row query returns one card that no longer fires
    selectRows = [{ trigger_key: 'MILESTONE_OLD_+15' }];

    await run(input, new Set(['MILESTONE_OLD_+15']));

    expect(resolvingUpdates().length).toBeGreaterThan(0);
  });
});
