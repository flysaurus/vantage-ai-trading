// syncFilledOrders — session dedup + account stamp pass-through.
//
// The caller re-runs this after every orders refresh (30s poll) with the FULL
// filled-order list. Before the dedup set, every tick re-POSTed every filled
// order (measured live on prod: 129 POSTs to /trade-history/create in 75s).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncFilledOrders, createTrade, __clearSyncedFilledOrderCache } from '@/lib/supabase/trades';

const filled = (id: string, symbol = 'KO') => ({
  id, symbol, side: 'buy' as const, filledQty: 1, filledPrice: 10, createdAt: '2026-09-16T14:00:00Z',
});

describe('syncFilledOrders', () => {
  let bodies: any[];

  beforeEach(() => {
    bodies = [];
    __clearSyncedFilledOrderCache();
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 'th-1', _existing: false }) } as any;
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts each filled order once, then no-ops on repeat calls', async () => {
    const first = await syncFilledOrders('u1', [filled('o1'), filled('o2', 'MSFT')]);
    expect(first).toBe(2);
    expect(bodies.length).toBe(2);

    const second = await syncFilledOrders('u1', [filled('o1'), filled('o2', 'MSFT')]);
    expect(second).toBe(0);
    expect(bodies.length).toBe(2); // no new requests — this was the storm
  });

  it('still posts a genuinely new order that appears on a later poll', async () => {
    await syncFilledOrders('u1', [filled('o1')]);
    const n = await syncFilledOrders('u1', [filled('o1'), filled('o3', 'SPY')]);
    expect(n).toBe(1);
    expect(bodies.length).toBe(2);
    expect(bodies[1].alpacaOrderId).toBe('o3');
  });

  it('dedup is per user (another user’s identical order id is not skipped)', async () => {
    await syncFilledOrders('u1', [filled('o1')]);
    await syncFilledOrders('u2', [filled('o1')]);
    expect(bodies.length).toBe(2);
  });

  it('passes the active-account snapAccountId through to the create body', async () => {
    await syncFilledOrders('u1', [filled('o9')], 'conn-1', 'snap-acct-1');
    expect(bodies[0].snapAccountId).toBe('snap-acct-1');
    expect(bodies[0].connectionId).toBe('conn-1');
  });

  it('marks an order synced even when the server reports _existing (no re-post)', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 'th-1', _existing: true }) } as any;
    });
    const n = await syncFilledOrders('u1', [filled('o5')]);
    expect(n).toBe(0); // already existed server-side
    await syncFilledOrders('u1', [filled('o5')]);
    expect(bodies.length).toBe(1);
  });

  it('two overlapping sync passes post each order once (claim-before-await)', async () => {
    const list = [filled('c1'), filled('c2', 'MSFT'), filled('c3', 'SPY')];
    // Slow responses so both passes are in flight simultaneously — this is the
    // race that double-posted every order on prod.
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      await new Promise((r) => setTimeout(r, 25));
      return { ok: true, json: async () => ({ id: 'th-1', _existing: false }) } as any;
    });
    await Promise.all([syncFilledOrders('u1', list), syncFilledOrders('u1', list)]);
    expect(bodies.length).toBe(3);
  });

  it('releases the claim when a create fails so a later poll can retry', async () => {
    let fail = true;
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (fail) return { ok: false, status: 500, text: async () => 'boom' } as any;
      return { ok: true, json: async () => ({ id: 'th-1', _existing: false }) } as any;
    });
    expect(await syncFilledOrders('u1', [filled('r1')])).toBe(0);
    fail = false;
    expect(await syncFilledOrders('u1', [filled('r1')])).toBe(1);
    expect(bodies.length).toBe(2);
  });

  it('createTrade surfaces a failed create as null', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, text: async () => 'boom' }) as any);
    const r = await createTrade({ userId: 'u1', symbol: 'KO', action: 'buy', quantity: 1, price: 1 });
    expect(r).toBeNull();
  });
});
