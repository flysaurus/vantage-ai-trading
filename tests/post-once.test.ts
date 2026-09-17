// postOnce — coalesce identical CONCURRENT POSTs (the /api/positions/sync race).
//
// Measured on prod: one portfolio load fired POST /api/positions/sync 3× within
// 120ms. Each is a delete + insert of ~350 rows, and the overlap is what made
// two of the three answer 500. The rule has to stay narrow: coalesce only while
// a request with the same key is IN FLIGHT, so a later poll still writes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { postOnce, __resetPostOnce, __postOnceInflightCount } from '@/lib/http/post-once';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('postOnce', () => {
  beforeEach(() => { __resetPostOnce(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); __resetPostOnce(); });

  it('sends one request for concurrent calls with the same key', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 10));
      return jsonResponse({ synced: 350 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([
      postOnce('/api/positions/sync', { positions: [1] }, { key: 'k' }),
      postOnce('/api/positions/sync', { positions: [1] }, { key: 'k' }),
      postOnce('/api/positions/sync', { positions: [1] }, { key: 'k' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Every caller still gets its own readable body.
    for (const res of [a, b, c]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ synced: 350 });
    }
  });

  it('does not merge different write targets', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      postOnce('/api/positions/sync', { positions: [] }, { key: 'conn-a' }),
      postOnce('/api/positions/sync', { positions: [] }, { key: 'conn-b' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('issues a fresh request once the previous one settled (polls still write)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await postOnce('/api/positions/sync', { positions: [] }, { key: 'k' });
    await postOnce('/api/positions/sync', { positions: [] }, { key: 'k' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(__postOnceInflightCount()).toBe(0);
  });

  it('POSTs JSON with credentials included', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await postOnce('/api/positions/sync', { a: 1 }, { key: 'k' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('a failed request is coalesced but never remembered', async () => {
    let status = 500;
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'boom' }, status));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      postOnce('/api/positions/sync', {}, { key: 'k' }),
      postOnce('/api/positions/sync', {}, { key: 'k' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(500);
    expect(b.status).toBe(500);

    status = 200;
    const retry = await postOnce('/api/positions/sync', {}, { key: 'k' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retry.status).toBe(200);
  });

  it('rejects an already-aborted caller without issuing a request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    controller.abort();
    await expect(postOnce('/api/x', {}, { key: 'k', init: { signal: controller.signal } }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborting one caller does not cancel the shared request for the others', async () => {
    let release: (v: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const aborted = postOnce('/api/x', {}, { key: 'k', init: { signal: controller.signal } });
    const survivor = postOnce('/api/x', {}, { key: 'k' });

    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    release(jsonResponse({ ok: true }));
    expect((await survivor).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a stale settle does not clear a newer entry for the key', async () => {
    const resolvers: Array<(v: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolvers.push(resolve); }));
    vi.stubGlobal('fetch', fetchMock);

    const first = postOnce('/api/positions/sync', {}, { key: 'k' });
    // Drop the entry while the first fetch hangs (what the watchdog can do),
    // then start a second request for the same key.
    __resetPostOnce();
    expect(__postOnceInflightCount()).toBe(0);
    const second = postOnce('/api/positions/sync', {}, { key: 'k' });
    expect(__postOnceInflightCount()).toBe(1);

    resolvers[0](jsonResponse({ ok: true })); // the FIRST settles after the second began
    await expect(first).resolves.toBeDefined();

    // The second entry must survive the first's settle (identity check).
    expect(__postOnceInflightCount()).toBe(1);
    resolvers[1](jsonResponse({ ok: true }));
    expect((await second).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
