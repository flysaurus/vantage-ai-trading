// ─── Server-side sector mix (chat chart resolver) ────────────────
// Same resolution the `/api/portfolio/sector-mix` route performs, packaged as
// a plain async function so the chat chart resolver can build sector-based
// charts from the SAME real data the Insights screen shows.
//
// ETF sector weights are resolved with the SAME resolver the Noticed drift
// engine uses (lib/etf-sectors.ts): Supabase cache first (~7 day TTL), then
// Yahoo `topHoldings.sectorWeightings`, with the static broad-market profile as
// the fallback. Nothing is hardcoded here and nothing is invented.
//
// Provider budget: at most `maxLookups` uncached symbols are fetched per call
// (Yahoo is rate-limited); everything else uses the cache, static profile, or
// its single sector. The cache fills over successive calls.

import { buildAssetMix, isFundSector, type AssetMix, type MixPosition } from '@/lib/portfolio/sector-mix';
import { resolveEtfSectorWeights, getEtfSectorWeights } from '@/lib/etf-sectors';

const WEIGHTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function resolveSectorMix(
  positions: MixPosition[],
  supabase: any,
  maxLookups = 12,
): Promise<AssetMix> {
  if (!positions || positions.length === 0) return buildAssetMix([]);

  const weightsBySymbol = new Map<string, Record<string, number>>();

  // Every distinct symbol is checked against the cache in one round-trip
  // (cheap); only fund-looking symbols that MISS spend a provider call.
  const allSymbols: string[] = [];
  const sectorOf = new Map<string, string | null>();
  for (const p of positions) {
    if (sectorOf.has(p.symbol)) continue;
    sectorOf.set(p.symbol, p.sector ?? null);
    allSymbols.push(p.symbol);
  }
  const fundLike = (sym: string) => isFundSector(sectorOf.get(sym)) || !!getEtfSectorWeights(sym);

  const toFetch: string[] = [];
  try {
    const { data } = await supabase
      .from('etf_sector_weights')
      .select('symbol, weights, fetched_at')
      .in('symbol', allSymbols);
    const fresh = new Map<string, Record<string, number>>();
    for (const row of (data || []) as any[]) {
      if (Date.now() - new Date(row.fetched_at).getTime() <= WEIGHTS_TTL_MS) {
        fresh.set(String(row.symbol).toUpperCase(), row.weights as Record<string, number>);
      }
    }
    for (const sym of allSymbols) {
      const hit = fresh.get(sym);
      if (hit) weightsBySymbol.set(sym, hit);
      else if (fundLike(sym)) toFetch.push(sym);
    }
  } catch {
    toFetch.push(...allSymbols.filter(fundLike));
  }

  await Promise.all(
    toFetch.slice(0, Math.max(0, maxLookups)).map(async (sym) => {
      try {
        const w = await resolveEtfSectorWeights(sym, supabase);
        if (w && Object.keys(w).length > 0) weightsBySymbol.set(sym, w);
      } catch {
        // A failed lookup just means the symbol falls back to its static
        // profile / single sector below. Never blocks the chart.
      }
    }),
  );

  return buildAssetMix(positions, weightsBySymbol);
}
