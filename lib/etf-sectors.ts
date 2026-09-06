// ─── Broad-market ETF → underlying sector decomposition ─────────
// Two layers:
//   1. STATIC fallback — ballpark GICS sector weights for the most common index
//      ETFs (SPY/VOO/QQQ/…), mapped onto the STYLE_SECTOR_TARGETS buckets.
//   2. DYNAMIC resolver — fetches the ETF's live sector weightings from Yahoo
//      Finance (`quoteSummary` → `topHoldings.sectorWeightings`), caches them in
//      Supabase (`etf_sector_weights`, ~7-day TTL), and falls back to the static
//      map (or the position's single sector) when the provider is unavailable.
//
// Why: a position's single `sector` field can only say "Broad Market" for an ETF
// like SPY. But SPY actually carries ~31% Technology, ~13% Financials, etc.
// Without decomposition the drift engine treats a 100%-SPY portfolio as 0% in
// every real sector → spurious "everything underweight" triggers.

// ── GICS-style sector → style-target bucket normalization ──────
// Shared by the noticed drift engine and the risk-narrative layer so both
// speak the same bucket vocabulary as STYLE_SECTOR_TARGETS.
export const SECTOR_TO_BUCKET: Record<string, string> = {
  'Consumer Defensive': 'Consumer',
  'Consumer Cyclical': 'Consumer',
  'Consumer Staples': 'Consumer',
  'Consumer Discretionary': 'Consumer',
  'Commodities': 'Materials',
  'Energy': 'Materials',
  'Communication Services': 'Media & Entertainment',
  'Real Estate': 'Broad Market',
  'Automotive': 'Consumer',
};

export function normalizeSectorBucket(sector: string | undefined | null): string {
  const raw = (sector || 'Unclassified').trim();
  return SECTOR_TO_BUCKET[raw] || raw;
}

// ── Static sector profiles (bucket → weight %, sums ≈ 100) ─────
// Used only as a fallback when the dynamic resolver can't return live weights.

// S&P 500 (SPY / VOO / IVV / VTI) — approximate current GICS weights.
const S_P_500: Record<string, number> = {
  Technology: 31,
  Consumer: 16,
  'Financial Services': 13,
  Healthcare: 11,
  'Media & Entertainment': 9,
  Industrials: 8,
  Materials: 6,
  Utilities: 3,
  'Broad Market': 3,
};

// Nasdaq-100 (QQQ)
const NASDAQ_100: Record<string, number> = {
  Technology: 49,
  Consumer: 22,
  'Media & Entertainment': 16,
  Healthcare: 6,
  Industrials: 4,
  'Financial Services': 1,
  Materials: 1,
  Utilities: 1,
};

// Russell 2000 (IWM)
const RUSSELL_2000: Record<string, number> = {
  'Financial Services': 17,
  Industrials: 16,
  Healthcare: 15,
  Consumer: 15,
  Technology: 14,
  Materials: 8,
  'Broad Market': 9,
  'Media & Entertainment': 4,
  Utilities: 2,
};

// Dow Jones Industrial Average (DIA) — price-weighted 30 stocks.
const DOW_30: Record<string, number> = {
  Consumer: 23,
  'Financial Services': 20,
  Healthcare: 18,
  Technology: 17,
  Industrials: 14,
  Materials: 5,
  'Media & Entertainment': 3,
};

// Symbol → sector profile. Keys are normalized to uppercase at lookup.
export const BROAD_MARKET_ETF_PROFILES: Record<string, Record<string, number>> = {
  SPY: S_P_500,
  VOO: S_P_500,
  IVV: S_P_500,
  VTI: S_P_500,
  QQQ: NASDAQ_100,
  IWM: RUSSELL_2000,
  DIA: DOW_30,
  // International / aggregate-bond ETFs map to their own (skipped) buckets so
  // they don't masquerade as "Broad Market" and inflate the equity buckets.
  VXUS: { International: 100 },
  VEU: { International: 100 },
  BND: { 'Fixed Income': 100 },
  AGG: { 'Fixed Income': 100 },
};

export function getEtfSectorWeights(symbol: string): Record<string, number> | null {
  return BROAD_MARKET_ETF_PROFILES[(symbol || '').toUpperCase()] || null;
}

// ═══════════════════════════════════════════════════════════════
// DYNAMIC RESOLVER — Yahoo Finance fund sector weightings
// ═══════════════════════════════════════════════════════════════

// Yahoo GICS sector keys → style-target buckets. Yahoo returns 0–1 fractions.
export const GICS_TO_BUCKET: Record<string, string> = {
  technology: 'Technology',
  consumer_cyclical: 'Consumer',
  consumer_defensive: 'Consumer',
  consumer_staples: 'Consumer',
  financial_services: 'Financial Services',
  healthcare: 'Healthcare',
  communication_services: 'Media & Entertainment',
  industrials: 'Industrials',
  basic_materials: 'Materials',
  materials: 'Materials',
  energy: 'Materials',
  utilities: 'Utilities',
  realestate: 'Broad Market',
  real_estate: 'Broad Market',
};

