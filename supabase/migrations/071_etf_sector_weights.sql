-- 071: ETF sector-weight cache for the dynamic ETF decomposition resolver.
--
-- Holds resolved sector weights (style-bucket → pct) for broad-market ETFs so
-- the drift/risk engines can see a fund's true underlying sector exposure
-- without re-fetching from the provider on every pass. One row per symbol,
-- refreshed on a ~7-day TTL by the resolver (lib/etf-sectors.ts).

CREATE TABLE IF NOT EXISTS public.etf_sector_weights (
  symbol text PRIMARY KEY,
  weights jsonb NOT NULL,          -- { "Technology": 38.7, "Consumer": 13.8, ... } (pct, sums ≈ 100)
  source text NOT NULL DEFAULT 'yahoo',
  as_of timestamptz,               -- provider-reported date, if any
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.etf_sector_weights ENABLE ROW LEVEL SECURITY;

-- Server-side (service-role) access only; no client reads/writes.
DROP POLICY IF EXISTS "etf weights service only" ON public.etf_sector_weights;

CREATE INDEX IF NOT EXISTS etf_sector_weights_fetched_at_idx
  ON public.etf_sector_weights(fetched_at);
