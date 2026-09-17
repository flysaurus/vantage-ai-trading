// syncFilledOrders — session dedup, batching, and account stamp pass-through.
//
// The caller re-runs this after every orders refresh (30s poll) with the FULL
// filled-order list. Two live-measured defects came from that:
//   - every tick re-POSTed every filled order per order (129 POSTs in 75s), and
//   - a fresh page load re-POSTed the whole book one request at a time
//     (35–36 sequential POSTs, ~20s of churn for rows the server already had).
// It now sends ONE batched request per pass and still marks each order once.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncFilledOrders, createTrade, __clearSyncedFilledOrderCache } from '@/lib/supabase/trades';

const filled = (id: string, symbol = 'KO') => ({
  id, symbol, side: 'buy' as const, filledQty: 1, filledPrice: 10, createdAt: '2026-09-16T14:00:00Z',
});

describe('syncFilledOrders', () => {
  let bodies: any[];
  let urls: string[];

  beforeEach(() => {
    bodies = [];
    urls = [];
    __clearSyncedFilledOrderCache();
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      urls.push(String(url));
      if (init?.body) bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ inserted: 1, existing: 0 }) } as any;
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends ONE batched request for the whole book, then no-ops on repeat calls', async () => {
    const first = await syncFilledOrders('u1', [filled('o1'), filled('o2', 'MSFT')]);
    expect(first).toBe(1);
    expect(urls.length).toBe(1); // this was 2 before batching
    expect(urls[0]).toContain('/api/db/trade-history/sync-batch');
    expect(bodies[0].orders).toHaveLength(2);
    expect(bodies[0].orders[0]).toMatchObject({ symbol: 'KO', action: 'buy', quantity: 1, price: 10 });

    const second = await syncFilledOrders('u1', [filled('o1'), filled('o2', 'MSFT')]);
    expect(second).toBe(0);
    expect(urls.length).toBe(1); // no new request — this was the storm
  });

  it('still sends a genuinely new order that appears on a later poll', async () => {
    await syncFilledOrders('u1', [filled('o1')]);
    const n = await syncFilledOrders('u1', [filled('o1'), filled('o3', 'SPY')]);
    expect(n).toBe(1);
    expect(urls.length).toBe(2);
    // Only the new order travels — already-synced ones are not re-sent.
    expect(bodies[1].orders).toHaveLength(1);
    expect(bodies[1].orders[0].symbol).toBe('SPY');
  });

  it('dedup is per user (another user’s identical order id is not skipped)', async () => {
    await syncFilledOrders('u1', [filled('o1')]);
    await syncFilledOrders('u2', [filled('o1')]);
    expect(urls.length).toBe(2);
  });

  it('passes the active-account scope at the top level of the batch', async () => {
    await syncFilledOrders('u1', [filled('o9')], 'conn-1', 'snap-acct-1');
    expect(bodies[0].snapAccountId).toBe('snap-acct-1');
    expect(bodies[0].connectionId).toBe('conn-1');
  });

  it('two overlapping sync passes send ONE request with every order (claim-before-await)', async () => {
    const list = [filled('c1'), filled('c2', 'MSFT'), filled('c3', 'SPY')];
    // Slow response so both passes are in flight simultaneously — this is the
    // race that double-posted every order on prod, and the reason two of three
    // /api/positions/sync calls used to collide.
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      urls.push(String(url));
      if (init?.body) bodies.push(JSON.parse(init.body));
      await new Promise((r) => setTimeout(r, 25));
      return { ok: true, json: async () => ({ inserted: 3 }) } as any;
    });
    await Promise.all([syncFilledOrders('u1', list), syncFilledOrders('u1', list)]);
    expect(urls.length).toBe(1);
    expect(bodies[0].orders).toHaveLength(3);
  });

  it('releases every claim when the batch fails so a later poll can retry', async () => {
    let fail = true;
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      urls.push(String(url));
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (fail) return { ok: false, status: 500, text: async () => 'boom' } as any;
      return { ok: true, json: async () => ({ inserted: 1 }) } as any;
    });
    expect(await syncFilledOrders('u1', [filled('r1')])).toBe(0);
    fail = false;
    expect(await syncFilledOrders('u1', [filled('r1')])).toBe(1);
    expect(urls.length).toBe(2);
  });

  it('sends nothing (and makes no request) when there is nothing new', async () => {
    const n = await syncFilledOrders('u1', []);
    expect(n).toBe(0);
    expect(urls.length).toBe(0);
  });

  it('skips orders with no fill price/qty', async () => {
    const n = await syncFilledOrders('u1', [
      { id: 'x1', symbol: 'KO', side: 'buy', filledQty: 0, filledPrice: 10, createdAt: '2026-09-16T14:00:00Z' },
      { id: 'x2', symbol: 'KO', side: 'buy', filledQty: 1, filledPrice: 0, createdAt: '2026-09-16T14:00:00Z' },
    ]);
    expect(n).toBe(0);
    expect(urls.length).toBe(0);
  });

  it('createTrade (single-write path) still surfaces a failed create as null', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, text: async () => 'boom' }) as any);
    const r = await createTrade({ userId: 'u1', symbol: 'KO', action: 'buy', quantity: 1, price: 1 });
    expect(r).toBeNull();
  });
});
