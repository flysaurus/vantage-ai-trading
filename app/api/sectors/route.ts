// ─── Sector Resolution API (Tiered) ───────────────────────────
// Resolves sector for symbols: Finnhub → Alpaca → local map → "Unknown"
// GET /api/sectors?symbols=AAPL,AXP,TSLA
// Also supports GET /api/alpaca/sectors as backward compat

import { type NextRequest, NextResponse } from 'next/server';
import { industryToSector } from '@/lib/sectors';
import { getCompanyProfile } from '@/lib/market-data';
import { finnhubIndustryToSector } from '@/lib/finnhub';

const ALPACA_BASE = process.env.ALPACA_ENVIRONMENT === 'live'
  ? 'https://api.alpaca.markets'
  : 'https://paper-api.alpaca.markets';

// ─── Sector resolution cache ─────────────────────────────────
// Finnhub tier is rate-limited to ~55 req/min (5-symbol batches, 1.1s apart),
// so a cold 25-symbol book took ~19s and the caller could time out — which used
// to strand positions on 'Other' and silently flatten the decomposed sector
// chart. Sectors are effectively static; cache them in-process for 24h.
const SECTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const sectorCache = new Map<string, { sector: string | null; ts: number }>();

function alpacaHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID || '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const symbolsParam = searchParams.get('symbols') || '';
  const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);

  if (symbols.length === 0) {
    return NextResponse.json({ sectors: {} });
  }

  // Cache-first: serve known sectors without spending provider calls.
  const cachedSectors: Record<string, string | null> = {};
  const unknown: string[] = [];
  for (const sym of symbols) {
    const hit = sectorCache.get(sym);
    if (hit && Date.now() - hit.ts < SECTOR_CACHE_TTL_MS) cachedSectors[sym] = hit.sector;
    else unknown.push(sym);
  }
  if (unknown.length === 0) {
    return NextResponse.json(
      { sectors: cachedSectors },
      { headers: { 'X-Cache': 'HIT', 'Cache-Control': 'no-store' } },
    );
  }
  // Only the misses continue through the tiers below.
  symbols.length = 0;
  symbols.push(...unknown);

  const sectors: Record<string, string | null> = {};
  const failed: string[] = [];

  // ─── Tier 1: Finnhub (primary) ───
  const hasFinnhub = !!process.env.FINNHUB_IO_API_KEY;
  if (hasFinnhub) {
    // Process sequentially with concurrency cap to respect rate limit
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 1100; // ~55 req/min, well under 60 limit

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (symbol) => {
          const profile = await getCompanyProfile(symbol);
          const industry = profile?.industry || '';
          if (industry) {
            // Try Finnhub industry mapper first, then fallback
            const sector = finnhubIndustryToSector(industry) || industryToSector(industry);
            if (sector) return { symbol, sector } as const;
          }
          return { symbol, sector: null as string | null };
        })
      );

      for (const { symbol, sector } of results) {
        if (sector) {
          sectors[symbol] = sector;
        } else {
          failed.push(symbol);
        }
      }

      // Delay between batches to respect 60 req/min
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
      }
    }
  } else {
    failed.push(...symbols);
  }

  // ─── Tier 2: Alpaca (fallback for failed/unresolved) ───
  if (failed.length > 0) {
    const results = await Promise.all(
      failed.map(async (symbol) => {
        try {
          const res = await fetch(
            `${ALPACA_BASE}/v2/assets/${encodeURIComponent(symbol)}`,
            { headers: alpacaHeaders(), signal: AbortSignal.timeout(5000) }
          );
          if (!res.ok) return { symbol, sector: null };
          const asset = await res.json();
          const industry = asset.industry || '';
          const sector = industryToSector(industry);
          return { symbol, sector: sector || null };
        } catch {
          return { symbol, sector: null };
        }
      })
    );

    for (const { symbol, sector } of results) {
      sectors[symbol] = sector || sectors[symbol] || null;
    }
  }

  // ─── Tier 3: Known ETF detection ───
  const unresolved = Object.entries(sectors).filter(([_, s]) => !s);
  if (unresolved.length > 0) {
    // Common ETF patterns: starts with X, SPY-like, ends with specific letters
    const etfPattern = /^(XL[KEFUVIR]|SPY|QQQ|IWM|DIA|VOO|VTI|ARK[KFGQWX]|SOXX|SMH|URA|GDX|SLV|GLD|TLT|BND|AGG|HYG|LQD|VNQ|EEM|EFA|IVV|RSP|XLP|XLE|XLF|XLI|XLB|XLY|XLU|XLV|XRT|IYR|KRE|XME|ICLN|TAN)$/;
    for (const [symbol] of unresolved) {
      if (etfPattern.test(symbol)) {
        sectors[symbol] = 'ETF';
      }
    }
  }

  // Remember every resolution for the rest of the process lifetime (24h TTL).
  for (const [sym, sec] of Object.entries(sectors)) {
    sectorCache.set(sym, { sector: sec, ts: Date.now() });
  }

  return NextResponse.json(
    { sectors: { ...sectors, ...cachedSectors } },
    { headers: { 'X-Cache': 'MISS' } },
  );
}
