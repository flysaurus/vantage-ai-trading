// ─── Recommendations API ──────────────────────────────────────
// GET /api/advisor/recommendations?symbol=AAPL
//
// Fetches real-time price data (Alpaca) + fundamentals (Finnhub),
// runs all 5 investor-style engines, returns typed recommendations.

import { NextRequest, NextResponse } from 'next/server';
import { getAllRecommendations, type StockData } from '@/lib/advisor/engine';

// ─── Technical helpers ────────────────────────────────────────

function calcRSI(bars: { c: number }[]): number {
  if (bars.length < 15) return 50;
  const changes = [];
  for (let i = 1; i < 15; i++) {
    changes.push(bars[i].c - bars[i - 1].c);
  }
  let gain = 0, loss = 0;
  for (const c of changes) {
    if (c > 0) gain += c; else loss += -c;
  }
  const avgGain = gain / 14;
  const avgLoss = loss / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function calcEMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1];
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcMACD(bars: { c: number }[]): number {
  if (bars.length < 26) return 0;
  const prices = bars.map(b => b.c);
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  return Math.round((ema12 - ema26) * 100) / 100;
}

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
    const [snapRes, barsRes] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/${symbol.toUpperCase()}/snapshot`, {
        headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey },
        signal: AbortSignal.timeout(5000),
      }),
      // Fetch 200 days of daily bars for MAs + RSI
      fetch(`https://data.alpaca.markets/v2/stocks/${symbol.toUpperCase()}/bars?timeframe=1D&limit=200&adjustment=raw&feed=sip&sort=desc`, {
        headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey },
        signal: AbortSignal.timeout(7000),
      }),
    ]);

    if (!snapRes.ok) return null;
    const snap = await snapRes.json();

    const currentPrice = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
    if (!currentPrice) return null;

    const volume = snap?.dailyBar?.v ?? 0;
    const avgVolume = snap?.prevDailyBar?.v ? (snap.dailyBar.v + snap.prevDailyBar.v) / 2 : volume;

    // Calculate MAs + RSI from historical bars
    let price50ma: number | null = null;
    let price200ma: number | null = null;
    let rsi: number | null = null;
    let macd: number | null = null;

    if (barsRes.ok) {
      const barsData = await barsRes.json();
      const bars: { c: number }[] = barsData?.bars || [];

      if (bars.length > 0) {
        // RSI (14-period)
        if (bars.length >= 15) {
          rsi = calcRSI(bars.slice(0, 15).reverse());
        }

        // MACD (12/26/9)
        if (bars.length >= 26) {
          macd = calcMACD(bars.slice(0, 35).reverse());
        }

        // 50-day MA
        if (bars.length >= 50) {
          const last50 = bars.slice(0, 50);
          price50ma = last50.reduce((sum, b) => sum + b.c, 0) / 50;
        }

        // 200-day MA
        if (bars.length >= 200) {
          price200ma = bars.reduce((sum, b) => sum + b.c, 0) / bars.length;
        }
      }
    }

    return {
      currentPrice,
      volume,
      avgVolume,
      week52High: snap?.dailyBar?.h ?? currentPrice,
      week52Low: snap?.dailyBar?.l ?? currentPrice,
      price50ma,
      price200ma,
      rsi,
      macd,
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
  const { getFundamentals } = await import('@/lib/market-data');
  const f = await getFundamentals(symbol);
  if (!f) return emptyMetrics();
  return {
    pe: f.pe,
    pb: null, // not in our simplified fundamentals, use Finnhub raw if needed
    roe: null,
    roic: null,
    revenueGrowth: null,
    earningsGrowth: null,
    dividendYield: f.dividendYield,
    dividendGrowth: null,
    payoutRatio: null,
    fcfYield: null,
    marketCap: f.marketCap,
  };
}

function emptyMetrics(): FinnhubMetrics {
  return { pe: null, pb: null, roe: null, roic: null, revenueGrowth: null, earningsGrowth: null, dividendYield: null, dividendGrowth: null, payoutRatio: null, fcfYield: null, marketCap: null };
}

// ─── Sector lookup ────────────────────────────────────────────

async function getSector(symbol: string): Promise<string | undefined> {
  const { getCompanyProfile } = await import('@/lib/market-data');
  const p = await getCompanyProfile(symbol);
  return p?.industry || undefined;
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
