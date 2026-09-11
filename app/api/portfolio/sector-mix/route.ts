// ─── POST /api/portfolio/sector-mix ─────────────────────────────
// Holdings "asset mix" + decomposed sector mix.
//
// Body: { positions: [{ symbol, sector?, value }] }
// Returns: AssetMix (see lib/portfolio/sector-mix.ts) —
//   * ETF vs individual-stock split (structure), and
//   * sector buckets with each ETF's UNDERLYING sector weights folded in.
//
// ETF sector weights are resolved with the SAME resolver the Noticed drift
// engine uses (lib/etf-sectors.ts): Yahoo `topHoldings.sectorWeightings`,
// cached ~7 days in `etf_sector_weights`, static broad-market profile as the
// fallback. Nothing is hardcoded here and nothing is invented client-side.
//
// Provider budget: at most MAX_PROVIDER_LOOKUPS uncached symbols are fetched
// per request (Yahoo is rate-limited); everything else uses the static profile
// or falls back to its single sector. The cache fills over successive loads.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { buildAssetMix, isFundSector, type MixPosition } from '@/lib/portfolio/sector-mix';
import { resolveEtfSectorWeights, getEtfSectorWeights } from '@/lib/etf-sectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_POSITIONS = 500;
const MAX_PROVIDER_LOOKUPS = 12;

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authError } = await requireAuth();
  if (authError) return authError;

  const body = await req.json().catch(() => ({} as any));
  const raw = Array.isArray(body?.positions) ? body.positions.slice(0, MAX_POSITIONS) : [];

  const positions: MixPosition[] = raw
    .map((p: any) => ({
      symbol: String(p?.symbol || '').toUpperCase().trim().slice(0, 12),
      sector: typeof p?.sector === 'string' ? p.sector.slice(0, 60) : null,
      value: num(p?.value),
    }))
    .filter((p: MixPosition) => p.symbol && p.value > 0);

  if (positions.length === 0) {
    return NextResponse.json(buildAssetMix([]), { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── Resolve ETF sector weights (cached-first; bounded provider fan-out) ──
  const supabase = createServerClient() as any;
  const weightsBySymbol = new Map<string, Record<string, number>>();

  // Candidates for cached/resolved weights: EVERY distinct symbol is checked
  // against the cache in one round-trip (cheap); only fund-looking symbols that
  // MISS the cache spend a provider call. This matters for funds the position
  // feed reports without a fund sector (e.g. FLIN came back as 'Other'), which
  // used to be skipped entirely and silently dumped into the 'Other' bucket.
  const allSymbols: string[] = [];
  const sectorOf = new Map<string, string | null>();
  for (const p of positions) {
    if (sectorOf.has(p.symbol)) continue;
    sectorOf.set(p.symbol, p.sector ?? null);
    allSymbols.push(p.symbol);
  }
  const fundLike = (sym: string) => isFundSector(sectorOf.get(sym)) || !!getEtfSectorWeights(sym);

  // Check the Supabase cache in one round-trip before spending provider calls.
  const toFetch: string[] = [];
  try {
    const { data } = await supabase
      .from('etf_sector_weights')
      .select('symbol, weights, fetched_at')
      .in('symbol', allSymbols);
    const fresh = new Map<string, Record<string, number>>();
    const TTL = 7 * 24 * 60 * 60 * 1000;
    for (const row of (data || []) as any[]) {
      if (Date.now() - new Date(row.fetched_at).getTime() <= TTL) {
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
    toFetch.slice(0, MAX_PROVIDER_LOOKUPS).map(async (sym) => {
      const w = await resolveEtfSectorWeights(sym, supabase);
      if (w && Object.keys(w).length > 0) weightsBySymbol.set(sym, w);
    }),
  );

  const mix = buildAssetMix(positions, weightsBySymbol);

  return NextResponse.json(
    {
      ...mix,
      // Audit trail: which sectors the resolver spoke for vs. which fell back.
      // `resolved` = dynamic Yahoo weights (cache or live fetch); `staticProfiles`
      // = symbols whose only breakdown is the generic fallback profile;
      // `unresolvedFundish` = fund-looking symbols with NO breakdown at all
      // (their value lands in the 'Other' bucket, and the UI says so).
      resolved: Object.fromEntries(
        Array.from(weightsBySymbol.keys()).map((s) => [s, 'etf_weights']),
      ),
      unresolvedFundish: Array.from(
        new Set(
          positions
            .filter((p) => isFundSector(p.sector) && !weightsBySymbol.has(p.symbol) && !getEtfSectorWeights(p.symbol))
            .map((p) => p.symbol),
        ),
      ).slice(0, 20),
      staticProfiles: Array.from(
        new Set(positions.filter((p) => !!getEtfSectorWeights(p.symbol)).map((p) => p.symbol)),
      ).slice(0, 20),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
