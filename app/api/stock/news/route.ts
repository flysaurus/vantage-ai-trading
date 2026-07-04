// ─── Stock News API ─────────────────────────────────────────
// GET /api/stock/news?symbol=KO
// Returns recent headlines from Finnhub → Yahoo RSS.
// Cached per symbol with 1h TTL.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getStockNews, NewsItem } from '@/lib/market-data';

const cache = new Map<string, { data: NewsItem[]; ts: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();
  const count = Math.min(Math.max(parseInt(searchParams.get('count') || '3'), 1), 5);

  if (!symbol || !/^[A-Za-z.]{1,10}$/.test(symbol)) {
    return Response.json({ error: 'Valid symbol required' }, { status: 400 });
  }

  const cacheKey = `${symbol}:${count}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json({ symbol, news: cached.data }, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=900' },
    });
  }

  try {
    const news = await getStockNews(symbol, count);
    cache.set(cacheKey, { data: news, ts: Date.now() });

    return Response.json({ symbol, news }, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=900' },
    });
  } catch (err: any) {
    console.error(`[StockNews] ${symbol} fetch error:`, err?.message);
    return Response.json({ symbol, news: [] }, { status: 200 });
  }
}
