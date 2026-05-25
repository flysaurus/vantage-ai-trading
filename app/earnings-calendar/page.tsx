'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  ArrowLeft, Calendar, List, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus, Clock, Filter, RefreshCcw,
} from 'lucide-react';
import type { EarningsEvent } from '@/app/api/earnings/route';

// ─── Helpers ──────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatCurrency(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

function formatRevenue(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

type ResultStatus = 'beat' | 'miss' | 'inline' | 'upcoming' | 'no-report';

function getStatus(e: EarningsEvent): ResultStatus {
  if (e.epsActual == null) return 'upcoming';
  if (e.epsEstimate == null) return 'no-report';
  const diff = e.epsActual - e.epsEstimate;
  if (Math.abs(diff) < 0.01) return 'inline';
  return diff > 0 ? 'beat' : 'miss';
}

const STATUS_STYLE: Record<ResultStatus, { bg: string; color: string; label: string; icon: typeof TrendingUp }> = {
  beat:    { bg: 'rgba(34,197,94,0.1)',  color: '#22c55e', label: 'Beat',   icon: TrendingUp },
  miss:    { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444', label: 'Miss',   icon: TrendingDown },
  inline:  { bg: 'rgba(250,204,21,0.1)',  color: '#facc15', label: 'Inline', icon: Minus },
  upcoming:{ bg: 'rgba(6,182,212,0.1)',   color: '#06b6d4', label: 'Upcoming', icon: Clock },
  'no-report': { bg: 'rgba(100,116,139,0.08)', color: '#64748b', label: 'No Data', icon: Minus },
};

// ─── Page ─────────────────────────────────────────────────────
export default function EarningsCalendarPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [statusFilter, setStatusFilter] = useState<ResultStatus | 'all'>('all');
  const [filterMode, setFilterMode] = useState<'all' | 'my-stocks'>('all');

  // Calendar navigation
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-indexed

  // ─── Load earnings ─────────────────────────────────────────
  const loadEarnings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filterMode === 'my-stocks' && user
        ? `/api/earnings?symbols=portfolio&days=90`
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
  }, [filterMode, user]);

  useEffect(() => { loadEarnings(); }, [loadEarnings]);

  // ─── Derived data ──────────────────────────────────────────
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return earnings;
    return earnings.filter(e => getStatus(e) === statusFilter);
  }, [earnings, statusFilter]);

  // Earnings grouped by date for calendar
  const earningsByDate = useMemo(() => {
    const map: Record<string, EarningsEvent[]> = {};
    earnings.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }, [earnings]);

  // Calendar grid
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
        if ((w === 0 && d < startDow) || day > totalDays) {
          week.push(null);
        } else {
          week.push(day++);
        }
      }
      weeks.push(week);
      if (day > totalDays) break;
    }
    return weeks;
  }, [calYear, calMonth]);

  const today = new Date().toISOString().split('T')[0];

  function dateKey(day: number): string {
    const m = String(calMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${calYear}-${m}-${d}`;
  }

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

  // Stats
  const upcomingCount = earnings.filter(e => getStatus(e) === 'upcoming').length;
  const beatCount = earnings.filter(e => getStatus(e) === 'beat').length;
  const missCount = earnings.filter(e => getStatus(e) === 'miss').length;

  return (
    <div style={{ padding: '12px 16px 80px', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Earnings Calendar</h1>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {upcomingCount} upcoming · {beatCount} beats · {missCount} misses
          </div>
        </div>
        <button
          onClick={loadEarnings}
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

      {/* View toggle + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* Calendar/List toggle */}
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

        {/* Status filter pills */}
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
                border: '1px solid transparent',
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={loadEarnings} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          Loading earnings data...
        </div>
      )}

      {/* Calendar view */}
      {!loading && view === 'calendar' && (
        <div>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
            <button
              onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(calMonth - 1); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
            >
              <ChevronLeft size={18} />
            </button>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {MONTHS[calMonth]} {calYear}
            </div>
            <button
              onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(calMonth + 1); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Calendar grid */}
          <div style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #334155' }}>
              {DAYS_SHORT.map(d => (
                <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {calGrid.map((week, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: wi < calGrid.length - 1 ? '1px solid #1e293b' : 'none' }}>
                {week.map((day, di) => {
                  if (day == null) {
                    return <div key={di} style={{ aspectRatio: '1', background: '#0f172a' }} />;
                  }
                  const dk = dateKey(day);
                  const events = earningsByDate[dk] || [];
                  const isToday = dk === today;
                  const hasBeat = events.some(e => getStatus(e) === 'beat');
                  const hasMiss = events.some(e => getStatus(e) === 'miss');
                  const hasUpcoming = events.some(e => getStatus(e) === 'upcoming');
                  const dotColor = hasBeat ? '#22c55e' : hasMiss ? '#ef4444' : hasUpcoming ? '#06b6d4' : 'transparent';

                  return (
                    <div
                      key={di}
                      className="cal-cell"
                      style={{
                        aspectRatio: '1',
                        background: isToday ? 'rgba(6,182,212,0.06)' : '#0f172a',
                        border: isToday ? '1px solid rgba(6,182,212,0.3)' : '1px solid transparent',
                        borderRadius: isToday ? 4 : 0,
                        padding: 4,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        cursor: events.length > 0 ? 'pointer' : 'default',
                        position: 'relative',
                      }}
                      title={events.map(e => `${e.symbol} ${getStatus(e).toUpperCase()}`).join('\n')}
                    >
                      <span style={{
                        fontSize: 11, fontWeight: isToday ? 700 : 500,
                        color: isToday ? '#06b6d4' : 'var(--text-dim)',
                      }}>
                        {day}
                      </span>
                      {events.length > 0 && (
                        <div style={{ display: 'flex', gap: 2, marginTop: 1 }}>
                          {events.slice(0, 3).map((e, i) => (
                            <div
                              key={i}
                              style={{
                                width: 5, height: 5, borderRadius: '50%',
                                background: getStatus(e) === 'beat' ? '#22c55e' :
                                  getStatus(e) === 'miss' ? '#ef4444' :
                                  getStatus(e) === 'upcoming' ? '#06b6d4' : '#64748b',
                              }}
                            />
                          ))}
                          {events.length > 3 && (
                            <span style={{ fontSize: 7, color: 'var(--text-muted)', lineHeight: 1 }}>+{events.length - 3}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Earnings list for this month */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
              {MONTHS[calMonth]} {calYear} Earnings
            </div>
            {filtered.filter(e => e.date.startsWith(dateKey(1).slice(0, 7))).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, fontSize: 12, color: 'var(--text-muted)', background: '#1e293b', border: '1px solid #334155', borderRadius: 10 }}>
                No earnings reported for this month.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered
                  .filter(e => e.date.startsWith(dateKey(1).slice(0, 7)))
                  .map(e => <EarningsRow key={`${e.symbol}-${e.date}-${e.quarter}`} event={e} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* List view */}
      {!loading && view === 'list' && (
        <div>
          {filtered.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '60px 20px',
              background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
            }}>
              <Calendar size={40} style={{ color: '#475569', marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No earnings found</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Try changing filters or date range</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(e => <EarningsRow key={`${e.symbol}-${e.date}-${e.quarter}`} event={e} />)}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .cal-cell:hover { background: #1e293b !important; }
      `}</style>
    </div>
  );
}

