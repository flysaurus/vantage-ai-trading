// ─── Stock Fundamentals API ──────────────────────────────────
// GET /api/stock/fundamentals?symbol=KO
// Returns EPS, P/E, dividend yield, analyst consensus.
// Data source: Yahoo Finance v10 quoteSummary (Finnhub free tier
// returns null for all tested tickers on /stock/metric).
// Cached per symbol with 24h TTL.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { yahooFundamentals, yahooCooldownRemainingMs } from '@/lib/market-data';
import type { AnalystSummary } from '@/lib/market-data';

interface FundamentalsResponse {
  symbol: string;
  eps: number | null;
  pe: number | null;
  dividendYield: number | null;
  dividendRate: number | null;
  recommendation: string | null;
  numAnalysts: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  beta: number | null;
  nextEarningsDate: string | null;
  /** Analyst consensus block (aggregate — see AnalystSummary in lib/market-data.ts). */
  analyst: AnalystSummary | null;
  source: string;
}

const cache = new Map<string, { data: FundamentalsResponse; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Short negative cache: after a 429/401 burst we do NOT want every portfolio
// render to re-hit the provider (that is what causes the burst).
const unavailable = new Map<string, number>();
const UNAVAILABLE_TTL_MS = 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();

  if (!symbol || !/^[A-Za-z.]{1,10}$/.test(symbol)) {
    return Response.json({ error: 'Valid symbol required' }, { status: 400 });
  }

  // Check cache
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json(cached.data, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // Recently rate-limited -> don't touch the provider.
  const parkedAt = unavailable.get(symbol);
  if (parkedAt && Date.now() - parkedAt < UNAVAILABLE_TTL_MS) {
    if (cached) {
      return Response.json(cached.data, { headers: { 'X-Cache': 'STALE', 'Cache-Control': 'no-store' } });
    }
    return Response.json(
      { error: 'Analyst data temporarily unavailable', retryAfterSeconds: 60 },
      { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const fundamentals = await yahooFundamentals(symbol);

    if (!fundamentals) {
      // null == the PROVIDER failed (429/401/no crumb) - NOT "no coverage".
      // A genuinely uncovered symbol comes back as an all-null payload with
      // 200 (see emptyFundamentals), so 404 here would be a lie that makes the
      // UI say "No analyst coverage" for a stock that simply wasn't fetched.
      unavailable.set(symbol, Date.now());
      if (cached) {
        // Serve stale rather than blank the card out.
        return Response.json(cached.data, { headers: { 'X-Cache': 'STALE', 'Cache-Control': 'no-store' } });
      }
      const cooldown = Math.ceil((yahooCooldownRemainingMs() || 60000) / 1000);
      return Response.json(
        { error: 'Analyst data temporarily unavailable', retryAfterSeconds: cooldown },
        { status: 503, headers: { 'Retry-After': String(cooldown), 'Cache-Control': 'no-store' } }
      );
    }

    unavailable.delete(symbol);

    const response: FundamentalsResponse = {
      symbol: fundamentals.symbol,
      eps: fundamentals.eps,
      pe: fundamentals.pe,
      dividendYield: fundamentals.dividendYield,
      dividendRate: fundamentals.dividendRate,
      recommendation: fundamentals.recommendation,
      numAnalysts: fundamentals.numAnalysts,
      marketCap: fundamentals.marketCap,
      volume: fundamentals.volume,
      avgVolume: fundamentals.avgVolume,
      dayHigh: fundamentals.dayHigh,
      dayLow: fundamentals.dayLow,
      beta: fundamentals.beta,
      nextEarningsDate: fundamentals.nextEarningsDate,
      analyst: fundamentals.analyst ?? null,
      source: fundamentals.source,
    };

    cache.set(symbol, { data: response, ts: Date.now() });

    return Response.json(response, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err: any) {
    console.error(`[Fundamentals] ${symbol} fetch error:`, err?.message);
    return Response.json({ error: 'Failed to fetch fundamentals' }, { status: 500 });
  }
}
