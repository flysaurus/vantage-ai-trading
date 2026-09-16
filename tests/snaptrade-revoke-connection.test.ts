// Tests for revokeConnection — the disconnect path must be able to REPORT the
// real SnapTrade revoke outcome (status + error), not just a boolean.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { revokeConnection } from '@/lib/snaptrade/client';

const C = { clientId: 'cid', consumerKey: 'ckey' };

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.SNAPTRADE_CLIENT_ID = C.clientId;
  process.env.SNAPTRADE_CONSUMER_KEY = C.consumerKey;
});

describe('revokeConnection', () => {
  it('reports ok=true with the HTTP status on success', async () => {
    process.env.SNAPTRADE_CLIENT_ID = C.clientId;
    process.env.SNAPTRADE_CONSUMER_KEY = C.consumerKey;
    let seenMethod = '';
    let seenUrl = '';
    stubFetch(async (url, init) => {
      seenUrl = url; seenMethod = String(init.method);
      return new Response(null, { status: 204 });
    });

    const res = await revokeConnection('auth-123', 'user-1', 'secret-1');

    expect(res).toEqual({ ok: true, status: 204, error: null });
    expect(seenMethod).toBe('DELETE');
    expect(seenUrl).toContain('/authorizations/auth-123');
  });

  it('issues DELETE (not GET/POST) so the authorization is really removed', async () => {
    process.env.SNAPTRADE_CLIENT_ID = C.clientId;
    process.env.SNAPTRADE_CONSUMER_KEY = C.consumerKey;
    const methods: string[] = [];
    stubFetch(async (_url, init) => { methods.push(String(init.method)); return new Response('', { status: 200 }); });

    await revokeConnection('auth-9', 'u', 's');
    expect(methods).toEqual(['DELETE']);
  });

  it('reports ok=false with status + error detail on failure (never throws)', async () => {
    process.env.SNAPTRADE_CLIENT_ID = C.clientId;
    process.env.SNAPTRADE_CONSUMER_KEY = C.consumerKey;
    stubFetch(async () =>
      new Response(JSON.stringify({ detail: 'Authorization not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      }));

    const res = await revokeConnection('gone', 'u', 's');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error).toContain('404');
    expect(res.error).toContain('Authorization not found');
  });

  it('reports a network failure as ok=false status=0', async () => {
    process.env.SNAPTRADE_CLIENT_ID = C.clientId;
    process.env.SNAPTRADE_CONSUMER_KEY = C.consumerKey;
    stubFetch(async () => { throw new Error('ECONNREFUSED'); });

    const res = await revokeConnection('x', 'u', 's');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error).toMatch(/network/i);
  });
});
