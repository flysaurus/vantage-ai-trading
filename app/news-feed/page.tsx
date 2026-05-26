'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  ArrowLeft, Newspaper, ExternalLink, Clock, TrendingUp, TrendingDown,
  Minus, Filter, RefreshCcw, Search, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
interface Article {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  imageUrl: string | null;
  publishedAt: number;
  symbols: string[];
  category: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

type SentimentFilter = 'all' | 'positive' | 'negative' | 'neutral';

// ─── Helpers ──────────────────────────────────────────────────
function timeAgo(unixSeconds: number): string {
  const now = Date.now();
  const diff = now - unixSeconds * 1000;
  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

// ─── Page ─────────────────────────────────────────────────────
export default function NewsFeedPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Available symbols from articles
  const availableSymbols = useMemo(() => {
    const set = new Set<string>();
    articles.forEach(a => a.symbols.forEach(s => set.add(s)));
    return Array.from(set).sort();
  }, [articles]);

  // ─── Load news ─────────────────────────────────────────────
  const loadNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = symbolFilter
        ? `/api/news?symbols=${encodeURIComponent(symbolFilter)}&limit=30`
        : '/api/news?limit=30';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setArticles(data.articles || []);
    } catch {
      setError('Failed to load news');
    } finally {
      setLoading(false);
    }
  }, [symbolFilter]);

  useEffect(() => { loadNews(); }, [loadNews]);

  // ─── Filtered articles ─────────────────────────────────────
  const filteredArticles = useMemo(() => {
    let list = articles;

    if (sentimentFilter !== 'all') {
      list = list.filter(a => a.sentiment === sentimentFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        a =>
          a.headline.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.symbols.some(s => s.toLowerCase().includes(q)) ||
          a.source.toLowerCase().includes(q)
      );
    }

    return list;
  }, [articles, sentimentFilter, searchQuery]);

  // ─── Counts ────────────────────────────────────────────────
  const sentimentCounts = useMemo(() => {
    let pos = 0, neg = 0, neu = 0;
    articles.forEach(a => {
      if (a.sentiment === 'positive') pos++;
      else if (a.sentiment === 'negative') neg++;
      else neu++;
    });
    return { pos, neg, neu };
  }, [articles]);

  // ─── Auth guard ───────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCcw size={24} style={{ color: '#06b6d4', marginBottom: 8, animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: 13 }}>Loading...</div>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        Please sign in to view your news feed.
      </div>
    );
  }

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', padding: '12px 16px 120px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>News Feed</h1>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {articles.length} articles · Market & portfolio news
          </div>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
            background: showFilters ? '#06b6d4' : '#1e293b',
            color: showFilters ? '#0f172a' : 'var(--text-dim)',
            border: `1px solid ${showFilters ? '#06b6d4' : '#334155'}`, borderRadius: 8,
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Filter size={13} /> Filters
        </button>
        <button
          onClick={loadNews}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, borderRadius: 8,
            background: '#1e293b', border: '1px solid #334155',
            color: 'var(--text-dim)', cursor: 'pointer',
          }}
          title="Refresh"
        >
          <RefreshCcw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search headlines, symbols, sources..."
          style={{
            width: '100%', padding: '9px 10px 9px 32px', borderRadius: 8,
            background: '#1e293b', border: '1px solid #334155',
            color: '#e2e8f0', fontSize: 12, outline: 'none',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div style={{
          padding: 12, marginBottom: 10, borderRadius: 10,
          background: '#1e293b', border: '1px solid #334155',
        }}>
          {/* Sentiment filter */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sentiment</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { key: 'all', label: 'All', count: articles.length },
                { key: 'positive', label: 'Bullish', count: sentimentCounts.pos },
                { key: 'negative', label: 'Bearish', count: sentimentCounts.neg },
                { key: 'neutral', label: 'Neutral', count: sentimentCounts.neu },
              ] as { key: SentimentFilter; label: string; count: number }[]).map(s => (
                <button
                  key={s.key}
                  onClick={() => setSentimentFilter(s.key)}
                  style={{
                    padding: '6px 12px', borderRadius: 6,
                    background: sentimentFilter === s.key ? '#06b6d4' : '#0f172a',
                    color: sentimentFilter === s.key ? '#0f172a' : 'var(--text-dim)',
                    border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {s.label} ({s.count})
                </button>
              ))}
            </div>
          </div>

          {/* Symbol filter */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              By Symbol
              {symbolFilter && (
                <button onClick={() => setSymbolFilter('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 10 }}>
                  Clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {availableSymbols.length === 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No symbols in loaded articles</span>
              )}
              {availableSymbols.map(sym => (
                <button
                  key={sym}
                  onClick={() => setSymbolFilter(symbolFilter === sym ? '' : sym)}
                  style={{
                    padding: '3px 10px', borderRadius: 4,
                    background: symbolFilter === sym ? '#06b6d4' : '#0f172a',
                    color: symbolFilter === sym ? '#0f172a' : 'var(--text-dim)',
                    border: 'none', fontSize: 11, fontWeight: 600,
                    fontFamily: 'monospace', cursor: 'pointer', letterSpacing: '-0.3px',
                  }}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={loadNews} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ padding: 14, borderRadius: 10, background: '#1e293b', border: '1px solid #334155' }}>
              <div style={{ height: 12, width: '70%', borderRadius: 4, background: '#334155', marginBottom: 8 }} />
              <div style={{ height: 10, width: '100%', borderRadius: 4, background: '#1e293b', marginBottom: 4 }} />
              <div style={{ height: 10, width: '60%', borderRadius: 4, background: '#1e293b' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <div style={{ height: 8, width: 60, borderRadius: 4, background: '#334155' }} />
                <div style={{ height: 8, width: 40, borderRadius: 4, background: '#334155' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredArticles.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        }}>
          <Newspaper size={40} style={{ color: '#475569', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            {symbolFilter ? `No news found for ${symbolFilter}` : 'No articles found'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {searchQuery ? 'Try a different search term' : 'Check back for new articles'}
          </div>
        </div>
      )}

      {/* Article list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredArticles.map(article => (
          <NewsCard
            key={article.id}
            article={article}
            onSymbolClick={(sym) => {
              setSymbolFilter(sym);
              setShowFilters(true);
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

// ─── News Card Component ──────────────────────────────────────
function NewsCard({
  article,
  onSymbolClick,
}: {
  article: Article;
  onSymbolClick: (symbol: string) => void;
}) {
  const sentimentConfig = {
    positive: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)', icon: TrendingUp, label: 'Bullish' },
    negative: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', icon: TrendingDown, label: 'Bearish' },
    neutral: { color: '#64748b', bg: 'rgba(100,116,139,0.08)', icon: Minus, label: 'Neutral' },
  }[article.sentiment];

  const SentIcon = sentimentConfig.icon;

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="news-card"
      style={{ textDecoration: 'none' }}
    >
      <div style={{ display: 'flex', gap: 10 }}>
        {/* Image */}
        {article.imageUrl && (
          <div style={{
            width: 70, height: 70, borderRadius: 8, flexShrink: 0,
            background: '#334155', overflow: 'hidden',
          }}>
            <img
              src={article.imageUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
            />
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <h3 className="news-headline" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, margin: 0 }}>
                {article.headline}
                <ExternalLink size={10} style={{ marginLeft: 4, color: '#64748b', opacity: 0 }} className="ext-icon" />
              </h3>
            </div>
          </div>

          {/* Summary */}
          {article.summary && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {article.summary}
            </p>
          )}

          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {/* Sentiment badge */}
            <span style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '2px 7px', borderRadius: 4,
              background: sentimentConfig.bg, color: sentimentConfig.color,
              fontSize: 10, fontWeight: 600,
            }}>
              <SentIcon size={10} />
              {sentimentConfig.label}
            </span>

            {/* Source */}
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{article.source}</span>

            {/* Time */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)' }}>
              <Clock size={10} />
              {timeAgo(article.publishedAt)}
            </span>

            {/* Symbol chips */}
            {article.symbols.length > 0 && (
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {article.symbols.map(sym => (
                  <button
                    key={sym}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSymbolClick(sym);
                    }}
                    style={{
                      padding: '1px 6px', borderRadius: 3,
                      background: '#0f172a', border: 'none',
                      color: '#06b6d4', fontSize: 10, fontWeight: 600,
                      fontFamily: 'monospace', cursor: 'pointer',
                    }}
                  >
                    ${sym}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </a>
  );
}