const ETF_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const YAHOO_TIMEOUT_MS = 6000;

/** Sectors that suggest a position might be a fund (worth a provider lookup). */
const FUNDISH_SECTORS = new Set([
  'Broad Market',
  'ETF',
  'Commodities',
  'Fixed Income',
  'International',
  'Unclassified',
  'Other',
  'Real Estate',
  'Cash',
]);

/**
 * Flatten Yahoo's `sectorWeightings` (array of single-key objects OR a flat
 * object of 0–1 fractions) into a style-bucket → pct (0–100) map.
 * Returns null if empty/unparseable.
 */
export function yahooSectorWeightingsToBuckets(
  sw: Array<Record<string, number>> | Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!sw) return null;
  const entries: [string, number][] = Array.isArray(sw)
    ? sw.map((o) => {
        const k = Object.keys(o)[0];
        return [k, o[k]] as [string, number];
      })
    : Object.entries(sw);

  const buckets: Record<string, number> = {};
  let total = 0;
  for (const [key, w] of entries) {
    if (w == null || !Number.isFinite(w)) continue;
    const pct = w * 100; // Yahoo returns 0–1 fractions
    total += pct;
    const bucket = GICS_TO_BUCKET[key] || normalizeSectorBucket(key);
    buckets[bucket] = (buckets[bucket] || 0) + pct;
  }
  if (total <= 0) return null;
  return buckets;
}

async function getCachedEtfWeights(
  supabase: any,
  symbol: string,
): Promise<Record<string, number> | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from('etf_sector_weights')
      .select('weights, fetched_at')
      .eq('symbol', symbol.toUpperCase())
      .maybeSingle();
    if (!data) return null;
    if (Date.now() - new Date(data.fetched_at).getTime() > ETF_CACHE_TTL_MS) return null;
    return data.weights as Record<string, number>;
  } catch {
    return null;
  }
}

async function putCachedEtfWeights(
  supabase: any,
  symbol: string,
  weights: Record<string, number>,
  source = 'yahoo',
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('etf_sector_weights').upsert(
      {
        symbol: symbol.toUpperCase(),
        weights,
        source,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'symbol' },
    );
  } catch {
    // Non-fatal — cache miss just means we re-fetch next pass.
  }
}

/**
 * Resolve sector weights for a single symbol.
 * Chain: fresh cache → Yahoo Finance → static profile → null (caller falls
 * back to the position's single sector). Never throws.
 */
export async function resolveEtfSectorWeights(
  symbol: string,
  supabase?: any,
): Promise<Record<string, number> | null> {
  const sym = (symbol || '').toUpperCase().trim();
  if (!sym) return null;

  const cached = await getCachedEtfWeights(supabase, sym);
  if (cached) return cached;

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const res: any = await Promise.race([
      yf.quoteSummary(sym, { modules: ['topHoldings'] }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('yahoo timeout')), YAHOO_TIMEOUT_MS),
      ),
    ]);
    const sw = res?.topHoldings?.sectorWeightings;
    const buckets = yahooSectorWeightingsToBuckets(sw);
    if (buckets) {
      await putCachedEtfWeights(supabase, sym, buckets);
      return buckets;
    }
  } catch {
    // Fall through to static.
  }

  return getEtfSectorWeights(sym);
}

/**
 * Resolve sector weights for every fund-ish position in a portfolio.
 * Individual stocks (real GICS sector) are skipped to avoid provider calls.
 * Returns a Map<symbol, bucket→pct>. Never throws.
 */
export async function resolveEtfWeightsForPositions(
  positions: Array<{ symbol: string; sector?: string | null }>,
  supabase?: any,
): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  const candidates = positions.filter(
    (p) => !p.sector || FUNDISH_SECTORS.has(normalizeSectorBucket(p.sector)),
  );

  await Promise.all(
    candidates.map(async (p) => {
      const weights = await resolveEtfSectorWeights(p.symbol, supabase);
      if (weights) out.set((p.symbol || '').toUpperCase(), weights);
    }),
  );

  return out;
}

/**
 * Split a position's market value across style-target sector buckets.
 * - `resolvedWeights` (if provided) are used first — dynamic beats static.
 * - Broad-market ETFs otherwise decompose via their static profile.
 * - Everything else maps its single sector through normalizeSectorBucket.
 * Returns a bucket → value map (values in dollars, summing back to `value`).
 */
export function decomposePositionValue(
  symbol: string,
  sector: string | undefined | null,
  value: number,
  resolvedWeights?: Record<string, number> | null,
): Record<string, number> {
  if (!value) return {};
  const weights =
    resolvedWeights && Object.keys(resolvedWeights).length > 0
      ? resolvedWeights
      : getEtfSectorWeights(symbol);
  if (!weights || Object.keys(weights).length === 0) {
    return { [normalizeSectorBucket(sector)]: value };
  }
  const out: Record<string, number> = {};
  for (const [bucket, pct] of Object.entries(weights)) {
    if (!pct) continue;
    out[bucket] = (out[bucket] || 0) + value * (pct / 100);
  }
  return out;
}
