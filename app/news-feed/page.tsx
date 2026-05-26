'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePortfolio } from '@/hooks/usePortfolio';
import {
  ArrowLeft, Newspaper, ExternalLink, Clock, TrendingUp,
  TrendingDown, Minus, Filter, RefreshCcw, Search, X,
  Globe, Briefcase,
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
type SectionTab = 'all' | 'macro' | 'portfolio';

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
  const { account } = usePortfolio();
  const router = useRouter();
  const [macroArticles, setMacroArticles] = useState<Article[]>([]);
  const [portfolioArticles, setPortfolioArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sectionTab, setSectionTab] = useState<SectionTab>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Portfolio symbol list
  const portfolioSymbols = useMemo(() => {
    return (account?.positions || []).map((p: { symbol: string }) => p.symbol).filter(Boolean);
  }, [account?.positions]);

  // ─── Load news ─────────────────────────────────────────────
  const loadNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetches: Promise<Response>[] = [
        // Macro news
        fetch('/api/news?limit=20', { cache: 'no-store' }),
      ];

      // Portfolio news (only if user has holdings)
      if (portfolioSymbols.length > 0) {
        fetches.push(
          fetch(`/api/news?symbols=${encodeURIComponent(portfolioSymbols.join(','))}&limit=20`, { cache: 'no-store' })
        );
      }

      const results = await Promise.allSettled(fetches);

      const macroRes = results[0];
      if (macroRes.status === 'fulfilled' && macroRes.value.ok) {
        const data = await macroRes.value.json();
        setMacroArticles(data.articles || []);
      }

      if (results.length > 1 && results[1].status === 'fulfilled' && results[1].value.ok) {
        const data = await results[1].value.json();
        setPortfolioArticles(data.articles || []);
      } else {
        setPortfolioArticles([]);
      }
    } catch {
      setError('Failed to load news');
    } finally {
      setLoading(false);
    }
  }, [portfolioSymbols]);

  useEffect(() => { loadNews(); }, [loadNews]);

  // ─── Combined for filtering ────────────────────────────────
  const allArticles = useMemo(() => {
    const combined = [...macroArticles, ...portfolioArticles];
    // Deduplicate by headline
    const seen = new Set<string>();
    return combined.filter(a => {
      const key = a.headline.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [macroArticles, portfolioArticles]);

  const sections = useMemo(() => ({
    macro: macroArticles,
    portfolio: portfolioArticles,
    all: allArticles,
  }), [macroArticles, portfolioArticles, allArticles]);

  const activeArticles = useMemo(() => {
    let list = sections[sectionTab];

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

    // Sort by most recent
    return [...list].sort((a, b) => b.publishedAt - a.publishedAt);
  }, [sections, sectionTab, sentimentFilter, searchQuery]);

  // ─── Sentiment counts for current section ──────────────────
  const sentimentCounts = useMemo(() => {
    const list = sections[sectionTab];
    let pos = 0, neg = 0, neu = 0;
    list.forEach(a => {
      if (a.sentiment === 'positive') pos++;
      else if (a.sentiment === 'negative') neg++;
      else neu++;
    });
    return { pos, neg, neu };
  }, [sections, sectionTab]);

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
            {allArticles.length} articles · {macroArticles.length} macro · {portfolioArticles.length} portfolio
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

      {/* Section Tabs */}
      <div style={{ display: 'flex', borderRadius: 8, marginBottom: 12, overflow: 'hidden', border: '1px solid #334155' }}>
        {([
          { key: 'all' as SectionTab, label: 'All', icon: Newspaper, count: allArticles.length },
          { key: 'macro' as SectionTab, label: 'Market & Economy', icon: Globe, count: macroArticles.length, accent: '#22c55e' },
          { key: 'portfolio' as SectionTab, label: 'My Holdings', icon: Briefcase, count: portfolioArticles.length, accent: '#06b6d4' },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => { setSectionTab(tab.key); setSentimentFilter('all'); }}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '8px 6px', border: 'none', cursor: 'pointer',
              background: sectionTab === tab.key ? '#1e293b' : '#0f172a',
              borderBottom: sectionTab === tab.key ? `2px solid ${tab.accent || '#06b6d4'}` : '2px solid transparent',
              transition: 'background 0.15s, border-color 0.15s',
            }}
          >
            <tab.icon size={14} style={{ color: sectionTab === tab.key ? (tab.accent || '#06b6d4') : '#64748b' }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: sectionTab === tab.key ? (tab.accent || '#e2e8f0') : '#64748b' }}>{tab.label}</span>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: sectionTab === tab.key ? (tab.accent || '#e2e8f0') : '#64748b',
              fontVariantNumeric: 'tabular-nums',
            }}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Search bar */}
      {activeArticles.length > 0 && (
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
      )}

      {/* Filter panel */}
      {showFilters && (
        <div style={{
          padding: 12, marginBottom: 10, borderRadius: 10,
          background: '#1e293b', border: '1px solid #334155',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sentiment</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { key: 'all', label: 'All', count: sections[sectionTab].length },
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
      {!loading && activeArticles.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        }}>
          {sectionTab === 'portfolio' && portfolioSymbols.length === 0 ? (
            <>
              <Briefcase size={40} style={{ color: '#475569', marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No holdings found</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Add positions to your portfolio to see related news
              </div>
            </>
          ) : (
            <>
              <Newspaper size={40} style={{ color: '#475569', marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                {sectionTab === 'portfolio' ? 'No portfolio news yet' : 'No articles found'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {searchQuery ? 'Try a different search term' : 'Check back for new articles'}
              </div>
            </>
          )}
        </div>
      )}

      {/* Section headers with sentiment breakdown */}
      {!loading && activeArticles.length > 0 && sectionTab !== 'all' && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {sectionTab === 'macro'
              ? <Globe size={14} style={{ color: '#22c55e' }} />
              : <Briefcase size={14} style={{ color: '#06b6d4' }} />
            }
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: sectionTab === 'macro' ? '#22c55e' : '#06b6d4',
            }}>
              {sectionTab === 'macro' ? 'Market & Economy' : 'My Holdings'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              ({activeArticles.length}) ·
              {sentimentCounts.pos > 0 && <span style={{ color: '#22c55e' }}> {sentimentCounts.pos} bullish</span>}
              {sentimentCounts.neg > 0 && <span style={{ color: '#ef4444' }}> · {sentimentCounts.neg} bearish</span>}
              {sentimentCounts.neu > 0 && <span> · {sentimentCounts.neu} neutral</span>}
            </span>
          </div>
        </div>
      )}

      {/* Article list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {activeArticles.map(article => (
          <NewsCard
            key={article.id}
            article={article}
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
}: {
  article: Article;
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
                {article.symbols.slice(0, 4).map(sym => (
                  <span
                    key={sym}
                    style={{
                      padding: '1px 6px', borderRadius: 3,
                      background: '#0f172a',
                      color: '#06b6d4', fontSize: 10, fontWeight: 600,
                      fontFamily: 'monospace',
                    }}
                  >
                    ${sym}
                  </span>
                ))}
                {article.symbols.length > 4 && (
                  <span style={{ fontSize: 9, color: '#64748b' }}>+{article.symbols.length - 4}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </a>
  );
}
