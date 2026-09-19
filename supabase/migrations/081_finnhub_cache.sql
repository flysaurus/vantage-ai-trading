-- ─── 081_finnhub_cache ──────────────────────────────────────────────────────
-- Shared Finnhub fetch/cache layer (gateway) — one chokepoint for every
-- Finnhub read. Free tier is 60 req/min; without a cache the sync path fans out
-- to hundreds of symbols per load and burns the budget, and 429s are NOT
-- remembered (lib/finnhub.ts returns null on !res.ok with no memo), so a symbol
-- that got throttled stays null forever.
--
-- This table is the memory that fixes both:
--   * `ok`           → a real payload, cached for the endpoint TTL.
--   * `null_result`  → Finnhub genuinely doesn't know the symbol (empty
--                      profile / no ticker). LONG ttl — stop re-asking.
--   * `rate_limited` → got a 429/5xx. SHORT ttl (minutes) — retry soon, but do
--                      not re-burn inside the cooldown.
--
-- Additive + idempotent. No backfill. Read/written ONLY by the server-side
-- gateway via the service-role client (RLS on with no policies = deny all to
-- anon/authenticated).

CREATE TABLE IF NOT EXISTS public.finnhub_cache (
  key          text        PRIMARY KEY,                       -- e.g. 'profile2:AAPL'
  payload      jsonb,                                         -- null for null_result / rate_limited-with-no-prior-ok
  status       text        NOT NULL
                 CHECK (status IN ('ok', 'null_result', 'rate_limited')),
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  ttl_seconds  integer     NOT NULL CHECK (ttl_seconds >= 0)
);

COMMENT ON TABLE public.finnhub_cache IS
  'Shared Finnhub read cache (gateway). status memorises both genuine unknowns (long ttl) and 429s (short ttl).';
COMMENT ON COLUMN public.finnhub_cache.key IS
  'Namespaced logical key: profile2:<SYM> | quote:<SYM> | news:<SYM>:<from>:<to> | earnings:<from>:<to>';
COMMENT ON COLUMN public.finnhub_cache.payload IS
  'The mapped value for status=ok; the last good value (if any) for rate_limited; null for null_result.';
COMMENT ON COLUMN public.finnhub_cache.ttl_seconds IS
  'Freshness horizon from fetched_at. ok → endpoint ttl; null_result → long (days); rate_limited → short (minutes).';

-- Freshness lookups are per-key (PK) already; this index serves the cron warmer
-- which scans for stale/expired rows by status ("what still needs a refresh?").
CREATE INDEX IF NOT EXISTS finnhub_cache_status_fetched_idx
  ON public.finnhub_cache (status, fetched_at);

ALTER TABLE public.finnhub_cache ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: service-role only. Anon/authenticated see nothing.
