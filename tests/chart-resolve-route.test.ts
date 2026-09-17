// POST /api/ai/charts/resolve — retro-resolve + heal stored chart markers.
// WRITE-CAPABLE: stamps `chat_messages.metadata.charts` for the caller's own rows.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authError: null as any,
  ctxCalls: 0,
  resolveResult: [] as any[],
  rows: [] as any[],
  updates: [] as any[],
  updateError: null as any,
  updateFilters: [] as any[],
}));

vi.mock('@/lib/auth/get-server-user', () => ({
  requireAuth: async () =>
    h.authError
      ? { authUser: null, authError: h.authError }
      : { authUser: { id: 'u1', email: 'em@example.com' }, authError: null },
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: h.rows, error: null }),
        }),
      }),
      update: (payload: any) => ({
        eq: (_c: string, id: string) => ({
          eq: async (col2: string, v2: any) => {
            h.updateFilters.push({ id, col2, v2 });
            h.updates.push(payload);
            return { error: h.updateError };
          },
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/ai/chart-ctx', () => ({
  buildChartCtx: async () => {
    h.ctxCalls++;
    return { positions: [] };
  },
}));

vi.mock('@/lib/ai/chart-markers', () => ({
  parseChartRequests: (t: string) => (/\[CHART:/.test(t) ? [{ type: 'waterfall', key: 'pnl-waterfall' }] : []),
  resolveCharts: async () => h.resolveResult,
}));

const post = async (body: any) => {
  const { POST } = await import('@/app/api/ai/charts/resolve/route');
  const res = await POST({ json: async () => body } as any);
  return { status: res.status, body: await res.json() };
};

const chart = { type: 'waterfall', key: 'pnl-waterfall', title: 'Bridge', data: { steps: [] } };

beforeEach(() => {
  h.authError = null;
  h.ctxCalls = 0;
  h.resolveResult = [];
  h.rows = [];
  h.updates = [];
  h.updateError = null;
  h.updateFilters = [];
  vi.resetModules();
});

describe('POST /api/ai/charts/resolve', () => {
  it('rejects an unauthenticated caller', async () => {
    const { NextResponse } = await import('next/server');
    h.authError = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const r = await post({ items: [{ id: 'm1', content: '[CHART:waterfall|pnl-waterfall]' }] });
    expect(r.status).toBe(401);
    expect(h.ctxCalls).toBe(0);
    expect(h.updates).toHaveLength(0);
  });

  it('400s on an invalid body', async () => {
    const { POST } = await import('@/app/api/ai/charts/resolve/route');
    const res = await POST({ json: async () => { throw new Error('bad'); } } as any);
    expect(res.status).toBe(400);
  });

  it('no items ⇒ empty result and NO ctx build', async () => {
    const r = await post({ items: [] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ resolved: [], healed: 0 });
    expect(h.ctxCalls).toBe(0);
  });

  it('items with no chart marker ⇒ empty result and NO ctx build (no needless work)', async () => {
    const r = await post({ items: [{ id: 'm1', content: 'just prose' }] });
    expect(r.body).toEqual({ resolved: [], healed: 0 });
    expect(h.ctxCalls).toBe(0);
  });

  it('drops malformed items and caps the batch at MAX_ITEMS', async () => {
    h.resolveResult = [chart];
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, content: '[CHART:waterfall|pnl-waterfall]' }));
    h.rows = items.slice(0, 40).map((it) => ({ id: it.id, metadata: null }));
    const r = await post({ items: [null, { id: '' }, { content: 'x' }, ...items] });
    expect(h.ctxCalls).toBe(1);
    expect(r.body.resolved).toHaveLength(12); // capped, not 40
    expect(r.body.resolved[0].id).toBe('m0');
  });

  it('returns the resolved charts and heals the caller’s own row', async () => {
    h.resolveResult = [chart];
    h.rows = [{ id: 'm1', metadata: null }];
    const r = await post({ items: [{ id: 'm1', content: '[CHART:waterfall|pnl-waterfall]' }] });
    expect(r.status).toBe(200);
    expect(r.body.resolved).toEqual([{ id: 'm1', charts: [chart] }]);
    expect(r.body.healed).toBe(1);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toEqual({ metadata: { charts: [chart] } });
    // the write is scoped to the row AND the caller
    expect(h.updateFilters[0]).toMatchObject({ id: 'm1', col2: 'user_id', v2: 'u1' });
  });

  it('preserves other metadata keys when healing', async () => {
    h.resolveResult = [chart];
    h.rows = [{ id: 'm1', metadata: { download: { rows: [1] } } }];
    await post({ items: [{ id: 'm1', content: '[CHART:waterfall|pnl-waterfall]' }] });
    expect(h.updates[0].metadata).toEqual({ download: { rows: [1] }, charts: [chart] });
  });

  it('does not re-write a row that already carries charts', async () => {
    h.resolveResult = [chart];
    h.rows = [{ id: 'm1', metadata: { charts: [chart] } }];
    const r = await post({ items: [{ id: 'm1', content: '[CHART:waterfall|pnl-waterfall]' }] });
    expect(r.body.healed).toBe(0);
    expect(h.updates).toHaveLength(0);
  });

  it('never writes a row the caller does not own (absent from the scoped read)', async () => {
    h.resolveResult = [chart];
    h.rows = []; // scoped read returned nothing for this id
    const r = await post({ items: [{ id: 'someone-elses', content: '[CHART:waterfall|pnl-waterfall]' }] });
    expect(r.body.resolved).toHaveLength(1); // charts are derived from the caller's own portfolio
    expect(r.body.healed).toBe(0);
    expect(h.updates).toHaveLength(0); // but nothing is stamped on a row we don't own
  });

  it('returns resolved charts even when the heal write fails (best-effort)', async () => {
    h.resolveResult = [chart];
    h.rows = [{ id: 'm1', metadata: null }];
    h.updateError = { message: 'boom' };
    const r = await post({ items: [{ id: 'm1', content: '[CHART:waterfall|pnl-waterfall]' }] });
    expect(r.status).toBe(200);
    expect(r.body.resolved).toHaveLength(1);
    expect(r.body.healed).toBe(0);
  });

  it('an unresolvable marker yields nothing (prose stands, nothing invented)', async () => {
    h.resolveResult = [];
    const r = await post({ items: [{ id: 'm1', content: '[CHART:waterfall|pnl-waterfall]' }] });
    expect(r.body).toEqual({ resolved: [], healed: 0 });
    expect(h.updates).toHaveLength(0);
  });
});
