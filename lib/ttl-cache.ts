// ─── Single-flight + TTL in-memory cache ──────────────────
// Per-instance cache used to absorb duplicate/rapid SnapTrade fetches
// (e.g. the portfolio page mounting two independent data layers at once,
// or a 30s poll racing a 60s poll). Serverless-safe: a cache miss across
// instances is harmless — it just fetches from the broker again.

interface CacheEntry<T> {
  value: T;
  ts: number;
}

export interface TtlCache<T = unknown> {
  /**
   * Return a cached value if fresh, otherwise run `fetcher`, cache the result,
   * and return it. Concurrent calls for the same key share a single fetch
   * (single-flight) so simultaneous mounts don't hammer the broker.
   *
   * `opts.fresh` bypasses both the TTL check and the in-flight dedupe —
   * use it after a trade/cancel where we explicitly need live data. Fresh
   * fetches still refresh the cache for subsequent reads.
   */
  getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    opts?: { fresh?: boolean; ttlMs?: number },
  ): Promise<T>;
  invalidate(key: string): void;
}

export function createTtlCache<T = unknown>(ttlMs: number): TtlCache<T> {
  const store = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  return {
    async getOrFetch(key, fetcher, opts = {}) {
      const effTtl = opts.ttlMs ?? ttlMs;

      if (!opts.fresh) {
        const inflight = inFlight.get(key);
        if (inflight) return inflight;

        const hit = store.get(key);
        if (hit && Date.now() - hit.ts < effTtl) {
          return hit.value;
        }
      }

      const p = fetcher().then((value) => {
        store.set(key, { value, ts: Date.now() });
        return value;
      });
      inFlight.set(key, p);
      try {
        return await p;
      } finally {
        if (inFlight.get(key) === p) inFlight.delete(key);
      }
    },
    invalidate(key) {
      store.delete(key);
    },
  };
}
