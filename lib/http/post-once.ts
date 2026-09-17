// ─── Coalesce identical CONCURRENT POSTs ────────────────────────────────────
//
// `dedupedGet` (lib/http/get-cache.ts) collapses duplicate reads. The same
// problem exists on the write side for a specific shape: a hook fires the same
// idempotent "sync this payload" POST several times in the same tick.
//
// Measured on prod: `POST /api/positions/sync` fired **3× within 120ms** on a
// single portfolio load (`refresh()` is re-run by more than one effect and a
// poll can land mid-refresh). Each call is a delete + insert of ~350 rows, and
// because they overlapped, two of the three returned 500 — the first request's
// insert collided with the second's delete-then-insert window.
//
// This is deliberately narrower than a cache: it only coalesces while a request
// with the same key is IN FLIGHT. Once it settles, a later call issues a fresh
// request, so a 30s poll still writes. Nothing is remembered across calls, so a
// legitimately changed payload can never be swallowed by a stale entry.
//
// The caller must pass a `key` that identifies the write target (e.g.
// connection + sub-account). Two DIFFERENT payloads for the same target still
// coalesce — which is correct for a state-sync write: the later payload
// describes a slightly newer state of the same thing, and the next poll
// persists it. A different target must use a different key.

type BufferedResult = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string | null;
};

const inflight = new Map<string, Promise<BufferedResult>>();

/** Statuses that carry no body (matches fetch's Response semantics). */
const NO_BODY_STATUS = new Set([204, 205, 304]);

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function toResponse(buffered: BufferedResult): Response {
  const body = NO_BODY_STATUS.has(buffered.status) ? null : buffered.body;
  return new Response(body, {
    status: buffered.status,
    statusText: buffered.statusText,
    headers: buffered.headers,
  });
}

async function buffer(res: Response): Promise<BufferedResult> {
  const text = NO_BODY_STATUS.has(res.status) ? null : await res.text();
  const headers: [string, string][] = [];
  res.headers.forEach((v, k) => headers.push([k, v]));
  return { status: res.status, statusText: res.statusText, headers, body: text };
}

/**
 * POST `body` as JSON, joining an identical in-flight request instead of
 * issuing a second one.
 *
 * @param key Identifies the WRITE TARGET (not the payload). Required — an
 *            accidental shared key would coalesce writes to different targets.
 */
export function postOnce(
  url: string,
  body: unknown,
  opts: { key: string; init?: RequestInit } = { key: url },
): Promise<Response> {
  const { signal, ...rest } = opts.init ?? {};

  // Abort-first: an already-aborted caller must not issue (or join) a request.
  if (signal?.aborted) return Promise.reject(abortError());

  const running = inflight.get(opts.key);
  if (running) {
    if (!signal) return running.then(toResponse);
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      running.then(
        (v) => {
          signal.removeEventListener('abort', onAbort);
          resolve(toResponse(v));
        },
        (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }

  const shared = fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...rest,
  })
    .then(buffer)
    .finally(() => {
      // Identity check: a stale settle must not clear a newer entry for the key.
      if (inflight.get(opts.key) === shared) inflight.delete(opts.key);
    });

  inflight.set(opts.key, shared);

  if (!signal) return shared.then(toResponse);

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(toResponse(v));
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Test seam: forget every in-flight entry. */
export function __resetPostOnce(): void {
  inflight.clear();
}

/** How many in-flight entries are tracked (test/diagnostic). */
export function __postOnceInflightCount(): number {
  return inflight.size;
}
