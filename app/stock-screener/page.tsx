'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  ArrowLeft, Search, Plus, ChevronDown, ChevronUp,
  Filter, RefreshCcw, SlidersHorizontal, X,
} from 'lucide-react';
import { createWatchlist, getWatchlists, addStockToWatchlist } from '@/lib/supabase/watchlists';

// ─── Types ────────────────────────────────────────────────────
interface ScreenerResult {
  symbol: string;
  name: string;
  price: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  sector: string;
  week52High: number | null;
  week52Low: number | null;
  week52Change: number | null;
  exchange: string;
}

interface Filters {
  marketCap: string;
  peMin: string;
  peMax: string;
  dividendYieldMin: string;
  dividendYieldMax: string;
  sector: string;
}

type SortCol = 'symbol' | 'price' | 'peRatio' | 'dividendYield' | 'marketCap' | 'week52Change';
type SortDir = 'asc' | 'desc';

const SECTORS = [
  'Technology', 'Financial Services', 'Healthcare', 'Consumer',
  'Industrials', 'Energy', 'Utilities', 'Real Estate',
  'Materials', 'Media & Entertainment', 'ETF',
];

const MARKET_CAPS = [
  { value: '', label: 'Any' },
  { value: 'large', label: 'Large ($10B+)' },
  { value: 'mid', label: 'Mid ($2B-10B)' },
  { value: 'small', label: 'Small ($300M-$2B)' },
  { value: 'micro', label: 'Micro (<$300M)' },
];

// ─── Helpers ──────────────────────────────────────────────────
function fmtMcap(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}
function fmtPrice(n: number | null): string { return n != null ? `$${n.toFixed(2)}` : '—'; }
function fmtPE(n: number | null): string { return n != null ? n.toFixed(1) : '—'; }
function fmtDiv(n: number | null): string { return n != null ? `${n.toFixed(2)}%` : '—'; }
function fmtChange(n: number | null): { text: string; color: string } {
  if (n == null) return { text: '—', color: '#64748b' };
  const sign = n >= 0 ? '+' : '';
  return { text: `${sign}${n.toFixed(1)}%`, color: n >= 0 ? '#22c55e' : '#ef4444' };
}

