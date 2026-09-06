// ─── Broad-market ETF → underlying sector decomposition ─────────
// Deterministic, static approximations of GICS sector weights for popular
// index ETFs, mapped onto the STYLE_SECTOR_TARGETS bucket names.
//
// Why: a position's single `sector` field can only say "Broad Market" for an
// ETF like SPY. But SPY actually carries ~31% Technology, ~13% Financials,
// ~11% Healthcare, etc. Without decomposition, the drift engine treats a
// 100%-SPY portfolio as 0% in every real sector → spurious "everything
// underweight" triggers. Decomposition spreads each ETF's market value across
// its underlying sector buckets so drift + risk math see the true exposure.
//
// Weights are ballpark (rounded to integers) — precision doesn't matter for a
// 15pt drift threshold, only the coarse shape does.

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

// S&P 500 (SPY / VOO / IVV / VTI) — approximate current GICS weights.
const S_P_500: Record<string, number> = {
  Technology: 31,
  Consumer: 16, // Discretionary 10 + Staples 6
  'Financial Services': 13,
  Healthcare: 11,
  'Media & Entertainment': 9, // Communication Services
  Industrials: 8,
  Materials: 6, // Energy 4 + Materials 2
  Utilities: 3,
  'Broad Market': 3, // Real Estate 2.5 + rounding
};

// Nasdaq-100 (QQQ)
const NASDAQ_100: Record<string, number> = {
  Technology: 49,
  Consumer: 22, // Discretionary 17 + Staples 5
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
  Materials: 8, // Materials 4 + Energy 4
  'Broad Market': 9, // Real Estate 7 + rounding
  'Media & Entertainment': 4,
  Utilities: 2,
};

// Dow Jones Industrial Average (DIA) — price-weighted 30 stocks.
const DOW_30: Record<string, number> = {
  Consumer: 23, // Discretionary 15 + Staples 8
  'Financial Services': 20,
  Healthcare: 18,
  Technology: 17,
  Industrials: 14,
  Materials: 5, // Materials 3 + Energy 2
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

/**
 * Split a position's market value across style-target sector buckets.
 * - Broad-market ETFs are decomposed via their static profile.
 * - Everything else maps its single sector through normalizeSectorBucket.
 * Returns a bucket → value map (values in dollars, summing back to `value`).
 */
export function decomposePositionValue(
  symbol: string,
  sector: string | undefined | null,
  value: number,
): Record<string, number> {
  if (!value) return {};
  const weights = getEtfSectorWeights(symbol);
  if (!weights) {
    return { [normalizeSectorBucket(sector)]: value };
  }
  const out: Record<string, number> = {};
  for (const [bucket, pct] of Object.entries(weights)) {
    if (!pct) continue;
    out[bucket] = (out[bucket] || 0) + value * (pct / 100);
  }
  return out;
}
