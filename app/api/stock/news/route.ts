// ─── Stock News API ─────────────────────────────────────────
// GET /api/stock/news?symbol=KO
// Returns ranked headlines with FinBERT sentiment scores.
// Relevance + sentiment magnitude + recency composite ranking.
// Cached per symbol with 1h TTL.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getStockNews } from '@/lib/market-data';

const FINBERT_URL = process.env.FINBERT_URL || 'http://127.0.0.1:8765';

// ─── Enriched news item ────────────────────────────────────

interface SentimentChip {
  label: 'positive' | 'negative' | 'neutral';
  score: number; // -1 to 1
}

interface RankedNewsItem {
  title: string;
  link: string;
  publisher: string;
  pubDate: string;
  sentiment: SentimentChip;
  relevanceScore: number; // 0-1
}

const cache = new Map<string, { data: RankedNewsItem[]; ts: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Relevance scoring ─────────────────────────────────────

function computeRelevance(title: string, symbol: string): number {
  const t = title.toLowerCase();
  const s = symbol.toLowerCase();

  // Direct ticker mention at start of title
  const wordBoundary = new RegExp(`\\b${s}\\b`, 'i');
  if (!wordBoundary.test(t)) return 0.3; // no symbol mention = broad market

  // Symbol in first ~5 words = primary subject
  const firstWords = t.split(/\s+/).slice(0, 6).join(' ');
  if (wordBoundary.test(firstWords)) return 1.0;

  // Symbol mentioned later = passing mention
  return 0.7;
}

// ─── Sentiment scoring (parallel FinBERT) ──────────────────

async function scoreHeadlines(
  headlines: { title: string }[]
): Promise<SentimentChip[]> {
  try {
    const results = await Promise.allSettled(
      headlines.map(async (h) => {
        const res = await fetch(`${FINBERT_URL}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: h.title }),
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return { label: 'neutral' as const, score: 0 };
        const fb = await res.json();
        return {
          label: (fb.label === 'positive' ? 'positive' : fb.label === 'negative' ? 'negative' : 'neutral') as 'positive' | 'negative' | 'neutral',
          score: fb.score || 0,
        };
      })
    );
    return results.map(r =>
      r.status === 'fulfilled' ? r.value : { label: 'neutral' as const, score: 0 }
    );
  } catch {
    return headlines.map(() => ({ label: 'neutral' as const, score: 0 }));
  }
}

// ─── Recency norm (0-1) ────────────────────────────────────

function recencyNorm(pubDate: string): number {
  if (!pubDate) return 0.3;
  const hoursAgo = (Date.now() - new Date(pubDate).getTime()) / (1000 * 60 * 60);
  if (hoursAgo <= 6) return 1.0;
  if (hoursAgo <= 24) return 0.8;
  if (hoursAgo <= 48) return 0.5;
  return 0.2;
}

// ─── Composite ranking ─────────────────────────────────────
//
// score = relevance * 0.50 + sentiment_magnitude * 0.30 + recency * 0.20
//
// This surfaces directly-relevant headlines above broad market noise,
// prioritizes strong opinions over bland neutrality, and uses
// recency only as a tiebreaker within similar score bands.

function rankScore(relevance: number, sentScore: number, recency: number): number {
  return relevance * 0.50 + Math.abs(sentScore) * 0.30 + recency * 0.20;
}

// ─── GET handler ───────────────────────────────────────────

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
    // Fetch more headlines than needed for ranking pool
    const poolSize = Math.max(count * 3, 8);
    const raw = await getStockNews(symbol, poolSize);

    if (raw.length === 0) {
      return Response.json({ symbol, news: [] }, {
        headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=900' },
      });
    }

    // Score headlines with FinBERT (parallel)
    const sentiments = await scoreHeadlines(raw);

    // Compute composite rank score
    const ranked = raw.map((item, i) => {
      const relevance = computeRelevance(item.title, symbol);
      const sentiment = sentiments[i] || { label: 'neutral' as const, score: 0 };
      const recency = recencyNorm(item.pubDate);
      const score = rankScore(relevance, sentiment.score, recency);

      return {
        title: item.title,
        link: item.link,
        publisher: item.publisher,
        pubDate: item.pubDate,
        sentiment,
        relevanceScore: relevance,
        _rankScore: score,
      };
    });

    // Sort by composite score descending
    ranked.sort((a, b) => b._rankScore - a._rankScore);

    // Return top N, strip internal _rankScore
    const top = ranked.slice(0, count).map(({ _rankScore, ...rest }) => rest);

    cache.set(cacheKey, { data: top, ts: Date.now() });

    return Response.json({ symbol, news: top }, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=900' },
    });
  } catch (err: any) {
    console.error(`[StockNews] ${symbol} fetch error:`, err?.message);
    return Response.json({ symbol, news: [] }, { status: 200 });
  }
}
