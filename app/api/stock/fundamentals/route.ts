// ─── Stock Fundamentals API ──────────────────────────────────
// GET /api/stock/fundamentals?symbol=KO
// Returns EPS, P/E, dividend yield, analyst consensus.
// Data source: Yahoo Finance v10 quoteSummary (Finnhub free tier
// returns null for all tested tickers on /stock/metric).
// Cached per symbol with 24h TTL.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { yahooFundamentals } from '@/lib/market-data';

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
  source: string;
}

const cache = new Map<string, { data: FundamentalsResponse; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

  try {
    const fundamentals = await yahooFundamentals(symbol);

    if (!fundamentals) {
      return Response.json({ error: 'No fundamentals data for symbol' }, { status: 404 });
    }

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
