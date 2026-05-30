// ─── Stock Details API (Finnhub) ──────────────────────────────
// Fetches profile2 + quote + metric from Finnhub for DCA setup.
//
// GET /api/stock/details?symbol=AAPL
//   → { symbol, name, exchange, sector, marketCap, price, change,
//       changePercent, previousClose, eps, pe, high52w, low52w }

import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function token(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t = token();
  if (!t) {
    return NextResponse.json({ error: 'Finnhub API key not configured' }, { status: 503 });
  }

  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()?.trim();
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  try {
    const [profileRes, quoteRes, metricRes] = await Promise.all([
      fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${t}`),
      fetch(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${t}`),
      fetch(`${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${t}`),
    ]);

    const profile = profileRes.ok ? await profileRes.json() : {};
    const quote = quoteRes.ok ? await quoteRes.json() : {};
    const metric = metricRes.ok ? await metricRes.json() : {};

    // Validate quote data — Finnhub returns c=0 for unknown symbols
    const price = typeof quote.c === 'number' && quote.c > 0 ? quote.c : null;

    return NextResponse.json({
      symbol,
      name: profile.name || null,
      exchange: profile.exchange || null,
      sector: profile.finnhubIndustry || null,
      marketCap: profile.marketCapitalization
        ? profile.marketCapitalization * 1_000_000
        : null,
      logo: profile.logo || null,
      price,
      change: quote.d ?? null,
      changePercent: quote.dp ?? null,
      previousClose: quote.pc ?? null,
      high: quote.h ?? null,
      low: quote.l ?? null,
      eps: metric.metric?.epsBasicExclExtraItemsTTM ?? null,
      pe: metric.metric?.peBasicExclExtraTTM ?? null,
      high52w: metric.metric?.['52WeekHigh'] ?? null,
      low52w: metric.metric?.['52WeekLow'] ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch stock details' }, { status: 502 });
  }
}
