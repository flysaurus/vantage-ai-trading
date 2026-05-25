// ─── GET /api/news ────────────────────────────────────────────
// Fetches market news from Finnhub. Optionally filtered by symbols.
// GET /api/news — general market news
// GET /api/news?symbols=AAPL,MSFT — company-specific news

import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

export interface NewsArticle {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  imageUrl: string | null;
  publishedAt: number; // unix seconds
  symbols: string[];    // related stock symbols
  category: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = getToken();
  if (!token) {
    return NextResponse.json({ error: 'News API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const symbolsParam = searchParams.get('symbols') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const symbols = symbolsParam
      ? symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 10)
      : [];

    let articles: NewsArticle[] = [];

    if (symbols.length > 0) {
      // Fetch company news per symbol (parallel)
      const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const toDate = new Date().toISOString().split('T')[0];

      const results = await Promise.allSettled(
        symbols.map(async (symbol) => {
          const res = await fetch(
            `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${token}`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (!res.ok) return [];
          const data = await res.json();
          if (!Array.isArray(data)) return [];
          return data.map((item: any) => ({
            id: String(item.id || Math.random()),
            headline: item.headline || '',
            summary: (item.summary || '').slice(0, 300),
            source: item.source || 'Unknown',
            url: item.url || '',
            imageUrl: item.image || null,
            publishedAt: item.datetime || Math.floor(Date.now() / 1000),
            symbols: [symbol],
            category: item.category || 'general',
          }));
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') articles.push(...r.value);
      }
    } else {
      // General market news — no symbol filter
      const res = await fetch(
        `${FINNHUB_BASE}/news?category=general&token=${token}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          articles = data.map((item: any) => ({
            id: String(item.id || Math.random()),
            headline: item.headline || '',
            summary: (item.summary || '').slice(0, 300),
            source: item.source || 'Unknown',
            url: item.url || '',
            imageUrl: item.image || null,
            publishedAt: item.datetime || Math.floor(Date.now() / 1000),
            symbols: item.related ? [item.related] : [],
            category: item.category || 'general',
          }));
        }
      }
    }

    // Deduplicate by headline (Finnhub sometimes duplicates across symbols)
    const seen = new Set<string>();
    articles = articles.filter(a => {
      const key = a.headline.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by most recent
    articles.sort((a, b) => b.publishedAt - a.publishedAt);
    articles = articles.slice(0, limit);

    // Simple keyword-based sentiment
    const withSentiment = articles.map(a => ({
      ...a,
      sentiment: computeSentiment(a.headline + ' ' + a.summary),
    }));

    return NextResponse.json({ articles: withSentiment });
  } catch (err: any) {
    console.error('[news] fetch error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch news', articles: [] }, { status: 200 });
  }
}

// ─── Sentiment Helper ─────────────────────────────────────────
function computeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const t = text.toLowerCase();
  let score = 0;

  const positiveWords = [
    'surge', 'surged', 'soar', 'soared', 'rally', 'rallied', 'gain', 'gained',
    'beat', 'beats', 'exceed', 'outperform', 'upgrade', 'upgraded', 'bullish',
    'record high', 'all-time high', 'breakthrough', 'growth', 'profit',
    'buyback', 'dividend increase', 'raised guidance', 'strong earnings',
    'beat estimates', 'approval', 'approved', 'partnership', 'expansion',
    'launch', 'innovation', 'positive', 'optimistic', 'recovery',
  ];
  const negativeWords = [
    'plunge', 'plunged', 'plummet', 'crash', 'crashed', 'tumble', 'tumbled',
    'decline', 'declined', 'drop', 'dropped', 'fall', 'fell', 'loss',
    'downgrade', 'downgraded', 'bearish', 'warning', 'warns', 'layoff',
    'layoffs', 'cut', 'cuts', 'restructuring', 'investigation', 'lawsuit',
    'fine', 'fined', 'penalty', 'recall', 'recalled', 'debt', 'default',
    'bankruptcy', 'filing', 'miss', 'missed', 'below estimates', 'sell-off',
    'selloff', 'weak', 'weakness', 'concern', 'risk', 'uncertainty',
    'tariff', 'tariffs', 'trade war', 'recession', 'inflation fears',
  ];

  for (const w of positiveWords) {
    if (t.includes(w)) score += 1;
  }
  for (const w of negativeWords) {
    if (t.includes(w)) score -= 1;
  }

  if (score >= 2) return 'positive';
  if (score <= -2) return 'negative';
  return 'neutral';
}