// ─── Earnings Row Component ───────────────────────────────────
function EarningsRow({ event }: { event: EarningsEvent }) {
  const status = getStatus(event);
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  const surprise = event.epsEstimate != null && event.epsActual != null
    ? (((event.epsActual - event.epsEstimate) / Math.abs(event.epsEstimate)) * 100)
    : null;

  return (
    <div
      className="earnings-row"
      style={{
        background: s.bg, border: `1px solid ${status === 'upcoming' ? 'rgba(6,182,212,0.15)' : '#334155'}`,
        borderRadius: 10, padding: '10px 12px',
        opacity: status === 'no-report' ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status icon */}
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={14} style={{ color: s.color }} />
        </div>

        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
              {event.symbol}
            </span>
            <span style={{
              padding: '1px 6px', borderRadius: 4,
              background: s.bg, color: s.color,
              fontSize: 9, fontWeight: 700,
            }}>
              {s.label}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Q{event.quarter} {event.year}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            {new Date(event.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {event.hour !== 'unknown' && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' · '}{event.hour === 'bmo' ? 'Before open' : 'After close'}
              </span>
            )}
          </div>
        </div>

        {/* EPS detail */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: 'var(--text-dim)' }}>EPS </span>
            <span style={{ color: event.epsActual != null ? '#e2e8f0' : 'var(--text-muted)' }}>
              {formatCurrency(event.epsActual)}
            </span>
            {event.epsEstimate != null && (
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                {' vs '}{formatCurrency(event.epsEstimate)}
              </span>
            )}
          </div>
          {surprise != null && (
            <div style={{
              fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: surprise >= 0 ? '#22c55e' : '#ef4444',
            }}>
              {surprise >= 0 ? '+' : ''}{surprise.toFixed(1)}%
              {surprise >= 0 ? ' ▲' : ' ▼'}
            </div>
          )}
          {event.revenueActual != null && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
              Rev {formatRevenue(event.revenueActual)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
