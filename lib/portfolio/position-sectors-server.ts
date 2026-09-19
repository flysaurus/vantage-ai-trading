// ─── Fund-aware PER-POSITION sector resolution (SERVER ONLY) ───
// The single authority for "what is this position's sector?" when a position
// needs ONE string (persisted column, per-position risk, concentration math).
//
// WHY THIS FILE EXISTS (and is separate from lib/sector-resolver.ts):
// `lib/sector-resolver.ts` is imported by CLIENT code (the demo broker), so its
// module graph must stay browser-safe. The ETF look-through it composes here
// lives in `lib/etf-sectors.ts`, which pulls in `yahoo-finance2` — a server
// dependency that cannot be bundled for the browser. Importing it from
// sector-resolver.ts dragged `node:module` into the client bundle and broke the
// whole portfolio page (webpack "UnhandledSchemeError"). Same split the repo
// already uses for `sector-mix.ts` (shared) vs `sector-mix-server.ts` (server).
//
// It deliberately reuses the SAME fund machinery resolveSectorMix uses
// (Yahoo `topHoldings.sectorWeightings`, 7-day Supabase cache, static
// broad-market profile fallback) rather than inventing a second method:
//
//   1. FUND (static profile, dynamic/cached ETF weights, or a fund-family label)
//      → keeps its fund-family sector ('Broad Market', 'International',
//      'Fixed Income', …) when it has one, because collapsing a diversified fund
//      to one GICS bucket would actively mislead concentration-risk math.
//      Only a fund with NO label at all falls back to its dominant underlying
//      bucket, and the ETF weights themselves still drive the sector mix.
//      This pass is also what keeps an unlabeled fund (EFA, FLIN, ARKK) from
//      being counted as an individual STOCK in the asset-mix structure split.
//   2. STOCK (or unlabelable symbol) → industry string → static symbol map →
//      live Finnhub profile (bounded, memoized, never throws).

import {
  getEtfSectorWeights,
  getCachedEtfWeightsBatch,
  resolveEtfSectorWeights,
  normalizeSectorBucket,
} from '@/lib/etf-sectors';
import { isFundSector } from '@/lib/portfolio/sector-mix';
import {
  canonicalizeSymbol,
  resolveSectorStatic,
  resolveSectorsForSymbols,
} from '@/lib/sector-resolver';

export interface PositionSectorInput {
  symbol: string;
  /** Broker/provider industry string, when one is available (Finnhub/Alpaca). */
  industry?: string | null;
  /** Sector the broker reported, when it reports one (SnapTrade does not). */
  sector?: string | null;
}

/** The style-bucket a fund is most exposed to. Null when no usable weights. */
export function dominantSectorBucket(
  weights: Record<string, number> | null | undefined,
): string | null {
  if (!weights) return null;
  let best: string | null = null;
  let bestPct = -Infinity;
  for (const [bucket, pct] of Object.entries(weights)) {
    if (!Number.isFinite(pct) || pct <= 0) continue;
    if (pct > bestPct) {
      bestPct = pct;
      best = bucket;
    }
  }
  return best;
}

/**
 * Resolve a per-position sector for a batch of positions.
 * Returns a Map<canonical-symbol, sector> containing ONLY resolved entries.
 * Never throws.
 *
 * @param opts.supabase         client used for the `etf_sector_weights` cache (optional)
 * @param opts.concurrency      stock-lookup concurrency (default 5)
 * @param opts.maxFundLookups   cap on UNCACHED fund provider calls (default 12,
 *                              mirrors /api/portfolio/sector-mix)
 */
export async function resolvePositionSectors(
  positions: PositionSectorInput[],
  opts?: { supabase?: any; concurrency?: number; maxFundLookups?: number },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = new Map<string, PositionSectorInput>();
  for (const p of positions) {
    const key = canonicalizeSymbol(p?.symbol || '');
    if (key && !uniq.has(key)) uniq.set(key, p);
  }

  const fundKeys: string[] = [];
  const stockInputs: PositionSectorInput[] = [];

  for (const [key, p] of uniq) {
    const label = (p.sector || '').trim() || resolveSectorStatic(p.symbol, p.industry);
    if (label) out.set(key, label);
    // Fund-looking = has a static/dynamic ETF profile, or already speaks the
    // fund vocabulary. Those get the look-through pass below instead of a
    // Finnhub company lookup.
    const fundLike =
      !!getEtfSectorWeights(key) ||
      isFundSector(label) ||
      isFundSector(normalizeSectorBucket(p.sector));
    if (fundLike) fundKeys.push(key);
    else if (!label) stockInputs.push(p);
  }

  // ── Pass 1: fund look-through ──
  // Cache-first for EVERY symbol in one round-trip (cheap, and it is exactly how
  // an unlabeled fund like EFA earns a real sector); only funds that miss the
  // cache AND have no static profile spend a provider call (bounded).
  const cached = await getCachedEtfWeightsBatch(opts?.supabase, Array.from(uniq.keys()));
  const maxFundLookups = opts?.maxFundLookups ?? 12;

  const fillFromWeights = (key: string, weights: Record<string, number> | null) => {
    const current = out.get(key);
    const dominant = dominantSectorBucket(weights);
    // Only fill a GAP — never relabel a fund that already carries a fund label.
    if (dominant && (!current || current === 'Unclassified' || current === 'ETF')) {
      out.set(key, dominant);
    }
  };

  const withWeights = Array.from(uniq.keys()).filter(
    (k) => cached.has(k) || !!getEtfSectorWeights(k),
  );
  const providerQueue = fundKeys
    .filter((k) => !cached.has(k) && !getEtfSectorWeights(k))
    .slice(0, maxFundLookups);

  await Promise.all([
    ...withWeights.map(async (key) => {
      fillFromWeights(key, cached.get(key) || getEtfSectorWeights(key));
    }),
    ...providerQueue.map(async (sym) => {
      try {
        fillFromWeights(sym, await resolveEtfSectorWeights(sym, opts?.supabase));
      } catch {
        // Non-fatal — the position keeps its label (or stays unresolved).
      }
    }),
  ]);

  // ── Pass 2: stocks → industry → static map → live Finnhub ──
  // The Finnhub read goes through the gateway when a client is available, so a
  // `shadow`/`on` rollout warms the shared cache without changing answers.
  if (stockInputs.length > 0) {
    const resolved = await resolveSectorsForSymbols(
      stockInputs.map((p) => ({ symbol: p.symbol, industry: p.industry })),
      opts?.concurrency ?? 5,
      { supabase: opts?.supabase as any },
    );
    for (const [key, sector] of resolved) {
      if (sector) out.set(key, sector);
    }
  }

  return out;
}
