// ─── lib/async-guards.ts — the bounded-timeout / bounded-retry contract ───
// Regression cover for the "stuck app" class of bug: a hung auth call or a
// hung /api/auth/me must resolve to a TERMINAL, retryable outcome — never an
// unbounded await.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AUTH_GETUSER_TIMEOUT_MS,
  ME_FETCH_TIMEOUT_MS,
  ME_RETRY_BACKOFF_MS,
  SETUP_TIMEOUT_MS,
  SESSION_FALLBACK_TIMEOUT_MS,
  TimeoutError,
  fetchWithRetry,
  fetchWithTimeout,
  isAbortError,
  isTransientStatus,
  withTimeout,
} from '@/lib/async-guards';

const ok = (body: unknown = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('budgets', () => {
  it('every bound is explicit and finite', () => {
    for (const ms of [AUTH_GETUSER_TIMEOUT_MS, ME_FETCH_TIMEOUT_MS, SETUP_TIMEOUT_MS, SESSION_FALLBACK_TIMEOUT_MS]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(15_000);
    }
    expect(ME_RETRY_BACKOFF_MS.length).toBeGreaterThanOrEqual(2);
    expect(ME_RETRY_BACKOFF_MS[0]).toBe(0); // first attempt is immediate
    expect(ME_RETRY_BACKOFF_MS.length).toBeLessThanOrEqual(4); // bounded, not a forever loop
  });
});

describe('withTimeout', () => {
  it('passes a fast resolution straight through', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 500, 'fast')).resolves.toBe('ok');
  });

  it('rejects with TimeoutError instead of hanging', async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 30, 'hanging-call')).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(never, 30, 'hanging-call')).rejects.toThrow(/hanging-call/);
  });

  it('propagates the underlying rejection (a failure is not a timeout)', async () => {
    const boom = Promise.reject(new Error('boom'));
    await expect(withTimeout(boom, 500, 'x')).rejects.toThrow('boom');
  });
});

describe('isTransientStatus', () => {
  it('classifies retryable vs verdict statuses', () => {
    expect(isTransientStatus(408)).toBe(true);
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(403)).toBe(false);
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(200)).toBe(false);
  });
});

describe('fetchWithTimeout', () => {
  it('aborts a hanging request and reports a TimeoutError', async () => {
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }),
    ) as unknown as typeof fetch;

    await expect(fetchWithTimeout('/api/auth/me', {}, 30)).rejects.toBeInstanceOf(TimeoutError);
    expect(isAbortError(new TimeoutError('x', 1))).toBe(true);
  });

  it('returns the response when the server answers in time', async () => {
    globalThis.fetch = vi.fn(async () => ok({ user: { id: 'u1' } })) as unknown as typeof fetch;
    const res = await fetchWithTimeout('/api/auth/me', {}, 500);
    expect(res.status).toBe(200);
  });
});

describe('fetchWithRetry', () => {
  it('succeeds on the first attempt without retrying', async () => {
    const spy = vi.fn(async () => ok({ user: { id: 'u1' } }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await fetchWithRetry('/api/auth/me', {});
    expect(r.response?.status).toBe(200);
    expect(r.attempts).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries transient 5xx and then succeeds', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(ok({ error: 'boom' }, 503))
      .mockResolvedValueOnce(ok({ error: 'boom' }, 502))
      .mockResolvedValueOnce(ok({ user: { id: 'u1' } }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await fetchWithRetry('/api/auth/me', {}, { backoff: [0, 1, 1] });
    expect(r.response?.status).toBe(200);
    expect(r.attempts).toBe(3);
  });

  it('retries network errors and then gives up with a terminal, retryable outcome', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const r = await fetchWithRetry('/api/auth/me', {}, {
      backoff: [0, 1, 1],
      onAttempt: (_a, outcome) => seen.push(outcome),
    });
    expect(r.response).toBeNull();
    expect(r.terminalStatus).toBeNull(); // exhausted, NOT an auth verdict
    expect(r.attempts).toBe(3);
    expect(r.lastError).toBeInstanceOf(TypeError);
    expect(seen).toEqual(['network-error', 'network-error', 'network-error']);
  });

  it('never retries a 401/403 — that is the server’s verdict, not a blip', async () => {
    const spy = vi.fn(async () => ok({ error: 'unauthorized' }, 401));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await fetchWithRetry('/api/auth/me', {}, { backoff: [0, 1, 1] });
    expect(r.terminalStatus).toBe(401);
    expect(r.attempts).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('treats an aborted (hung) attempt as retryable', async () => {
    let call = 0;
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        return new Promise<Response>((_res, reject) =>
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          }),
        );
      }
      return Promise.resolve(ok({ user: { id: 'u1' } }));
    }) as unknown as typeof fetch;

    const r = await fetchWithRetry('/api/auth/me', {}, { timeoutMs: 25, backoff: [0, 1] });
    expect(r.response?.status).toBe(200);
    expect(r.attempts).toBe(2);
  });
});
