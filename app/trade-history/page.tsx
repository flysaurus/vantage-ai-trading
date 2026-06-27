'use client';

import { apiPost } from '@/lib/api-client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { BrokerProvider, useBroker } from '@/components/providers/BrokerProvider';
import { getDemoOrders } from '@/lib/demo-data';
import { getTrades, type Trade } from '@/lib/supabase/trades';
import type { Order, InvestorStyle } from '@/types';
import {
  ArrowLeft, TrendingUp, TrendingDown, BarChart3, DollarSign,
  Activity, ChevronDown, ChevronUp, RefreshCcw, X,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────
type SortCol = 'executedAt' | 'symbol' | 'action' | 'quantity' | 'price' | 'totalValue';
type SortDir = 'asc' | 'desc';

function fmtCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}
function fmtLargeCurrency(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── P&L calculation per symbol (average cost basis) ──────────
function computePnL(trades: Trade[]): Map<string, { avgCost: number; totalPnL: number; sellCount: number; buyCount: number; totalBuyQty: number; totalBuyValue: number }> {
  const map = new Map<string, { buys: { quantity: number; total: number }[] }>();

  for (const t of trades) {
    if (!map.has(t.symbol)) map.set(t.symbol, { buys: [] });
    const entry = map.get(t.symbol)!;
    if (t.action === 'buy') {
      entry.buys.push({ quantity: t.quantity, total: t.totalValue });
    }
  }

  const result = new Map<string, any>();
  for (const [sym, entry] of map) {
    const totalQty = entry.buys.reduce((s, b) => s + b.quantity, 0);
    const totalValue = entry.buys.reduce((s, b) => s + b.total, 0);
    const avgCost = totalQty > 0 ? totalValue / totalQty : 0;

    let totalPnL = 0;
    let sellCount = 0;
    for (const t of trades) {
      if (t.symbol === sym && t.action === 'sell') {
        totalPnL += (t.price - avgCost) * t.quantity;
        sellCount++;
      }
    }

    result.set(sym, {
      avgCost,
      totalPnL,
      sellCount,
      buyCount: entry.buys.length,
      totalBuyQty: totalQty,
      totalBuyValue: totalValue,
    });
  }
  return result;
}

// ─── Convert demo Order → Trade ──────────────────────────────
function orderToTrade(o: Order): Trade {
  return {
    id: o.id,
    symbol: o.symbol,
    action: o.side as 'buy' | 'sell',
    quantity: o.filledQty ?? o.qty,
    price: o.filledPrice ?? 0,
    totalValue: o.totalValue ?? 0,
    commission: null,
    notes: null,
    executedAt: o.createdAt,
    createdAt: o.createdAt,
  };
}

// ─── Inner Page (needs BrokerProvider context) ────────────────
function TradeHistoryPageInner() {
  const { user, isLoading: authLoading } = useAuth();
  const { isConnected, isInitialized } = useBroker();
  const router = useRouter();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [symbolFilter, setSymbolFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Sort & Pagination
  const [sortCol, setSortCol] = useState<SortCol>('executedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  // ─── Load trades: demo when no broker, real from Alpaca+DB otherwise ──
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const syncThenLoad = useCallback(async () => {
    if (!user) return;
    // Wait for broker status check to complete before deciding demo vs live
    if (!isInitialized) return;
    setLoading(true);
    setError(null);

    // If no broker connected, use demo orders
    if (!isConnected) {
      try {
        const style = (user.investorStyle || 'buffett') as InvestorStyle;
        const demoOrders = getDemoOrders(style);
        const demoTrades = demoOrders.map(orderToTrade);
        setTrades(demoTrades);
        setTotal(demoTrades.length);
        setIsDemo(true);
        setSyncStatus('Demo mode · Connect a broker for real trades');
      } catch {
        setError('Failed to load demo trade history');
      } finally {
        setLoading(false);
      }
      return;
    }

    setIsDemo(false);
    try {
      // 1. Sync filled orders from Alpaca to trade_history
      const token = (await import("@/lib/auth")).getAccessToken();
      const syncRes = await await apiPost('/api/db/trade-history/sync', JSON.stringify({ userId: user.id, limit: 100 }));
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        setSyncStatus(syncData.message || `Synced ${syncData.synced || 0} trades`);
      }

      // 2. Load trades from DB
      const data = await getTrades(user.id, 500, 0);
      setTrades(data.trades || []);
      setTotal(data.total || 0);
    } catch {
      setError('Failed to load trade history');
    } finally {
      setLoading(false);
    }
  }, [user, isConnected, isInitialized]);

  useEffect(() => { syncThenLoad(); }, [syncThenLoad]);

  // ─── P&L Stats ────────────────────────────────────────────
  const pnlMap = useMemo(() => computePnL(trades), [trades]);

  const stats = useMemo(() => {
    const buys = trades.filter(t => t.action === 'buy');
    const sells = trades.filter(t => t.action === 'sell');
    const totalBuyValue = buys.reduce((s, t) => s + t.totalValue, 0);
    const totalSellValue = sells.reduce((s, t) => s + t.totalValue, 0);
    const totalPnL = Array.from(pnlMap.values()).reduce((s, v) => s + v.totalPnL, 0);

    // Count wins/losses
    let wins = 0, losses = 0, largestWin = 0, largestLoss = 0;
    for (const [, v] of pnlMap) {
      if (v.totalPnL > 0) { wins++; largestWin = Math.max(largestWin, v.totalPnL); }
      else if (v.totalPnL < 0) { losses++; largestLoss = Math.min(largestLoss, v.totalPnL); }
    }

    return {
      totalTrades: trades.length,
      buyCount: buys.length,
      sellCount: sells.length,
      totalBuyValue,
      totalSellValue,
      totalVolume: buys.reduce((s, t) => s + t.quantity, 0) + sells.reduce((s, t) => s + t.quantity, 0),
      totalPnL,
      wins,
      losses,
      winRate: (wins + losses) > 0 ? ((wins / (wins + losses)) * 100) : 0,
      largestWin,
      largestLoss,
      avgPnLPerSymbol: (wins + losses) > 0 ? totalPnL / (wins + losses) : 0,
      uniqueSymbols: new Set(trades.map(t => t.symbol)).size,
    };
  }, [trades, pnlMap]);

  // ─── Filtered & sorted ────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...trades];

    if (actionFilter !== 'all') list = list.filter(t => t.action === actionFilter);
    if (symbolFilter.trim()) {
      const sym = symbolFilter.trim().toUpperCase();
      list = list.filter(t => t.symbol.includes(sym));
    }
    if (dateFrom) list = list.filter(t => t.executedAt >= dateFrom);
    if (dateTo) list = list.filter(t => t.executedAt <= dateTo + 'T23:59:59');

    list.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    return list;
  }, [trades, actionFilter, symbolFilter, dateFrom, dateTo, sortCol, sortDir]);

  const paged = useMemo(() => {
    return filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [filtered, page]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ChevronDown size={10} style={{ color: '#475569', opacity: 0.3 }} />;
    return sortDir === 'asc' ? <ChevronUp size={10} style={{ color: '#06b6d4' }} /> : <ChevronDown size={10} style={{ color: '#06b6d4' }} />;
  };

  const availableSymbols = useMemo(() => {
    return [...new Set(trades.map(t => t.symbol))].sort();
  }, [trades]);

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
        Please sign in to view trade history.
      </div>
    );
  }

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', padding: '12px 16px 120px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <X size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Trade History</h1>
            {isDemo && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                background: 'linear-gradient(135deg, rgba(147,51,234,0.3), rgba(6,182,212,0.25))',
                color: '#c084fc', border: '1px solid rgba(147,51,234,0.3)',
              }}>
                DEMO
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {total} trades · {stats.uniqueSymbols} symbols
            {syncStatus && (
              <span style={{ color: isDemo ? '#c084fc' : '#22c55e', marginLeft: 8 }}>{syncStatus}</span>
            )}
          </div>
        </div>
        <button
          onClick={syncThenLoad}
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

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 14 }}>
        <StatCard icon={Activity} label="Total Trades" value={stats.totalTrades.toString()} color="#06b6d4" />
        <StatCard
          icon={stats.totalPnL >= 0 ? TrendingUp : TrendingDown}
          label="Total P&L"
          value={`${stats.totalPnL >= 0 ? '+' : ''}${fmtLargeCurrency(stats.totalPnL)}`}
          color={stats.totalPnL >= 0 ? '#22c55e' : '#ef4444'}
        />
        <StatCard icon={BarChart3} label="Win Rate" value={`${stats.winRate.toFixed(1)}%`}
          color={stats.winRate >= 50 ? '#22c55e' : '#facc15'} />
        <StatCard icon={DollarSign} label="Avg P&L/Trade" value={fmtLargeCurrency(stats.avgPnLPerSymbol)}
          color={stats.avgPnLPerSymbol >= 0 ? '#22c55e' : '#ef4444'} />
      </div>

      {/* Second stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 14 }}>
        <MiniStat label="Buys" value={stats.buyCount.toString()} color="#22c55e" />
        <MiniStat label="Sells" value={stats.sellCount.toString()} color="#ef4444" />
        <MiniStat label="Volume" value={stats.totalVolume.toLocaleString()} color="#64748b" />
        <MiniStat label="Wins" value={`${stats.wins}`} color="#22c55e" />
        <MiniStat label="Losses" value={`${stats.losses}`} color="#ef4444" />
        <MiniStat label="Largest Win" value={fmtLargeCurrency(stats.largestWin)} color="#22c55e" />
        <MiniStat label="Largest Loss" value={fmtLargeCurrency(Math.abs(stats.largestLoss))} color="#ef4444" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={symbolFilter}
          onChange={(e) => { setSymbolFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 10px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 11, maxWidth: 120 }}
        >
          <option value="">All Symbols</option>
          {availableSymbols.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #334155' }}>
          {(['all', 'buy', 'sell'] as const).map(a => (
            <button key={a} onClick={() => { setActionFilter(a); setPage(0); }}
              style={{
                padding: '6px 12px', border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: actionFilter === a ? '#06b6d4' : '#1e293b',
                color: actionFilter === a ? '#0f172a' : 'var(--text-dim)',
                textTransform: 'capitalize',
              }}
            >{a}</button>
          ))}
        </div>

        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
          style={{ padding: '6px 8px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 10 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>to</span>
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
          style={{ padding: '6px 8px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 10 }} />

        {(symbolFilter || actionFilter !== 'all' || dateFrom || dateTo) && (
          <button onClick={() => { setSymbolFilter(''); setActionFilter('all'); setDateFrom(''); setDateTo(''); setPage(0); }}
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '2px 6px' }}>
            <X size={12} style={{ marginRight: 2 }} />Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={syncThenLoad} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>Loading trade history...</div>
      )}

      {/* Waiting for broker check */}
      {!loading && !isInitialized && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>Checking broker status...</div>
      )}

      {/* Empty */}
      {!loading && isInitialized && trades.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#1e293b', border: '1px solid #334155', borderRadius: 12 }}>
          <Activity size={40} style={{ color: '#475569', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No trades yet</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Your trade history will appear here once you start trading.</div>
        </div>
      )}

      {/* No filtered results */}
      {!loading && trades.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 30, fontSize: 12, color: 'var(--text-muted)', background: '#1e293b', border: '1px solid #334155', borderRadius: 10 }}>
          No trades match these filters.
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
        <>
          <div style={{ overflow: 'auto' }}>
            <table className="trade-table">
              <thead>
                <tr>
                  <Th onClick={() => toggleSort('executedAt')}><SortIcon col="executedAt" /> Date</Th>
                  <Th onClick={() => toggleSort('symbol')}><SortIcon col="symbol" /> Symbol</Th>
                  <Th onClick={() => toggleSort('action')}><SortIcon col="action" /> Action</Th>
                  <Th onClick={() => toggleSort('quantity')}><SortIcon col="quantity" /> Qty</Th>
                  <Th onClick={() => toggleSort('price')}><SortIcon col="price" /> Price</Th>
                  <Th onClick={() => toggleSort('totalValue')}><SortIcon col="totalValue" /> Total</Th>
                  <Th>P&L</Th>
                </tr>
              </thead>
              <tbody>
                {paged.map(trade => {
                  const isBuy = trade.action === 'buy';
                  const pnlInfo = pnlMap.get(trade.symbol);
                  const estPnl = !isBuy && pnlInfo
                    ? (trade.price - pnlInfo.avgCost) * trade.quantity
                    : null;

                  return (
                    <tr key={trade.id} className="trade-row">
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{fmtDate(trade.executedAt)}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{fmtTime(trade.executedAt)}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, letterSpacing: '-0.5px' }}>
                        {trade.symbol}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                          background: isBuy ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                          color: isBuy ? '#22c55e' : '#ef4444',
                          fontSize: 10, fontWeight: 700,
                        }}>
                          {isBuy ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{trade.quantity}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(trade.price)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {fmtCurrency(trade.totalValue)}
                      </td>
                      <td>
                        {estPnl != null ? (
                          <span style={{
                            fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums',
                            color: estPnl >= 0 ? '#22c55e' : '#ef4444',
                          }}>
                            {estPnl >= 0 ? '+' : ''}{fmtCurrency(estPnl)}
                          </span>
                        ) : trade.action === 'buy' ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>—</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding: '6px 12px', borderRadius: 6, background: page === 0 ? '#0f172a' : '#1e293b', border: '1px solid #334155', color: page === 0 ? '#475569' : 'var(--text-dim)', fontSize: 11, cursor: page === 0 ? 'default' : 'pointer' }}>
                Prev
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {page + 1} / {totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={{ padding: '6px 12px', borderRadius: 6, background: page >= totalPages - 1 ? '#0f172a' : '#1e293b', border: '1px solid #334155', color: page >= totalPages - 1 ? '#475569' : 'var(--text-dim)', fontSize: 11, cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .trade-table { width: 100%; border-collapse: collapse; }
        .trade-table thead tr { border-bottom: 1px solid #334155; }
        .trade-table th {
          padding: 8px 10px; text-align: left; font-size: 9px; font-weight: 700;
          color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;
          white-space: nowrap; cursor: pointer; user-select: none;
        }
        .trade-table th:hover { color: var(--text-dim); }
        .trade-table td { padding: 10px; border-bottom: 1px solid #1e293b; font-size: 12px; }
        .trade-row { transition: background 0.1s; }
        .trade-row:hover { background: rgba(6,182,212,0.03); }
      `}</style>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Icon size={14} style={{ color }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <th onClick={onClick} style={onClick ? undefined : { cursor: 'default' }}>{children}</th>;
}

export default function TradeHistoryPage() {
  return (
    <BrokerProvider>
      <TradeHistoryPageInner />
    </BrokerProvider>
  );
}
