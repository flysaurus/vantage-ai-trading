// ─── Market Quotes API ──────────────────────────────────────────
// Fetches real-time quotes from Yahoo Finance (free, no API key).
// Used for demo mode to show real market prices with made-up positions.
//
// POST /api/market/quotes
// Body: { symbols: string[] }
// Returns: { quotes: { [symbol]: { price, change, changePercent, previousClose } } }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface YahooQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketPreviousClose: number;
}

export async function POST(request: Request) {
  try {
    const { symbols } = await request.json();

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return Response.json({ error: 'symbols array required' }, { status: 400 });
    }

    // Validate symbols (basic sanity check)
    const clean = symbols.map((s: string) => String(s).trim().toUpperCase()).filter(Boolean);
    if (clean.length === 0) {
      return Response.json({ error: 'No valid symbols' }, { status: 400 });
    }

    // Fetch from Yahoo Finance v7 quote endpoint
    const yahooUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${clean.join(',')}`;

    const res = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Vantage/1.0)',
      },
      next: { revalidate: 60 }, // Cache for 60 seconds
    });

    if (!res.ok) {
      console.error('[Market Quotes] Yahoo returned', res.status);
      return Response.json({ error: 'Failed to fetch quotes' }, { status: 502 });
    }

    const data = await res.json();
    const result = data?.quoteResponse?.result as YahooQuote[] | undefined;

    if (!result || result.length === 0) {
      return Response.json({ error: 'No quote data returned' }, { status: 502 });
    }

    // Build the quotes map
    const quotes: Record<string, {
      price: number;
      change: number;
      changePercent: number;
      previousClose: number;
    }> = {};

    for (const q of result) {
      quotes[q.symbol] = {
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        previousClose: q.regularMarketPreviousClose ?? 0,
      };
    }

    return Response.json({ quotes });
  } catch (err) {
    console.error('[Market Quotes] Error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
