import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cachedFinnhub,
  rateLimitedTtl,
  takeBudget,
  __resetFinnhubBudget,
  RATE_LIMITED_TTL,
  NULL_RESULT_TTL,
  TTL,
  type CacheClient,
  type HttpResult,
} from '@/lib/finnhub/gateway';

// ─── In-memory cache client (structural stand-in for Supabase) ──────────────

function fakeSupabase() {
  const rows = new Map<string, any>();
  const writes: any[] = [];
  const reads: string[] = [];
  const client: CacheClient = {
    from() {
      return {
        select() {
          return {
            eq(_col: string, value: unknown) {
              return {
                async maybeSingle() {
                  reads.push(String(value));
                  return { data: rows.get(String(value)) ?? null, error: null };
                },
              };
            },
          };
        },
        async upsert(row: Record<string, unknown>) {
          writes.push(row);
          rows.set(String(row.key), row);
          return { error: null };
        },
      } as any;
    },
  };
  return { client, rows, writes, reads };
}

function live(status: number, data: unknown = null, retryAfter?: string) {
  return async (): Promise<HttpResult> => ({ status, ok: status >= 200 && status < 300, data, retryAfter });
}

const baseCall = (supabase: CacheClient | null, fetchFn: any, overrides: Record<string, unknown> = {}) => ({
  supabase,
  key: 'profile2:AAPL',
  ttlSeconds: TTL.profile,
  path: '/stock/profile2',
  params: { symbol: 'AAPL' },
  map: (d: any) => (d && d.ticker ? { ticker: d.ticker } : null),
  fetchFn,
  ...overrides,
});

