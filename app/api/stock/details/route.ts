// ─── Stock Details API (Multi-Source) ─────────────────────────
// Fetches profile + quote + fundamentals with fallback chain:
//   Profile:     Finnhub → Yahoo
//   Quote:       Finnhub → Alpaca → Yahoo
//   Fundamentals: Finnhub only
//
// GET /api/stock/details?symbol=AAPL
//   → { symbol, name, exchange, sector, marketCap, price, change,
//       changePercent, previousClose, eps, pe, high52w, low52w }

import { type NextRequest, NextResponse } from 'next/server';
import { getQuote, getCompanyProfile, getFundamentals, isConfigured } from '@/lib/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'No market data source configured' }, { status: 503 });
  }

  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()?.trim();
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  try {
    const [profile, quote, fundamentals] = await Promise.all([
      getCompanyProfile(symbol),
      getQuote(symbol),
      getFundamentals(symbol),
    ]);

    return NextResponse.json({
      symbol,
      name: profile?.name || null,
      exchange: profile?.exchange || null,
      sector: profile?.industry || null,
      marketCap: profile?.marketCap ?? fundamentals?.marketCap ?? null,
      logo: profile?.logo || null,
      price: quote?.price ?? null,
      change: quote?.change ?? null,
      changePercent: quote?.changePercent ?? null,
      previousClose: quote?.previousClose ?? null,
      high: quote?.high ?? null,
      low: quote?.low ?? null,
      eps: fundamentals?.eps ?? null,
      pe: fundamentals?.pe ?? null,
      high52w: quote?.high52w ?? fundamentals?.high52w ?? null,
      low52w: quote?.low52w ?? fundamentals?.low52w ?? null,
      source: {
        profile: profile?.source || 'none',
        quote: quote?.source || 'none',
        fundamentals: fundamentals?.source || 'none',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch stock details' }, { status: 502 });
  }
}
