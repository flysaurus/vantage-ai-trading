// ─── Shared GET de-duplication + short-TTL cache ──────────────
//
// Why this exists: the portfolio screens fan out *identical* GETs on first
// paint, and each duplicate is a full serverless invocation — for broker
// routes, an upstream SnapTrade round trip as well. Measured on prod, a single
// load of `/` produced:
//
//   • `GET /api/auth/me`                     ×3  (route gate + auth provider + greeting)
//   • `GET /api/broker/snaptrade/account`    ×3  (one per `usePortfolio` mount)
//   • `GET /api/stock/fundamentals`          ~75 (25 held symbols × 3 waves)
//
// The duplicates compete with each other, so each copy gets slower (one
// account fetch was measured at 14.3s). This module collapses them:
//
//   • identical *concurrent* GETs share ONE fetch (in-flight coalescing) —
//     always on, because two simultaneous reads of the same URL are by
//     definition asking the same question;
//   • a few read-only, slow-moving endpoints additionally opt into a short
//     TTL (see `GET_TTL_MS`) — this is what collapses the repeated
//     fundamentals waves;
//   • POST/PUT/DELETE are never touched (see `lib/api-client.ts`).
//
// Every caller receives its OWN `Response`, so reading the body in one caller
// never breaks another (unlike sharing a single `Response` object).

type BufferedResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string | null;
};

/**
 * Paths that may serve a cached copy for this long (ms). Deliberately tiny and
 * restricted to read-only, slow-moving data:
 *   • `/api/auth/me`            — profile; changes only via explicit edits
 *   • `/api/stock/fundamentals` — reference/analyst data, not live pricing
 * Live pricing endpoints (`/api/market/quotes`, sparklines) are NOT listed on
 * purpose: a stale price is worse than a duplicate request.
 * Query strings are ignored for the lookup, so `?symbol=KO` shares the entry
 * for that path (the cache key is still the full URL, so different symbols
 * never collide).
 */
export const GET_TTL_MS: Record<string, number> = {
  '/api/auth/me': 5_000,
  '/api/stock/fundamentals': 60_000,
};

const inflight = new Map<string, InflightEntry>();
const ttlCache = new Map<string, { at: number; value: BufferedResponse }>();

/**
 * One shared request plus the number of callers still waiting on it.
 *
 * `waiters` is what keeps a timeout from poisoning the next attempt: when the
 * last waiting caller gives up (its own signal aborted) the entry is dropped,
 * so a retry issues a FRESH request instead of joining a zombie. That matters
 * for `lib/async-guards.ts`, which retries a timed-out `/api/auth/me` — without
 * the release, every retry would queue behind the same hung request and the
 * app would go back to showing a terminal error where it used to recover.
 */
type InflightEntry = { promise: Promise<BufferedResponse>; waiters: number };

/** Statuses that must not carry a body (constructing a Response with one throws). */
const NO_BODY_STATUS = new Set([204, 205, 304]);

/**
 * A shared request that never settles must not poison every later caller of the
 * same URL (the "stuck app" class this codebase already guards against, e.g. a
 * half-open socket). After this long the in-flight entry is abandoned so the
 * next caller starts a fresh request. Callers with their own signal are still
 * bounded by that signal, independently of this.
 */
export const SHARED_GET_ABANDON_MS = 20_000;

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** TTL for a URL (0 = in-flight coalescing only, never cached). */
export function getCacheTtlMs(url: string): number {
  return GET_TTL_MS[pathOf(url)] ?? 0;
}

function toResponse(v: BufferedResponse): Response {
  return new Response(v.body, {
    status: v.status,
    statusText: v.statusText,
    headers: new Headers(v.headers),
  });
}

async function bufferResponse(res: Response): Promise<BufferedResponse> {
  const body = NO_BODY_STATUS.has(res.status) ? null : await res.text();
  return {
    status: res.status,
    statusText: res.statusText,
    headers: Array.from(res.headers.entries()),
    body,
  };
}

function abortError(): Error {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

/**
 * GET `url`, coalescing identical in-flight requests (and serving a cached copy
 * for TTL-opted paths).
 *
 * `init.signal` is honoured *per caller*: aborting one caller rejects only that
 * caller — the shared request keeps running for the others, and an aborted
 * request never poisons the cache.
 */
export function dedupedGet(url: string, init: RequestInit = {}): Promise<Response> {
  const { signal, ...rest } = init;

  // Abort-first: an already-aborted caller must not issue (or join) a request.
  if (signal?.aborted) return Promise.reject(abortError());

  const ttl = getCacheTtlMs(url);

  if (ttl > 0) {
    const hit = ttlCache.get(url);
    if (hit) {
      if (Date.now() - hit.at < ttl) return Promise.resolve(toResponse(hit.value));
      ttlCache.delete(url);
    }
  }

  // ── Claim (or join) the shared request ──
  let entry = inflight.get(url);
  if (entry) {
    entry.waiters += 1;
  } else {
    entry = { promise: undefined as unknown as Promise<BufferedResponse>, waiters: 1 };
    const self = entry;

    // NOTE: the caller's signal is intentionally NOT threaded into the shared
    // request — one consumer must not cancel another's read.
    self.promise = fetch(url, { credentials: 'include', ...rest })
      .then(async (res) => {
        const buffered = await bufferResponse(res);
        // Only successful reads are worth remembering; an error is retried on
        // the next call rather than pinned for the TTL.
        if (res.ok && ttl > 0) ttlCache.set(url, { at: Date.now(), value: buffered });
        return buffered;
      })
      .finally(() => {
        if (inflight.get(url) === self) inflight.delete(url);
      });

    inflight.set(url, self);

    // Watchdog: drop the entry if the request hangs, so later callers retry
    // instead of queueing behind it forever.
    const watchdog = setTimeout(() => {
      if (inflight.get(url) === self) inflight.delete(url);
    }, SHARED_GET_ABANDON_MS);
    // Node keeps the process alive for pending timers; tests and server runtimes
    // don't need that.
    (watchdog as unknown as { unref?: () => void }).unref?.();
    const clear = () => clearTimeout(watchdog);
    self.promise.then(clear, clear);
  }
  const shared = entry;

  /** This caller is no longer interested: if it was the last one, drop the entry. */
  const release = () => {
    shared.waiters -= 1;
    if (shared.waiters <= 0 && inflight.get(url) === shared) inflight.delete(url);
  };

  if (!signal) {
    return shared.promise.then(
      (v) => {
        release();
        return toResponse(v);
      },
      (e) => {
        release();
        throw e;
      },
    );
  }

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      // Only this caller gives up. If nobody else is waiting, forget the entry
      // so the next attempt is a real request rather than a join on a hang.
      release();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        release();
        resolve(toResponse(v));
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        release();
        reject(e);
      },
    );
  });
}

/**
 * Drop cached TTL entries (in-flight requests are unaffected).
 * `match` omitted → clear everything.
 */
export function invalidateGetCache(match?: string): void {
  if (!match) {
    ttlCache.clear();
    return;
  }
  for (const key of Array.from(ttlCache.keys())) {
    if (key.includes(match)) ttlCache.delete(key);
  }
}

/** Test seam: forget all in-flight + TTL state. */
export function __resetGetCache(): void {
  inflight.clear();
  ttlCache.clear();
}
