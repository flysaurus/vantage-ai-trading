// ─── Market Quotes API (Finnhub) ──────────────────────────────
// Fetches real-time quotes from Finnhub.io for demo/fallback mode.
// Finnhub free tier: 60 API calls/min, supports stocks + ETFs.
//
// POST /api/market/quotes
// Body: { symbols: string[] }
// Returns: { quotes: { [symbol]: { price, change, changePercent, previousClose } } }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FINNHUB_KEY = process.env.FINNHUB_IO_API_KEY;

interface FinnhubQuote {
  c: number;  // Current price
  d: number;  // Change
  dp: number; // Percent change
  h: number;  // High price of the day
  l: number;  // Low price of the day
  o: number;  // Open price of the day
  pc: number; // Previous close price
  t: number;  // Timestamp
}

async function fetchQuote(symbol: string): Promise<{ symbol: string; price: number; change: number; changePercent: number; previousClose: number } | null> {
  if (!FINNHUB_KEY) {
    console.error('[Market Quotes] FINNHUB_IO_API_KEY not set');
    return null;
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 60 } },
    );

    if (!res.ok) {
      console.error(`[Market Quotes] Finnhub returned ${res.status} for ${symbol}`);
      return null;
    }

    const data: FinnhubQuote = await res.json();

    // Finnhub returns all zeros for invalid/unknown symbols
    if (data.c === 0 && data.pc === 0) {
      return null;
    }

    return {
      symbol,
      price: data.c,
      change: data.d ?? 0,
      changePercent: data.dp ?? 0,
      previousClose: data.pc,
    };
  } catch (err) {
    console.error(`[Market Quotes] Error fetching ${symbol}:`, err);
    return null;
  }
}

// Fetch in concurrent batches to stay within rate limit
async function fetchBatch(symbols: string[], concurrency = 10): Promise<Map<string, { price: number; change: number; changePercent: number; previousClose: number }>> {
  const results = new Map<string, { price: number; change: number; changePercent: number; previousClose: number }>();

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fetchQuote));

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.set(result.value.symbol, {
          price: result.value.price,
          change: result.value.change,
          changePercent: result.value.changePercent,
          previousClose: result.value.previousClose,
        });
      }
    }

    // Small delay between batches to be nice to the API
    if (i + concurrency < symbols.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

export async function POST(request: Request) {
  try {
    const { symbols } = await request.json();

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return Response.json({ error: 'symbols array required' }, { status: 400 });
    }

    if (!FINNHUB_KEY) {
      return Response.json({ error: 'Finnhub API key not configured' }, { status: 503 });
    }

    // Validate and deduplicate symbols
    const clean = [...new Set(symbols.map((s: string) => String(s).trim().toUpperCase()).filter(Boolean))];
    if (clean.length === 0) {
      return Response.json({ error: 'No valid symbols' }, { status: 400 });
    }

    const results = await fetchBatch(clean);

    // Convert Map to plain object
    const quotes: Record<string, {
      price: number;
      change: number;
      changePercent: number;
      previousClose: number;
    }> = {};

    for (const [symbol, data] of results) {
      quotes[symbol] = data;
    }

    return Response.json({ quotes });
  } catch (err) {
    console.error('[Market Quotes] Error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
