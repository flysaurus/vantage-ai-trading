// ─── Market Quotes API (Multi-Source Fallback) ────────────────
// Fetches real-time quotes with fallback chain:
//   Finnhub → Alpaca → Yahoo Finance
//
// POST /api/market/quotes
// Body: { symbols: string[] }
// Returns: { quotes: { [symbol]: { price, change, changePercent, previousClose, source } } }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getBatchQuotes, isConfigured } from '@/lib/market-data';

export async function POST(request: Request) {
  try {
    const { symbols } = await request.json();

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return Response.json({ error: 'symbols array required' }, { status: 400 });
    }

    if (!isConfigured()) {
      return Response.json({ error: 'No market data source configured (Finnhub or Alpaca)' }, { status: 503 });
    }

    // Validate and deduplicate symbols
    const clean = [...new Set(symbols.map((s: string) => String(s).trim().toUpperCase()).filter(Boolean))];
    if (clean.length === 0) {
      return Response.json({ error: 'No valid symbols' }, { status: 400 });
    }

    const results = await getBatchQuotes(clean);

    // Convert Map to plain object
    const quotes: Record<string, {
      price: number;
      change: number;
      changePercent: number;
      previousClose: number;
      high: number;
      low: number;
      open: number;
      source: string;
    }> = {};

    for (const [symbol, data] of results) {
      quotes[symbol] = {
        price: data.price,
        change: data.change,
        changePercent: data.changePercent,
        previousClose: data.previousClose,
        high: data.high,
        low: data.low,
        open: data.open,
        source: data.source,
      };
    }

    return Response.json({ quotes });
  } catch (err) {
    console.error('[Market Quotes] Error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
