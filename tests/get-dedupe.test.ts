// ─── Shared GET de-dupe + TTL cache ───────────────────────────
// Guards the first-paint fan-out fix: identical concurrent GETs must share one
// fetch, TTL-opted paths must serve a cached copy inside the window, and
// nothing else (errors, writes, distinct URLs) may be cached.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  dedupedGet,
  invalidateGetCache,
  __resetGetCache,
  getCacheTtlMs,
} from '@/lib/http/get-cache';
import { apiGet, apiPost } from '@/lib/api-client';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

let now = 1_000_000;

beforeEach(() => {
  __resetGetCache();
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetGetCache();
});

describe('dedupedGet — in-flight coalescing', () => {
  it('shares ONE fetch between concurrent identical GETs, each caller gets a readable body', async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({ ok: true, n: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const url = '/api/broker/snaptrade/account?connectionId=c1&snapAccountId=a1';
    const [r1, r2, r3] = await Promise.all([dedupedGet(url), dedupedGet(url), dedupedGet(url)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Every caller can read the body independently — this is the whole reason
    // we buffer instead of handing out one Response object.
    await expect(r1.json()).resolves.toEqual({ ok: true, n: 1 });
    await expect(r2.json()).resolves.toEqual({ ok: true, n: 1 });
    await expect(r3.json()).resolves.toEqual({ ok: true, n: 1 });
  });

  it('preserves status and headers for each caller', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ a: 1 }, 201, { 'x-test': 'yes' })));
    const res = await dedupedGet('/api/thing');
    expect(res.status).toBe(201);
    expect(res.headers.get('x-test')).toBe('yes');
  });

  it('sends credentials: include by default', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    await dedupedGet('/api/thing');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('does NOT merge distinct URLs (different query strings, and fresh=1 vs cached)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      dedupedGet('/api/stock/fundamentals?symbol=KO'),
      dedupedGet('/api/stock/fundamentals?symbol=MSFT'),
      dedupedGet('/api/broker/snaptrade/account?connectionId=c1'),
      dedupedGet('/api/broker/snaptrade/account?connectionId=c1&fresh=1'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not cache paths without a TTL — sequential calls always refetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ price: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await dedupedGet('/api/market/quotes?symbols=KO');
    await dedupedGet('/api/market/quotes?symbols=KO');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('dedupedGet — TTL cache', () => {
  it('exposes the TTL table only for read-only, slow-moving paths', () => {
    expect(getCacheTtlMs('/api/auth/me')).toBe(5_000);
    expect(getCacheTtlMs('/api/auth/me?x=1')).toBe(5_000);
    expect(getCacheTtlMs('/api/stock/fundamentals?symbol=KO')).toBe(60_000);
    expect(getCacheTtlMs('/api/market/quotes?symbols=KO')).toBe(0);
    expect(getCacheTtlMs('/api/broker/snaptrade/account')).toBe(0);
  });

  it('serves a cached fundamentals copy inside the window and refetches after it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ pe: 12 }));
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/stock/fundamentals?symbol=KO';

    await dedupedGet(url);
    now += 59_000;
    await dedupedGet(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 2_000; // past the 60s window
    await dedupedGet(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('/api/auth/me is cached for 5s (collapses the 3 first-paint callers) then refetches', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: { id: 'u1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await dedupedGet('/api/auth/me');
    now += 1_000;
    await dedupedGet('/api/auth/me');
    now += 1_000;
    await dedupedGet('/api/auth/me');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 4_000; // 6s since the fetch
    await dedupedGet('/api/auth/me');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never pins an error response — a failed read is retried immediately', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ pe: 9 }));
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/stock/fundamentals?symbol=KO';

    const bad = await dedupedGet(url);
    expect(bad.status).toBe(500);
    const good = await dedupedGet(url);
    expect(good.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateGetCache forces a refetch (and can be scoped)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await dedupedGet('/api/auth/me');
    await dedupedGet('/api/stock/fundamentals?symbol=KO');
    invalidateGetCache('/api/auth/me');
    await dedupedGet('/api/auth/me');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // the untouched key still hits its cache
    await dedupedGet('/api/stock/fundamentals?symbol=KO');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears all TTL entries when no match is given', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    await dedupedGet('/api/auth/me');
    invalidateGetCache();
    await dedupedGet('/api/auth/me');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('dedupedGet — abort handling', () => {
  it('rejects an already-aborted caller without issuing a request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(dedupedGet('/api/accounts', { signal: ctrl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborting one caller does not cancel the shared request for the others', async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ctrl = new AbortController();
    const aborted = dedupedGet('/api/accounts', { signal: ctrl.signal });
    const survivor = dedupedGet('/api/accounts');

    ctrl.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    release(jsonResponse({ accounts: [] }));
    const res = await survivor;
    await expect(res.json()).resolves.toEqual({ accounts: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('api-client wiring', () => {
  it('apiGet coalesces identical concurrent reads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: { id: 'u1' } }));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([apiGet('/api/auth/me'), apiGet('/api/auth/me')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(a.json()).resolves.toEqual({ user: { id: 'u1' } });
    await expect(b.json()).resolves.toEqual({ user: { id: 'u1' } });
  });

  it('apiPost is never coalesced (writes must always reach the server)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([apiPost('/api/positions/sync', { x: 1 }), apiPost('/api/positions/sync', { x: 1 })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
