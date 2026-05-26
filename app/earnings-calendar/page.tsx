'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePortfolio } from '@/hooks/usePortfolio';
import {
  ArrowLeft, Calendar, List, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus, Clock, RefreshCcw,
  Search, X, ExternalLink, FileText,
} from 'lucide-react';
import type { EarningsEvent } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatCurrency(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

type ResultStatus = 'beat' | 'miss' | 'inline' | 'upcoming' | 'no-data';

function getStatus(e: EarningsEvent): ResultStatus {
  if (e.epsActual == null) return 'upcoming';
  if (e.epsEstimate == null) return 'no-data';
  const diff = e.epsActual - e.epsEstimate;
  if (Math.abs(diff) < 0.01) return 'inline';
  return diff > 0 ? 'beat' : 'miss';
}

const STATUS_STYLE: Record<ResultStatus, { bg: string; color: string; label: string; icon: typeof TrendingUp }> = {
  beat:    { bg: 'rgba(34,197,94,0.1)',  color: '#22c55e', label: 'Beat',   icon: TrendingUp },
  miss:    { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444', label: 'Miss',   icon: TrendingDown },
  inline:  { bg: 'rgba(250,204,21,0.1)',  color: '#facc15', label: 'Inline', icon: Minus },
  upcoming:{ bg: 'rgba(6,182,212,0.1)',   color: '#06b6d4', label: 'Upcoming', icon: Clock },
  'no-data': { bg: 'rgba(100,116,139,0.08)', color: '#64748b', label: 'No Data', icon: Minus },
};

function edgarUrl(symbol: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?CIK=${symbol}&action=getcompany`;
}

function marketBeatUrl(symbol: string): string {
  return `https://www.marketbeat.com/stocks/NASDAQ/${symbol}/earnings/`;
}

// ─── Error Boundary ──────────────────────────────────────────
class EarningsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[EarningsCalendar] Crash:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100dvh', overflowY: 'auto', padding: '40px 20px 120px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            textAlign: 'center', padding: '32px 24px', borderRadius: 12,
            background: '#1e293b', border: '1px solid #334155', maxWidth: 380,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#ef4444' }}>
              Something went wrong
            </div>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', marginBottom: 16,
              padding: '8px 12px', background: '#0f172a', borderRadius: 6,
              fontFamily: 'monospace', wordBreak: 'break-all',
            }}>
              {this.state.errorMsg}
            </div>
            <button
              onClick={() => this.setState({ hasError: false, errorMsg: '' })}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: '#06b6d4', color: '#0f172a', fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Page ─────────────────────────────────────────────────────
function EarningsCalendarPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { account } = usePortfolio();
  const router = useRouter();
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [view, setView] = useState<'calendar' | 'list'>('list');
  const [statusFilter, setStatusFilter] = useState<ResultStatus | 'all'>('all');
  const [holdingsOnly, setHoldingsOnly] = useState(false);

  // Search / autocomplete
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<Array<{ symbol: string; name?: string; price?: number }>>([]);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const searchTimer = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Calendar navigation
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  // Date range for calendar view
  const todayStr = new Date().toISOString().split('T')[0];
  const future = new Date(); future.setMonth(future.getMonth() + 3);
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(future.toISOString().split('T')[0]);

  // Holdings symbols for filtering
  const holdingSymbols = useMemo(() => {
    return new Set((account?.positions || []).map(p => p.symbol?.toUpperCase() || '').filter(Boolean));
  }, [account?.positions]);

  // ─── Load earnings ─────────────────────────────────────────
  const loadEarnings = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = query
        ? `/api/earnings?q=${encodeURIComponent(query)}&days=90`
        : '/api/earnings?days=90';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setEarnings(data.earnings || []);
    } catch {
      setError('Failed to load earnings data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEarnings(); }, [loadEarnings]);

  // ─── Symbol search autocomplete (for earnings symbols) ─────
  const fetchSearchSuggestions = useCallback(async (q: string) => {
    if (!q || q.length < 1) { setSearchSuggestions([]); setShowSearchSuggestions(false); return; }
    try {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(q.toUpperCase())}`);
      if (res.ok) {
        const data = await res.json();
        setSearchSuggestions((data.results || []).slice(0, 8));
        setShowSearchSuggestions(true);
      }
    } catch { /* ignore */ }
  }, []);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSearchSuggestions(val), 200);
  };

  const selectSearchSymbol = async (sym: string) => {
    setSearchQuery(sym);
    setShowSearchSuggestions(false);
    await loadEarnings(sym);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setShowSearchSuggestions(false);
    loadEarnings();
  };

  // ─── Derived data ──────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = statusFilter === 'all' ? earnings : earnings.filter(e => getStatus(e) === statusFilter);
    if (holdingsOnly && holdingSymbols.size > 0) {
      data = data.filter(e => holdingSymbols.has(e.symbol.toUpperCase()));
    }
    if (view === 'calendar') {
      data = data.filter(e => e.date >= dateFrom && e.date <= dateTo);
    }
    return data;
  }, [earnings, statusFilter, holdingsOnly, holdingSymbols, view, dateFrom, dateTo]);

  const earningsByDate = useMemo(() => {
    const map: Record<string, EarningsEvent[]> = {};
    earnings.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }, [earnings]);

  const calGrid = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startDow = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const weeks: (number | null)[][] = [];
    let day = 1;
    for (let w = 0; w < 6 && day <= totalDays; w++) {
      const week: (number | null)[] = [];
      for (let d = 0; d < 7; d++) {
        if ((w === 0 && d < startDow) || day > totalDays) week.push(null);
        else week.push(day++);
      }
      weeks.push(week);
    }
    return weeks;
  }, [calYear, calMonth]);

  const today = new Date().toISOString().split('T')[0];

  function dateKey(day: number): string {
    const m = String(calMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${calYear}-${m}-${d}`;
  }

  const MONTH_START = dateKey(1).slice(0, 7);

  // Stats
  const upcomingCount = earnings.filter(e => getStatus(e) === 'upcoming').length;
  const beatCount = earnings.filter(e => getStatus(e) === 'beat').length;
  const missCount = earnings.filter(e => getStatus(e) === 'miss').length;
  const holdingsEarnings = holdingSymbols.size > 0
    ? earnings.filter(e => holdingSymbols.has(e.symbol.toUpperCase()) && getStatus(e) === 'upcoming').length
    : 0;

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
        Please sign in to view the earnings calendar.
      </div>
    );
  }

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', padding: '12px 16px 120px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Earnings Calendar</h1>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {upcomingCount} upcoming · {beatCount} beats · {missCount} misses
            {holdingsEarnings > 0 && ` · ${holdingsEarnings} in your holdings`}
            {' · Source: Finnhub + SEC EDGAR'}
          </div>
        </div>
        <button
          onClick={() => { clearSearch(); loadEarnings(); }}
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

      {/* Search + Autocomplete */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '0 10px',
        }}>
          <Search size={14} style={{ color: '#64748b', flexShrink: 0 }} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { selectSearchSymbol(searchQuery.toUpperCase()); }
              else if (e.key === 'Escape') clearSearch();
            }}
            onFocus={() => { if (searchSuggestions.length > 0) setShowSearchSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSearchSuggestions(false), 150)}
            placeholder="Search by symbol (e.g. AAPL, MSFT)..."
            style={{
              flex: 1, padding: '9px 0', background: 'none', border: 'none',
              color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace', outline: 'none',
            }}
          />
          {searchQuery && (
            <button onClick={clearSearch} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 2 }}>
              <X size={14} />
            </button>
          )}
        </div>
        {showSearchSuggestions && searchSuggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            maxHeight: 200, overflowY: 'auto', marginTop: 2,
          }}>
            {searchSuggestions.map((s, i) => (
              <div
                key={s.symbol}
                onMouseDown={() => selectSearchSymbol(s.symbol)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderBottom: i < searchSuggestions.length - 1 ? '1px solid #1e293b' : 'none',
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{s.symbol}</span>
                  <span style={{ fontSize: 10, color: '#64748b', marginLeft: 8 }}>
                    {s.name?.substring(0, 35)}{(s.name?.length || 0) > 35 ? '…' : ''}
                  </span>
                </div>
                {s.price != null && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#06b6d4' }}>
                    ${s.price.toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View toggle + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
          <button
            onClick={() => setView('calendar')}
            style={{
              padding: '6px 12px', border: 'none',
              background: view === 'calendar' ? '#06b6d4' : '#1e293b',
              color: view === 'calendar' ? '#0f172a' : 'var(--text-dim)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Calendar size={13} /> Calendar
          </button>
          <button
            onClick={() => setView('list')}
            style={{
              padding: '6px 12px', border: 'none',
              background: view === 'list' ? '#06b6d4' : '#1e293b',
              color: view === 'list' ? '#0f172a' : 'var(--text-dim)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <List size={13} /> List
          </button>
        </div>

        {/* Holdings-only toggle */}
        {holdingSymbols.size > 0 && (
          <button
            onClick={() => setHoldingsOnly(!holdingsOnly)}
            style={{
              padding: '5px 10px', borderRadius: 6,
              background: holdingsOnly ? '#06b6d4' : '#1e293b',
              color: holdingsOnly ? '#0f172a' : 'var(--text-dim)',
              border: '1px solid transparent', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {holdingsOnly ? '✓ Holdings' : 'My Holdings'}
          </button>
        )}

        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { key: 'all', label: 'All' },
            { key: 'upcoming', label: 'Upcoming' },
            { key: 'beat', label: 'Beat' },
            { key: 'miss', label: 'Miss' },
          ] as { key: ResultStatus | 'all'; label: string }[]).map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              style={{
                padding: '5px 10px', borderRadius: 6,
                background: statusFilter === s.key ? '#06b6d4' : '#1e293b',
                color: statusFilter === s.key ? '#0f172a' : 'var(--text-dim)',
                border: '1px solid transparent', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={() => loadEarnings()} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          Loading earnings data...
        </div>
      )}

      {/* ── Calendar View ────────────────────────────────────── */}
      {!loading && view === 'calendar' && (
        <div>
          {/* Date range selection */}
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 10,
            background: '#1e293b', border: '1px solid #334155',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Calendar size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{
                flex: 1, padding: '5px 6px', borderRadius: 6,
                background: '#0f172a', border: '1px solid #334155',
                color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit',
              }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{
                flex: 1, padding: '5px 6px', borderRadius: 6,
                background: '#0f172a', border: '1px solid #334155',
                color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button
              onClick={() => calMonth === 0 ? (setCalMonth(11), setCalYear(calYear - 1)) : setCalMonth(calMonth - 1)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
            >
              <ChevronLeft size={18} />
            </button>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{MONTHS[calMonth]} {calYear}</div>
            <button
              onClick={() => calMonth === 11 ? (setCalMonth(0), setCalYear(calYear + 1)) : setCalMonth(calMonth + 1)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #334155' }}>
              {DAYS_SHORT.map(d => (
                <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>{d}</div>
              ))}
            </div>
            {calGrid.map((week, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: wi < calGrid.length - 1 ? '1px solid #1e293b' : 'none' }}>
                {week.map((day, di) => {
                  if (day == null) return <div key={di} style={{ aspectRatio: '1', background: '#0f172a' }} />;
                  const dk = dateKey(day);
                  const events = earningsByDate[dk] || [];
                  const isToday = dk === today;

                  return (
                    <div
                      key={di}
                      style={{
                        aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        background: isToday ? 'rgba(6,182,212,0.06)' : '#0f172a',
                        border: isToday ? '1px solid rgba(6,182,212,0.3)' : '1px solid transparent',
                        borderRadius: isToday ? 4 : 0, padding: 2,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? '#06b6d4' : 'var(--text-dim)' }}>
                        {day}
                      </span>
                      {events.length > 0 && (
                        <div style={{ display: 'flex', gap: 2, marginTop: 1 }}>
                          {events.slice(0, 3).map((e, i) => (
                            <div key={i} style={{
                              width: 4, height: 4, borderRadius: '50%',
                              background: getStatus(e) === 'beat' ? '#22c55e' : getStatus(e) === 'miss' ? '#ef4444' : '#06b6d4',
                            }}/>
                          ))}
                          {events.length > 3 && <span style={{ fontSize: 7, color: 'var(--text-muted)', lineHeight: 1 }}>+{events.length - 3}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Date range earnings list */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Earnings ({dateFrom} – {dateTo})</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{filtered.length} reports</span>
            </div>
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, fontSize: 12, color: 'var(--text-muted)', background: '#1e293b', border: '1px solid #334155', borderRadius: 10 }}>
                {holdingsOnly
                  ? 'No earnings found for your holdings in this date range.'
                  : 'No earnings found for this date range.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.slice(0, 50).map(e => (
                  <EarningsRow key={`${e.symbol}-${e.date}-${e.quarter}`} event={e} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── List View ─────────────────────────────────────────── */}
      {!loading && view === 'list' && (
        <div>
          {filtered.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '60px 20px',
              background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
            }}>
              <Calendar size={40} style={{ color: '#475569', marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No earnings found</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Try changing filters or search for a symbol</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.slice(0, 200).map(e => (
                <EarningsRow key={`${e.symbol}-${e.date}-${e.quarter}`} event={e} />
              ))}
              {filtered.length > 200 && (
                <div style={{ textAlign: 'center', padding: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  Showing 200 of {filtered.length} results. Use search to narrow down.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

// ─── Earnings Row Component ───────────────────────────────────
function EarningsRow({ event }: { event: EarningsEvent }) {
  const status = getStatus(event);
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  const surprise = event.epsEstimate != null && event.epsActual != null && event.epsEstimate !== 0
    ? (((event.epsActual - event.epsEstimate) / Math.abs(event.epsEstimate)) * 100)
    : null;

  return (
    <div
      style={{
        background: s.bg, border: `1px solid ${status === 'upcoming' ? 'rgba(6,182,212,0.15)' : '#334155'}`,
        borderRadius: 10, padding: '12px',
      }}
    >
      {/* Top row: symbol, status, links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
          background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={13} style={{ color: s.color }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
              {event.symbol}
            </span>
            <span style={{ padding: '1px 6px', borderRadius: 4, background: s.bg, color: s.color, fontSize: 9, fontWeight: 700 }}>
              {s.label}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Q{event.quarter} {event.year}
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
            {new Date(event.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {event.hour !== 'unknown' && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' · '}{event.hour === 'bmo' ? 'Before open' : 'After close'}
              </span>
            )}
          </div>
        </div>
        {/* External links */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <a href={edgarUrl(event.symbol)} target="_blank" rel="noopener"
            style={{ color: '#64748b', fontSize: 10, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}
            title="SEC EDGAR filings"
          >
            <FileText size={10} /> SEC
          </a>
          <a href={marketBeatUrl(event.symbol)} target="_blank" rel="noopener"
            style={{ color: '#64748b', fontSize: 10, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}
            title="MarketBeat earnings"
          >
            <ExternalLink size={10} /> MB
          </a>
        </div>
      </div>

      {/* EPS Comparison */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11 }}>
        {/* Consensus Estimate */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>Consensus EPS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 600, color: event.epsEstimate != null ? '#94a3b8' : 'var(--text-muted)' }}>
              {formatCurrency(event.epsEstimate)}
            </span>
            <span style={{ fontSize: 9, color: '#475569' }}>Finnhub</span>
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: '#334155', flexShrink: 0 }} />

        {/* Actual EPS */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>Actual EPS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              fontWeight: 600,
              color: event.epsActual != null
                ? (event.epsEstimate != null
                  ? (event.epsActual > event.epsEstimate ? '#22c55e' : event.epsActual < event.epsEstimate ? '#ef4444' : '#e2e8f0')
                  : '#e2e8f0')
                : 'var(--text-muted)',
            }}>
              {formatCurrency(event.epsActual)}
            </span>
            {surprise != null && (
              <span style={{ color: surprise >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 10 }}>
                {surprise >= 0 ? '+' : ''}{surprise.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: '#334155', flexShrink: 0 }} />

        {/* Surprise */}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>Surprise</div>
          <div style={{ color: surprise != null ? (surprise > 0 ? '#22c55e' : '#ef4444') : 'var(--text-muted)', fontWeight: 600 }}>
            {surprise != null ? `${surprise > 0 ? '▲' : '▼'} ${Math.abs(surprise).toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Revenue (if available) */}
      {(event.revenueEstimate != null || event.revenueActual != null) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(51,65,85,0.4)', fontSize: 10, display: 'flex', gap: 8 }}>
          {event.revenueEstimate != null && (
            <span style={{ color: 'var(--text-muted)' }}>Rev est: <strong style={{ color: '#94a3b8' }}>${(event.revenueEstimate / 1e9).toFixed(2)}B</strong></span>
          )}
          {event.revenueActual != null && (
            <span style={{ color: 'var(--text-muted)' }}>Rev actual: <strong style={{ color: '#94a3b8' }}>${(event.revenueActual / 1e9).toFixed(2)}B</strong></span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Default export wrapped in error boundary ────────────────
export default function EarningsCalendarPageWrapper() {
  return (
    <EarningsErrorBoundary>
      <EarningsCalendarPage />
    </EarningsErrorBoundary>
  );
}
