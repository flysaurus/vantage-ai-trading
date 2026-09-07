// ─── Symbol → Sector Resolver ──────────────────────────────────
// Single authority for resolving a ticker symbol to a GICS-style sector.
//
// Resolution chain (cheapest → most expensive):
//   1. Provided industry string (Finnhub `finnhubIndustry` / Alpaca industry)
//      → mapped via finnhubIndustryToSector() then industryToSector().
//   2. Static symbol → sector map (demo-portfolio symbols + common ETFs).
//   3. Live Finnhub /stock/profile2 lookup (server-side only) → finnhubIndustry.
//
// `resolveSectorStatic` is synchronous + network-free (safe for client bundles
// and the demo broker). `resolveSector` adds the live lookup and is intended
// for server-side callers (positions sync, broker enrichment).
//
// Sector strings follow the app's existing conventions:
//   - Individual stocks: GICS-style names ("Consumer Defensive", "Materials").
//   - Broad index ETFs: "Broad Market"; bonds "Fixed Income"; intl "International".
//   - `normalizeSectorBucket()` in lib/etf-sectors.ts reconciles these downstream.

import { finnhubIndustryToSector, getCompanyProfile } from '@/lib/finnhub';
import { industryToSector } from '@/lib/sectors';

// ─── Static symbol → sector fallback ──────────────────────────
// Covers every demo-portfolio holding + the most common ETFs so demo backfill
// and broker-sync enrichment never block on a network call for these symbols.

const STATIC_SYMBOL_SECTOR: Record<string, string> = {
  // Technology
  AAPL: 'Technology',
  GOOGL: 'Technology',
  MSFT: 'Technology',
  META: 'Technology',
  ADBE: 'Technology',
  CRM: 'Technology',
  NVDA: 'Technology',
  AVGO: 'Technology',
  AMD: 'Technology',
  PLTR: 'Technology',
  SNOW: 'Technology',
  NET: 'Technology',
  DDOG: 'Technology',
  CRWD: 'Technology',
  NOW: 'Technology',
  // Financial Services
  'BRK.B': 'Financial Services',
  JPM: 'Financial Services',
  AXP: 'Financial Services',
  BAC: 'Financial Services',
  V: 'Financial Services',
  MA: 'Financial Services',
  MCO: 'Financial Services',
  COIN: 'Financial Services',
  SPGI: 'Financial Services',
  // Consumer Defensive / Cyclical
  KO: 'Consumer Defensive',
  PG: 'Consumer Defensive',
  WMT: 'Consumer Defensive',
  COST: 'Consumer Defensive',
  AMZN: 'Consumer Cyclical',
  TSLA: 'Consumer Cyclical',
  // Healthcare
  JNJ: 'Healthcare',
  UNH: 'Healthcare',
  // Energy
  CVX: 'Energy',
  XOM: 'Energy',
  SLB: 'Energy',
  DVN: 'Energy',
  OXY: 'Energy',
  KMI: 'Energy',
  // Industrials
  UNP: 'Industrials',
  // Media & Entertainment
  NFLX: 'Media & Entertainment',
  // Materials / Commodities
  FCX: 'Materials',
  NEM: 'Materials',
  BHP: 'Materials',
  GLD: 'Commodities',

  // ── Common ETFs ──
  // Broad market
  SPY: 'Broad Market',
  VOO: 'Broad Market',
  IVV: 'Broad Market',
  VTI: 'Broad Market',
  QQQ: 'Broad Market',
  DIA: 'Broad Market',
  IWM: 'Broad Market',
  SCHD: 'Broad Market',
  VTV: 'Broad Market',
  VUG: 'Broad Market',
  VYM: 'Broad Market',
  JEPI: 'Broad Market',
  // Sector ETFs
  XLK: 'Technology',
  VGT: 'Technology',
  SMH: 'Technology',
  XLV: 'Healthcare',
  XLF: 'Financial Services',
  XLY: 'Consumer',
  XLP: 'Consumer',
  XLE: 'Energy',
  XLI: 'Industrials',
  XLC: 'Media & Entertainment',
  XLB: 'Materials',
  XLU: 'Utilities',
  XLRE: 'Real Estate',
  VNQ: 'Real Estate',
  // Bonds / International
  BND: 'Fixed Income',
  AGG: 'Fixed Income',
  PFF: 'Fixed Income',
  VEA: 'International',
  VXUS: 'International',
  VEU: 'International',
};

/** Normalize a symbol for map lookup: uppercase + collapse class-share separators. */
export function canonicalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[/-]/g, '.');
}

/**
 * Map a raw industry string (Finnhub or Alpaca style) to a sector.
 * Returns null when the string is empty/unrecognized.
 */
export function industryStringToSector(industry: string | null | undefined): string | null {
  if (!industry) return null;
  const trimmed = industry.trim();
  if (!trimmed) return null;
  return finnhubIndustryToSector(trimmed) ?? industryToSector(trimmed);
}

/**
 * Synchronous, network-free sector resolution.
 * Chain: industry string → static symbol map → null.
 */
export function resolveSectorStatic(
  symbol: string | null | undefined,
  industry?: string | null,
): string | null {
  const fromIndustry = industryStringToSector(industry);
  if (fromIndustry) return fromIndustry;

  if (!symbol) return null;
  const key = canonicalizeSymbol(symbol);
  return STATIC_SYMBOL_SECTOR[key] ?? null;
}

/**
 * Full sector resolution with a live Finnhub fallback (server-side).
 * Chain: static (industry + symbol map) → Finnhub profile2 → null.
 * Never throws — returns null when the symbol can't be resolved.
 */
export async function resolveSector(
  symbol: string | null | undefined,
  opts?: { industry?: string | null },
): Promise<string | null> {
  const staticResult = resolveSectorStatic(symbol, opts?.industry);
  if (staticResult) return staticResult;
  if (!symbol) return null;

  try {
    const profile = await getCompanyProfile(symbol);
    if (!profile) return null;
    return industryStringToSector(profile.finnhubIndustry);
  } catch {
    return null;
  }
}

/**
 * Resolve sectors for a batch of symbols with bounded concurrency.
 * Returns a Map<normalized-symbol, sector|null>. Never throws.
 * Useful for broker-sync enrichment where N symbols would otherwise fan out
 * into N simultaneous Finnhub calls.
 */
export async function resolveSectorsForSymbols(
  symbols: Array<{ symbol: string; industry?: string | null }>,
  concurrency = 5,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const queue = [...symbols];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      const key = canonicalizeSymbol(item.symbol);
      if (out.has(key)) continue;
      const sector = await resolveSector(item.symbol, { industry: item.industry });
      out.set(key, sector);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, () => worker()),
  );
  return out;
}
