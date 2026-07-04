// ─── 52-Week Sparkline API ──────────────────────────────────
// GET /api/market/sparkline?symbol=BRK.B
// Returns trailing 52 weeks of daily closes + high/low labels.
// Cached per symbol with 24h TTL (intraday).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SparklinePoint {
  t: number; // epoch seconds
  c: number; // close price
}

interface SparklineResponse {
  symbol: string;
  points: SparklinePoint[];
  high52w: number;
  low52w: number;
  current: number;
  source: string;
}

// In-memory cache: Map<symbol, { data, ts }>
const cache = new Map<string, { data: SparklineResponse; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * 24 * 60 * 60;

  try {
    // Yahoo Finance v8/chart — free, no API key
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${oneYearAgo}&period2=${now}&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return Response.json({ error: `Upstream error: ${res.status}` }, { status: 502 });
    }

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      return Response.json({ error: 'No data for symbol' }, { status: 404 });
    }

    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];
    const closes: number[] = quote?.close || [];

    // Filter out null closes, keep valid pairs
    const points: SparklinePoint[] = [];
    let high52w = -Infinity;
    let low52w = Infinity;

    for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
      if (closes[i] != null && closes[i] > 0) {
        points.push({ t: timestamps[i], c: closes[i] });
        if (closes[i] > high52w) high52w = closes[i];
        if (closes[i] < low52w) low52w = closes[i];
      }
    }

    if (points.length === 0) {
      return Response.json({ error: 'No valid price data' }, { status: 404 });
    }

    const current = points[points.length - 1].c;

    const response: SparklineResponse = {
      symbol,
      points,
      high52w,
      low52w,
      current,
      source: 'yahoo',
    };

    // Store in cache
    cache.set(symbol, { data: response, ts: Date.now() });

    return Response.json(response, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err: any) {
    console.error(`[Sparkline] ${symbol} fetch error:`, err?.message);
    return Response.json({ error: 'Failed to fetch sparkline data' }, { status: 500 });
  }
}
