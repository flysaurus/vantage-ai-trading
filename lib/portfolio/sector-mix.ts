// ─── Holdings: asset mix (ETF vs stocks) + decomposed sector mix ─────
// Answers two DIFFERENT questions about the same book:
//   1. STRUCTURE — how much is in ETFs vs individual stocks (Part 1).
//   2. SECTOR EXPOSURE — the sector mix, with each ETF's underlying sector
//      weights folded in so an S&P 500 ETF contributes ~39% Technology,
//      ~12% Financial Services, … instead of one opaque "ETF" bucket (Part 2).
//
// Both come from the SAME resolution pass, so the two visuals can never
// disagree about what is a fund.
//
// Sector weights are REAL data: the dynamic resolver in lib/etf-sectors.ts
// pulls Yahoo `quoteSummary → topHoldings.sectorWeightings` (cached ~7 days in
// the `etf_sector_weights` table) and only falls back to the static broad-
// market profile when the provider is unavailable.

import { normalizeSectorBucket, getEtfSectorWeights } from '@/lib/etf-sectors';

/** A position as the API route receives it (client-supplied, sanitized). */
export interface MixPosition {
  symbol: string;
  sector?: string | null;
  /** Market value in dollars. */
  value: number;
}

export interface SectorSlice {
  bucket: string;
  value: number;
  pct: number;
}

export interface AssetMix {
  /** Total market value of all classified positions. */
  total: number;
  etfValue: number;
  stockValue: number;
  etfPct: number;
  stockPct: number;
  etfCount: number;
  stockCount: number;
  /** Decomposed sector buckets, largest first. Percentages of `total`. */
  buckets: SectorSlice[];
  /** Symbols whose value landed in the 'Other' bucket because no sector was on
   *  file for them. Surfaced in the UI — the chart must never silently imply
   *  that a holding has been classified. */
  otherSymbols: string[];
  /** Per-symbol classification, for tooltips/audits. */
  perSymbol: Record<string, { isEtf: boolean; value: number }>;
  /** Diagnostics from the API: fund-like symbols the provider did not resolve
   *  (their value lands in the 'Other' bucket — surfaced to the user, never hidden). */
  unresolvedFundish?: string[];
}

/**
 * Sectors that mean "this is a fund" when no provider weights were resolved.
 * Deliberately EXCLUDES 'Unclassified' / 'Other' / 'Cash' — a missing sector
 * must not silently brand an individual stock as an ETF.
 */
const FUND_SECTORS = new Set([
  'Broad Market',
  'ETF',
  'Commodities',
  'Fixed Income',
  'International',
  'Real Estate',
]);

export function isFundSector(sector: string | null | undefined): boolean {
  return FUND_SECTORS.has(normalizeSectorBucket(sector));
}

/**
 * Build the asset mix.
 *
 * @param positions        sanitized positions (symbol / sector / value)
 * @param weightsBySymbol  resolved ETF sector weights, symbol → (bucket → pct).
 *                         A symbol present here IS a fund (the resolver only
 *                         returns weights for funds).
 */
export function buildAssetMix(
  positions: MixPosition[],
  weightsBySymbol?: Map<string, Record<string, number>> | null,
): AssetMix {
  const bucketValues = new Map<string, number>();
  const otherSymbols = new Set<string>();
  const perSymbol: Record<string, { isEtf: boolean; value: number }> = {};
  let etfValue = 0;
  let stockValue = 0;
  let etfCount = 0;
  let stockCount = 0;

  for (const pos of positions) {
    const symbol = (pos.symbol || '').toUpperCase().trim();
    const value = Number(pos.value) || 0;
    if (!symbol || value <= 0) continue;

    const resolved = weightsBySymbol?.get(symbol) || null;
    // Dynamic/static ETF profile wins; otherwise an unmistakably fund-ish
    // sector; otherwise an individual stock.
    const weights = resolved || getEtfSectorWeights(symbol);
    const isEtf = !!weights || isFundSector(pos.sector);

    perSymbol[symbol] = { isEtf, value };
    if (isEtf) {
      etfValue += value;
      etfCount += 1;
    } else {
      stockValue += value;
      stockCount += 1;
    }

    if (weights && Object.keys(weights).length > 0) {
      for (const [bucket, pct] of Object.entries(weights)) {
        if (!pct) continue;
        bucketValues.set(bucket, (bucketValues.get(bucket) || 0) + value * (pct / 100));
      }
    } else {
      const bucket = normalizeSectorBucket(pos.sector);
      bucketValues.set(bucket, (bucketValues.get(bucket) || 0) + value);
      if (bucket === 'Other' || bucket === 'Unclassified') otherSymbols.add(symbol);
    }
  }

  const total = etfValue + stockValue;
  const buckets: SectorSlice[] = Array.from(bucketValues.entries())
    .filter(([, v]) => v > 0)
    .map(([bucket, value]) => ({ bucket, value, pct: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    total,
    etfValue,
    stockValue,
    etfPct: total > 0 ? (etfValue / total) * 100 : 0,
    stockPct: total > 0 ? (stockValue / total) * 100 : 0,
    etfCount,
    stockCount,
    buckets,
    otherSymbols: Array.from(otherSymbols),
    perSymbol,
  };
}
