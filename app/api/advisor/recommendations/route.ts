// ─── Recommendations API ──────────────────────────────────────
// GET /api/advisor/recommendations?symbol=AAPL
//
// Fetches real-time price data (Alpaca) + fundamentals (Finnhub),
// runs all 5 investor-style engines, returns typed recommendations.

import { NextRequest, NextResponse } from 'next/server';
import { getAllRecommendations, type StockData } from '@/lib/advisor/engine';

// ─── Alpaca snapshot helpers ──────────────────────────────────

async function getAlpacaSnapshot(symbol: string): Promise<{
  currentPrice: number;
  volume: number;
  avgVolume: number;
  week52High: number;
  week52Low: number;
  price50ma: number | null;
  price200ma: number | null;
  rsi: number | null;
  macd: number | null;
  beta: number | null;
} | null> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) return null;

  try {
    // Fetch snapshot for current price, daily bar, latest quote
    const snapRes = await fetch(
      `https://data.alpaca.markets/v2/stocks/${symbol.toUpperCase()}/snapshot`,
      {
        headers: {
          'APCA-API-KEY-ID': keyId,
          'APCA-API-SECRET-KEY': secretKey,
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!snapRes.ok) return null;
    const snap = await snapRes.json();

    const currentPrice = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
    if (!currentPrice) return null;

    const volume = snap?.dailyBar?.v ?? 0;
    const avgVolume = snap?.prevDailyBar?.v ? (snap.dailyBar.v + snap.prevDailyBar.v) / 2 : volume;

    return {
      currentPrice,
      volume,
      avgVolume,
      week52High: snap?.dailyBar?.h ?? currentPrice,
      week52Low: snap?.dailyBar?.l ?? currentPrice,
      // MAs and technicals need historical data — fetch separately
      price50ma: null,
      price200ma: null,
      rsi: null,
      macd: null,
      beta: null,
    };
  } catch {
    return null;
  }
}

// ─── Finnhub fundamentals ─────────────────────────────────────

interface FinnhubMetrics {
  pe: number | null;
  pb: number | null;
  roe: number | null;
  roic: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  dividendYield: number | null;
  dividendGrowth: number | null;
  payoutRatio: number | null;
  fcfYield: number | null;
  marketCap: number | null;
}

async function getFinnhubMetrics(symbol: string): Promise<FinnhubMetrics> {
  const token = process.env.FINNHUB_IO_API_KEY;
  if (!token) return emptyMetrics();

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol.toUpperCase())}&metric=all&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!res.ok) return emptyMetrics();
    const json = await res.json();
    const m = json?.metric;
    if (!m) return emptyMetrics();

    return {
      pe: m.peBasicExclExtraTTM ?? m.peTTM ?? null,
      pb: m.pbAnnual ?? m.pbQuarterly ?? null,
      roe: m.roeTTM ?? m.roeRfy ?? null,
      roic: m.roicTTM ?? m.roicRfy ?? null,
      revenueGrowth: m.revenueGrowthTTMYoy ?? m.revenueGrowth3Y ?? null,
      earningsGrowth: m.epsGrowthTTMYoy ?? m.epsGrowth3Y ?? null,
      dividendYield: m.currentDividendYieldTTM ?? null,
      dividendGrowth: m.dividendGrowthRate5Y ?? null,
      payoutRatio: m.payoutRatioTTM ?? null,
      fcfYield: m.freeCashFlowYieldTTM ?? null,
      marketCap: json?.metric?.marketCapitalization ?? null, // Finnhub returns in millions
    };
  } catch {
    return emptyMetrics();
  }
}

function emptyMetrics(): FinnhubMetrics {
  return { pe: null, pb: null, roe: null, roic: null, revenueGrowth: null, earningsGrowth: null, dividendYield: null, dividendGrowth: null, payoutRatio: null, fcfYield: null, marketCap: null };
}

// ─── Sector lookup ────────────────────────────────────────────

async function getSector(symbol: string): Promise<string | undefined> {
  const token = process.env.FINNHUB_IO_API_KEY;
  if (!token) return undefined;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.finnhubIndustry || undefined;
  } catch {
    return undefined;
  }
}

// ─── Handler ──────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');

  if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
    return NextResponse.json({ error: 'Symbol parameter is required' }, { status: 400 });
  }

  const upperSymbol = symbol.toUpperCase().trim();

  try {
    // Fetch in parallel
    const [snapshot, metrics, sector] = await Promise.all([
      getAlpacaSnapshot(upperSymbol),
      getFinnhubMetrics(upperSymbol),
      getSector(upperSymbol),
    ]);

    if (!snapshot) {
      return NextResponse.json(
        { error: `Could not fetch price data for ${upperSymbol}. Check symbol or try again.` },
        { status: 404 }
      );
    }

    // Build StockData from real API responses
    const stockData: StockData = {
      symbol: upperSymbol,
      currentPrice: snapshot.currentPrice,
      entryPrice: snapshot.currentPrice, // caller should override with actual entry
      pe: metrics.pe ?? undefined,
      pb: metrics.pb ?? undefined,
      fcfYield: metrics.fcfYield ?? undefined,
      revenueGrowth: metrics.revenueGrowth ?? undefined,
      earningsGrowth: metrics.earningsGrowth ?? undefined,
      payoutRatio: metrics.payoutRatio ?? undefined,
      dividendYield: metrics.dividendYield ?? undefined,
      dividendGrowth: metrics.dividendGrowth ?? undefined,
      roe: metrics.roe ?? undefined,
      roic: metrics.roic ?? undefined,
      marketCap: metrics.marketCap ?? undefined,
      price50ma: snapshot.price50ma ?? undefined,
      price200ma: snapshot.price200ma ?? undefined,
      rsi: snapshot.rsi ?? undefined,
      macd: snapshot.macd ?? undefined,
      volume: snapshot.volume,
      avgVolume: snapshot.avgVolume,
      week52High: snapshot.week52High,
      week52Low: snapshot.week52Low,
      sector,
    };

    // Run all 5 engines
    const recommendations = getAllRecommendations(stockData);

    return NextResponse.json({
      symbol: upperSymbol,
      stockData,
      recommendations,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate recommendations';
    console.error('Recommendation error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