// ─── Page ─────────────────────────────────────────────────────
export default function StockScreenerPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [searched, setSearched] = useState(false);

  // Filters
  const [filters, setFilters] = useState<Filters>({
    marketCap: '',
    peMin: '',
    peMax: '',
    dividendYieldMin: '',
    dividendYieldMax: '',
    sector: '',
  });
  const [showFilters, setShowFilters] = useState(true);

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>('marketCap');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Add-to-watchlist state
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);
  const [addStatus, setAddStatus] = useState<'idle' | 'added' | 'error'>('idle');
  const [statusSymbol, setStatusSymbol] = useState('');

  // ─── Submit screener ──────────────────────────────────────
  const handleScreen = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const body: any = {};
      if (filters.marketCap) body.marketCap = filters.marketCap;
      if (filters.peMin) body.peMin = parseFloat(filters.peMin);
      if (filters.peMax) body.peMax = parseFloat(filters.peMax);
      if (filters.dividendYieldMin) body.dividendYieldMin = parseFloat(filters.dividendYieldMin);
      if (filters.dividendYieldMax) body.dividendYieldMax = parseFloat(filters.dividendYieldMax);
      if (filters.sector) body.sector = filters.sector;

      const res = await fetch('/api/screener/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResults(data.results || []);
      setScanned(data.scanned || 0);
      if (data.error) setError(data.error);
    } catch {
      setError('Screener request failed');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // ─── Sort ─────────────────────────────────────────────────
  const sortedResults = useMemo(() => {
    const sorted = [...results];
    sorted.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
    return sorted;
  }, [results, sortCol, sortDir]);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ChevronDown size={10} style={{ color: '#475569', opacity: 0.3 }} />;
    return sortDir === 'asc' ? <ChevronUp size={10} style={{ color: '#06b6d4' }} /> : <ChevronDown size={10} style={{ color: '#06b6d4' }} />;
  };

  // ─── Add to watchlist ─────────────────────────────────────
  const handleAddToWatchlist = async (symbol: string) => {
    if (!user) return;
    setAddingSymbol(symbol);
    setAddStatus('idle');

    try {
      // Find or create a "Screener Picks" watchlist
      let lists = await getWatchlists(user.id);
      let target = lists.find(l => l.name === 'Screener Picks');
      if (!target) {
        const created = await createWatchlist({ userId: user.id, name: 'Screener Picks', description: 'From stock screener' });
        if (!created) throw new Error('Failed');
        target = created;
      }

      const result = await addStockToWatchlist(target.id, symbol);
      if (result) {
        setAddStatus('added');
        setStatusSymbol(symbol);
        setTimeout(() => setAddStatus('idle'), 2500);
      } else {
        setAddStatus('error');
        setTimeout(() => setAddStatus('idle'), 2500);
      }
    } catch {
      setAddStatus('error');
      setTimeout(() => setAddStatus('idle'), 2500);
    } finally {
      setAddingSymbol(null);
    }
  };

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
        Please sign in to use the stock screener.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 80px', minHeight: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Stock Screener</h1>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {searched ? `${results.length} results from ${scanned} scanned` : 'Set filters to find stocks'}
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
          <SlidersHorizontal size={13} /> Filters
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div style={{
          padding: 14, marginBottom: 12, borderRadius: 10,
          background: '#1e293b', border: '1px solid #334155',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {/* Market Cap */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Market Cap</label>
              <select
                value={filters.marketCap}
                onChange={(e) => setFilters(f => ({ ...f, marketCap: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: 12 }}
              >
                {MARKET_CAPS.map(mc => <option key={mc.value} value={mc.value}>{mc.label}</option>)}
              </select>
            </div>

            {/* Sector */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Sector</label>
              <select
                value={filters.sector}
                onChange={(e) => setFilters(f => ({ ...f, sector: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: 12 }}
              >
                <option value="">Any Sector</option>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* P/E Range */}
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>P/E Min</label>
              <input type="number" step="0.1" min="0" placeholder="0" value={filters.peMin}
                onChange={(e) => setFilters(f => ({ ...f, peMin: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: 12, outline: 'none' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>P/E Max</label>
              <input type="number" step="0.1" min="0" placeholder="∞" value={filters.peMax}
                onChange={(e) => setFilters(f => ({ ...f, peMax: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: 12, outline: 'none' }} />
            </div>

            {/* Div Yield Range */}
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Div Yield Min %</label>
              <input type="number" step="0.1" min="0" placeholder="0" value={filters.dividendYieldMin}
                onChange={(e) => setFilters(f => ({ ...f, dividendYieldMin: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: 12, outline: 'none' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Div Yield Max %</label>
              <input type="number" step="0.1" min="0" placeholder="∞" value={filters.dividendYieldMax}
                onChange={(e) => setFilters(f => ({ ...f, dividendYieldMax: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: 12, outline: 'none' }} />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleScreen} disabled={loading} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, background: '#06b6d4',
              color: '#0f172a', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? <RefreshCcw size={14} className="spin" /> : <Search size={14} />}
              {loading ? 'Scanning...' : 'Screen Stocks'}
            </button>
            <button onClick={() => setFilters({ marketCap: '', peMin: '', peMax: '', dividendYieldMin: '', dividendYieldMax: '', sector: '' })} style={{
              padding: '10px 16px', borderRadius: 8, background: 'transparent',
              color: 'var(--text-dim)', border: '1px solid #475569', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
        </div>
      )}

      {/* No search yet */}
      {!searched && !loading && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        }}>
          <Search size={40} style={{ color: '#475569', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Set your criteria</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Configure filters above and tap "Screen Stocks" to find matches
          </div>
        </div>
      )}

      {/* Empty results after search */}
      {searched && !loading && results.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '40px 20px',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        }}>
          <Filter size={36} style={{ color: '#475569', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No matches found</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Try broadening your filters. Scanned {scanned} stocks.</div>
        </div>
      )}

      {/* Results table */}
      {results.length > 0 && (
        <div style={{ overflow: 'auto' }}>
          <table className="screener-table">
            <thead>
              <tr>
                <Th onClick={() => toggleSort('symbol')}><SortIcon col="symbol" /> Symbol</Th>
                <Th onClick={() => toggleSort('price')}><SortIcon col="price" /> Price</Th>
                <Th onClick={() => toggleSort('peRatio')}><SortIcon col="peRatio" /> P/E</Th>
                <Th onClick={() => toggleSort('dividendYield')}><SortIcon col="dividendYield" /> Div Yield</Th>
                <Th onClick={() => toggleSort('marketCap')}><SortIcon col="marketCap" /> Market Cap</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map(r => {
                const chg = fmtChange(r.week52Change);
                const adding = addingSymbol === r.symbol;
                const justAdded = addStatus === 'added' && statusSymbol === r.symbol;
                return (
                  <tr key={r.symbol} className="sc-row">
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', letterSpacing: '-0.3px' }}>{r.symbol}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{r.sector}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(r.price)}</div>
                      {r.week52Change != null && (
                        <div style={{ fontSize: 10, color: chg.color, fontWeight: 600 }}>{chg.text} (52w)</div>
                      )}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtPE(r.peRatio)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.dividendYield && r.dividendYield > 0 ? '#22c55e' : 'var(--text-dim)' }}>
                      {fmtDiv(r.dividendYield)}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtMcap(r.marketCap)}</td>
                    <td>
                      <button
                        onClick={() => handleAddToWatchlist(r.symbol)}
                        disabled={adding || justAdded}
                        className="add-btn"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 6,
                          background: justAdded ? 'rgba(34,197,94,0.15)' : '#0f172a',
                          border: justAdded ? '1px solid rgba(34,197,94,0.3)' : '1px solid #334155',
                          color: justAdded ? '#22c55e' : 'var(--text-dim)',
                          fontSize: 10, fontWeight: 600, cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          opacity: adding ? 0.5 : 1,
                        }}
                      >
                        {adding ? <RefreshCcw size={10} className="spin" /> : justAdded ? '✓' : <Plus size={10} />}
                        {justAdded ? 'Added' : 'Watch'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add status toast */}
      {addStatus === 'error' && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 200, padding: '8px 18px', borderRadius: 20, background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 600 }}>Failed to add</div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .screener-table { width: 100%; border-collapse: collapse; }
        .screener-table thead tr { border-bottom: 1px solid #334155; }
        .screener-table th {
          padding: 8px 10px; text-align: left; font-size: 9px; font-weight: 700;
          color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;
          white-space: nowrap; cursor: pointer; user-select: none;
        }
        .screener-table th:hover { color: var(--text-dim); }
        .screener-table td { padding: 10px; border-bottom: 1px solid #1e293b; }
        .sc-row { background: #0f172a; transition: background 0.1s; }
        .sc-row:hover { background: #1a2332; }
        .add-btn:hover { background: #1e293b !important; color: #e2e8f0 !important; }
      `}</style>
    </div>
  );
}

// ─── Table Header ─────────────────────────────────────────────
function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <th onClick={onClick} style={onClick ? undefined : { cursor: 'default' }}>{children}</th>;
}