beforeEach(() => {
  __resetFinnhubBudget();
  delete process.env.FINNHUB_CACHE_ENABLED;
  delete process.env.FINNHUB_BUDGET_INTERACTIVE_PER_MIN;
  delete process.env.FINNHUB_BUDGET_CRON_PER_MIN;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('finnhub gateway — TTL separation', () => {
  it('rate_limited ttl is short (minutes) and distinct from null_result (days)', () => {
    expect(RATE_LIMITED_TTL).toBeLessThanOrEqual(600);
    expect(RATE_LIMITED_TTL).toBeGreaterThanOrEqual(30);
    expect(NULL_RESULT_TTL).toBeGreaterThanOrEqual(24 * 3600);
    // The whole point: a throttle retries SOON, an unknown symbol does NOT.
    expect(RATE_LIMITED_TTL).toBeLessThan(NULL_RESULT_TTL);
  });

  it('honours Retry-After but clamps to a minutes-scale window', () => {
    expect(rateLimitedTtl('90')).toBe(90);
    expect(rateLimitedTtl('5')).toBe(30); // clamped up (too aggressive to retry in 5s)
    expect(rateLimitedTtl('99999')).toBe(600); // clamped down (cap)
    expect(rateLimitedTtl(null)).toBe(RATE_LIMITED_TTL);
    expect(rateLimitedTtl('not-a-number')).toBe(RATE_LIMITED_TTL);
  });
});

describe('finnhub gateway — mode: off (passthrough, today’s behaviour)', () => {
  it('calls live and never touches the cache', async () => {
    const { client, writes, reads } = fakeSupabase();
    const fetchFn = vi.fn(live(200, { ticker: 'AAPL' }));
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    expect(out).toEqual({ ticker: 'AAPL' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });
});

describe('finnhub gateway — mode: on', () => {
  it('serves a fresh `ok` from cache without a network call', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'on';
    const { client, rows } = fakeSupabase();
    rows.set('profile2:AAPL', {
      key: 'profile2:AAPL',
      payload: { ticker: 'AAPL', name: 'cached' },
      status: 'ok',
      fetched_at: new Date().toISOString(),
      ttl_seconds: TTL.profile,
    });
    const fetchFn = vi.fn(live(200, { ticker: 'AAPL' }));
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    expect(out).toEqual({ ticker: 'AAPL', name: 'cached' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('memoizes a 429 as rate_limited with a SHORT ttl (and keeps last good value)', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'on';
    const { client, rows, writes } = fakeSupabase();
    rows.set('profile2:AAPL', {
      key: 'profile2:AAPL',
      payload: { ticker: 'AAPL', name: 'stale-but-true' },
      status: 'ok',
      // expired → forces a live attempt
      fetched_at: new Date(Date.now() - (TTL.profile + 60) * 1000).toISOString(),
      ttl_seconds: TTL.profile,
    });
    const fetchFn = vi.fn(live(429, null, '120'));
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    // Falls back to the stale-but-real value rather than pretending unknown.
    expect(out).toEqual({ ticker: 'AAPL', name: 'stale-but-true' });
    const written = writes.at(-1);
    expect(written.status).toBe('rate_limited');
    expect(written.ttl_seconds).toBe(120);
    expect(written.ttl_seconds).toBeLessThan(NULL_RESULT_TTL);
  });

  it('inside a 429 cooldown it does NOT re-burn a request', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'on';
    const { client, rows } = fakeSupabase();
    rows.set('profile2:AAPL', {
      key: 'profile2:AAPL',
      payload: null,
      status: 'rate_limited',
      fetched_at: new Date().toISOString(),
      ttl_seconds: RATE_LIMITED_TTL,
    });
    const fetchFn = vi.fn(live(200, { ticker: 'AAPL' }));
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    expect(out).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('memoizes a genuine unknown symbol as null_result with a LONG ttl', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'on';
    const { client, writes } = fakeSupabase();
    const fetchFn = vi.fn(live(200, {})); // empty object = unknown symbol
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    expect(out).toBeNull();
    const written = writes.at(-1);
    expect(written.status).toBe('null_result');
    expect(written.ttl_seconds).toBe(NULL_RESULT_TTL);
  });

  it('a refresh of a fresh null_result does not re-ask', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'on';
    const { client, rows } = fakeSupabase();
    rows.set('profile2:AAPL', {
      key: 'profile2:AAPL',
      payload: null,
      status: 'null_result',
      fetched_at: new Date().toISOString(),
      ttl_seconds: NULL_RESULT_TTL,
    });
    const fetchFn = vi.fn(live(200, {}));
    expect(await cachedFinnhub(baseCall(client, fetchFn))).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does NOT memoize a non-429 4xx as an unknown symbol', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'on';
    const { client, writes } = fakeSupabase();
    const fetchFn = vi.fn(live(401));
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    expect(out).toBeNull();
    expect(writes).toHaveLength(0); // auth error must not poison the cache
  });

  it('a budget-exhausted miss returns unknown (never a fabricated value)', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'on';
    process.env.FINNHUB_BUDGET_INTERACTIVE_PER_MIN = '1';
    const { client } = fakeSupabase();
    expect(takeBudget('interactive')).toBe(true); // spend the only slot
    const fetchFn = vi.fn(live(200, { ticker: 'AAPL' }));
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    expect(out).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('finnhub gateway — mode: shadow', () => {
  it('ALWAYS calls live (behaviour unchanged) but populates the cache', async () => {
    process.env.FINNHUB_CACHE_ENABLED = 'shadow';
    const { client, rows, writes } = fakeSupabase();
    rows.set('profile2:AAPL', {
      key: 'profile2:AAPL',
      payload: { ticker: 'AAPL', name: 'cached' },
      status: 'ok',
      fetched_at: new Date().toISOString(),
      ttl_seconds: TTL.profile,
    });
    const fetchFn = vi.fn(live(200, { ticker: 'AAPL', name: 'live' }));
    const out = await cachedFinnhub(baseCall(client, fetchFn));
    expect(out).toEqual({ ticker: 'AAPL' }); // live wins, not the cache
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(writes.at(-1).status).toBe('ok');
  });
});
