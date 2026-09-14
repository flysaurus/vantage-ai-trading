// ─── Async guards: timeouts + bounded retry ─────────────────────────
//
// Extracted from lib/app-state.ts so the behaviour is unit-testable
// without a React/DOM environment.
//
// WHY THIS EXISTS (the "stuck app" class of bug):
//   useAppState started life with two network awaits that had NO timeout
//   and NO retry — `supabase.auth.getUser()` and `fetch('/api/auth/me')`.
//   If either *hangs* (half-open socket, stalled upstream, suspended tab
//   throttling, flaky mobile network), the hook never leaves its initial
//   `'loading'` state, and app/page.tsx renders the orb splash forever.
//   A hang is worse than a failure: a failure is at least revisited.
//
// THE CONTRACT:
//   1. Every network await is bounded by an explicit timeout.
//   2. Transient failures (5xx / 408 / 429 / network error / timeout) are
//      retried a small, bounded number of times with backoff.
//   3. Exhaustion produces a TERMINAL, visible state — never an endless
//      splash. (Silently falling through to `'onboarding'` is just as bad:
//      it shows a signed-in user the intro flow, which reads as data loss.)

/** Bound for `supabase.auth.getUser()` (a network round-trip to the auth server). */
export const AUTH_GETUSER_TIMEOUT_MS = 8_000;
/** Bound for the local-storage session fallback (should be instant). */
export const SESSION_FALLBACK_TIMEOUT_MS = 5_000;
/** Bound for a single `/api/auth/me` attempt. */
export const ME_FETCH_TIMEOUT_MS = 8_000;
/** Bound for the best-effort profile auto-heal POST (never blocks routing). */
export const SETUP_TIMEOUT_MS = 6_000;
/** Delay before each attempt; length = max attempts. First attempt is immediate. */
export const ME_RETRY_BACKOFF_MS = [0, 500, 1_500] as const;

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Reject if `promise` has not settled within `ms`. The original promise is
 *  NOT cancelled (we cannot cancel all of them) — we just stop waiting on it. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError' || err instanceof TimeoutError;
}

/** Was the failure worth retrying? 401/403 are NOT (they are a verdict). */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** fetch() bounded by an AbortController-backed timeout. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms: number = ME_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (isAbortError(err) || (err as { name?: string })?.name === 'AbortError') {
      throw new TimeoutError(`fetch ${url}`, ms);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  timeoutMs?: number;
  /** Per-attempt delay; its length sets the attempt cap. */
  backoff?: readonly number[];
  /** Optional hook for logging/tests. */
  onAttempt?: (attempt: number, outcome: 'ok' | 'transient' | 'unauthorized' | 'network-error') => void;
}

export interface RetryResult {
  /** Present when a 2xx response came back. */
  response: Response | null;
  /** Terminal non-transient status (e.g. 401/403), when the server said no. */
  terminalStatus: number | null;
  attempts: number;
  lastError: unknown;
}

/**
 * Bounded retry around `fetchWithTimeout`.
 * Resolves (never rejects) with the outcome so the caller can branch:
 *  - `response`  → success
 *  - `terminalStatus` → 4xx that is NOT transient (caller decides, e.g. sign out)
 *  - neither, `attempts === backoff.length` → exhausted (timeout / network / 5xx)
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<RetryResult> {
  const { timeoutMs = ME_FETCH_TIMEOUT_MS, backoff = ME_RETRY_BACKOFF_MS, onAttempt } = options;
  let lastError: unknown = null;
  let attempts = 0;

  for (let i = 0; i < backoff.length; i++) {
    if (backoff[i] > 0) await sleep(backoff[i]);
    attempts = i + 1;
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (res.ok) {
        onAttempt?.(attempts, 'ok');
        return { response: res, terminalStatus: null, attempts, lastError: null };
      }
      if (!isTransientStatus(res.status)) {
        onAttempt?.(attempts, 'unauthorized');
        return { response: null, terminalStatus: res.status, attempts, lastError: null };
      }
      lastError = new Error(`${url} returned ${res.status}`);
      onAttempt?.(attempts, 'transient');
    } catch (err) {
      lastError = err;
      onAttempt?.(attempts, 'network-error');
    }
  }

  return { response: null, terminalStatus: null, attempts, lastError };
}
