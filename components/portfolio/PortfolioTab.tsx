'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { usePortfolioStore } from '@/store';
import { AccountSummaryCard } from '@/components/shared/AccountSummaryCard';
import { useBroker } from '@/components/providers/BrokerProvider';
import { DemoBanner } from '@/components/shared/DemoBanner';

export function PortfolioTab() {
  const { account, loading, error, refresh } = usePortfolio();
  const { isConnected, brokerId } = useBroker();
  const store = usePortfolioStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSellPanel, setShowSellPanel] = useState(false);
  const [sortBy, setSortBy] = useState<'pct' | 'name' | 'sector' | 'pnl'>('pct');
  const [sortOpen, setSortOpen] = useState(false);

  // ── Performance Chart ─────────────────────────────────────
  type RangeKey = '1D' | '7D' | '30D' | '90D' | 'YTD' | '1Y' | 'ALL';
  const [chartRange, setChartRange] = useState<RangeKey>('30D');
  const [chartData, setChartData] = useState<{ timestamps: number[]; equities: number[] } | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; idx: number; visible: boolean } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const RANGE_CONFIG: Record<RangeKey, { period: string; timeframe: string; label: string }> = {
    '1D': { period: '1D', timeframe: '5Min', label: 'Today' },
    '7D': { period: '1W', timeframe: '30Min', label: '7D' },
    '30D': { period: '1M', timeframe: '1D', label: '30D' },
    '90D': { period: '3M', timeframe: '1D', label: '90D' },
    'YTD': { period: '1Y', timeframe: '1D', label: 'YTD' },
    '1Y': { period: '1Y', timeframe: '1D', label: '1Y' },
    'ALL': { period: 'all', timeframe: '1D', label: 'All' },
  };

  const fetchChartData = useCallback(async (range: RangeKey) => {
    setChartLoading(true);
    try {
      const cfg = RANGE_CONFIG[range];
      const res = await fetch(`/api/alpaca/history?period=${cfg.period}&timeframe=${cfg.timeframe}`);
      const json = await res.json();
      if (json.timestamp && json.equity) {
        let timestamps: number[] = json.timestamp;
        let equities: number[] = json.equity;
        // YTD: filter to current year
        if (range === 'YTD') {
          const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
          const idx = timestamps.findIndex((t: number) => t >= yearStart);
          if (idx > 0) {
            timestamps = timestamps.slice(idx);
            equities = equities.slice(idx);
          }
        }
        setChartData({ timestamps, equities });
      } else {
        setChartData(null);
      }
    } catch {
      setChartData(null);
    }
    setChartLoading(false);
  }, []);

  useEffect(() => { fetchChartData(chartRange); }, [chartRange, fetchChartData]);
  const [sellSubmitting, setSellSubmitting] = useState(false);
  const [sellResults, setSellResults] = useState<Array<{ symbol: string; ok: boolean; error?: string }>>([]);

  // Per-position sell configuration
  interface SellConfig {
    qty: number;
    orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
    limitPrice: string;
    stopPrice: string;
    tif: 'day' | 'gtc';
  }
  const [sellConfigs, setSellConfigs] = useState<Record<string, SellConfig>>({});

  const initSellConfig = (symbols: string[]) => {
    const cfgs: Record<string, SellConfig> = {};
    for (const sym of symbols) {
      const pos = account?.positions.find(p => p.symbol === sym);
      cfgs[sym] = { qty: pos?.qty || 0, orderType: 'market', limitPrice: '', stopPrice: '', tif: 'day' };
    }
    setSellConfigs(cfgs);
  };

  const updateSellConfig = (symbol: string, patch: Partial<SellConfig>) => {
    setSellConfigs(prev => ({ ...prev, [symbol]: { ...prev[symbol], ...patch } }));
  };

  const fmt = (n: number) =>
    `$${Math.abs(n).toLocaleString()}`;
  const pct = (n: number) =>
    `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  const toggleSelect = (symbol: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  };

  const selectAll = () => {
    if (account && selected.size === account.positions.length) {
      setSelected(new Set());
    } else if (account) {
      setSelected(new Set(account.positions.map(p => p.symbol)));
    }
  };

  const submitBulkSell = async () => {
    setSellSubmitting(true);
    setSellResults([]);
    const results: Array<{ symbol: string; ok: boolean; error?: string }> = [];
    for (const symbol of selected) {
      try {
        const pos = account?.positions.find(p => p.symbol === symbol);
        const cfg = sellConfigs[symbol];
        if (!pos || !cfg) continue;
        const body: any = {
          symbol,
          qty: cfg.qty,
          side: 'sell',
          type: cfg.orderType,
          time_in_force: cfg.orderType === 'market' ? 'day' : cfg.tif,
        };
        if (cfg.orderType === 'limit' || cfg.orderType === 'stop_limit') {
          body.limit_price = parseFloat(cfg.limitPrice);
        }
        if (cfg.orderType === 'stop' || cfg.orderType === 'stop_limit') {
          body.stop_price = parseFloat(cfg.stopPrice);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await fetch('/api/alpaca/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const json = await res.json();
          const errMsg = json.error || json.message || '';
          results.push({ symbol, ok: res.ok, error: errMsg });
        } catch (fetchErr: any) {
          results.push({ symbol, ok: false, error: fetchErr.name === 'AbortError' ? 'Request timed out' : fetchErr.message });
        } finally {
          clearTimeout(timeout);
        }
      } catch (e: any) {
        results.push({ symbol, ok: false, error: e.message });
      }
    }
    setSellResults(results);
    setSellSubmitting(false);
    const allOk = results.every(r => r.ok);
    if (allOk) {
      setSelected(new Set());
      setShowSellPanel(false);
      setSellConfigs({});
      refresh();
    }
  };

  // ── Sorted positions ─────────────────────────────────────
  const sortedPositions = (() => {
    if (!account?.positions) return [];
    const list = [...account.positions];
    switch (sortBy) {
      case 'name':
        return list.sort((a, b) => a.symbol.localeCompare(b.symbol));
      case 'sector':
        return list.sort((a, b) => (a.sector || 'ZZZ').localeCompare(b.sector || 'ZZZ'));
      case 'pnl':
        return list.sort((a, b) => b.totalPnl - a.totalPnl);
      case 'pct':
      default:
        return list.sort((a, b) => b.portfolioPercent - a.portfolioPercent);
    }
  })();

  // No broker connected — show demo portfolio with banner
  if (!isConnected) {
    const demoAccount = account;
    if (!demoAccount) {
      return (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading demo portfolio…
        </div>
      );
    }

    return (
      <div style={{ padding: '12px 16px 80px' }}>
        <DemoBanner />

        {/* Account Summary */}
        <div className="card" style={{ marginBottom: 12 }}>
          <AccountSummaryCard account={demoAccount} />
        </div>

        {/* Positions list */}
        {sortedPositions.map((pos) => (
          <div key={pos.symbol} className="card" style={{ marginBottom: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{pos.symbol}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{pos.qty} shares · {pos.sector}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>
                  ${pos.marketValue.toLocaleString()}
                </div>
                <div style={{ fontSize: 10, color: pos.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  {pos.totalPnl >= 0 ? '+' : ''}${Math.round(pos.totalPnl).toLocaleString()} ({pos.totalPnlPercent >= 0 ? '+' : ''}{pos.totalPnlPercent.toFixed(1)}%)
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Sector Allocation */}
        {account.positions.length > 0 && (
          <SectorAllocation positions={account.positions} />
        )}

        {/* Bottom CTA */}
        <div style={{
          marginTop: 16,
          padding: '16px',
          background: 'rgba(6,182,212,0.06)',
          border: '1px solid rgba(6,182,212,0.2)',
          borderRadius: 12,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#06b6d4', marginBottom: 8 }}>
            Ready to see your real portfolio?
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 12 }}>
            Connect your broker to replace this demo data with live positions, P&L, and trading.
          </div>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            }}
            style={{
              padding: '10px 24px',
              background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
              border: 'none',
              borderRadius: 8,
              color: '#0f172a',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Connect Broker
          </button>
        </div>

        <style jsx>{`
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 12px; }
        `}</style>
      </div>
    );
  }

  // Loading state — skeleton shimmer
  if (loading && !account) {
    return (
      <div style={{ padding: '12px 16px 80px' }}>
        <div className="card skeleton" style={{ height: 160, marginBottom: 12 }} />
        <div className="card skeleton" style={{ height: 100, marginBottom: 12 }} />
        <div className="card skeleton" style={{ height: 80, marginBottom: 12 }} />
        <SectorsSkeleton />
        <style jsx>{`
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 12px; }
          .skeleton {
            background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
          }
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>
    );
  }

  // Error state
  if (error && !account) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Unable to load portfolio
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          {error}
        </div>
        <button
          onClick={refresh}
          style={{
            padding: '8px 20px', background: 'var(--accent-cyan)', border: 'none',
            borderRadius: 8, color: 'white', fontWeight: 600, fontSize: 12, cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state — no positions
  if (account && account.positions.length === 0) {
    return (
      <div style={{ padding: '12px 16px 80px' }}>
        {/* Account Summary — shown even without positions */}
        <div className="card" style={{ marginBottom: 12 }}>
          <AccountSummaryCard account={account} />
        </div>

        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📈</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            No positions yet
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            Ready to start investing? Your buying power is ${account.buyingPower.toLocaleString()}.
          </div>
          <button
            style={{
              padding: '8px 20px', background: 'linear-gradient(135deg, #06b6d4, #0d9488)',
              border: 'none', borderRadius: 8, color: 'white', fontWeight: 600, fontSize: 12, cursor: 'pointer',
            }}
          >
            Explore Stocks
          </button>
        </div>
      </div>
    );
  }

  // Data state
  if (!account) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Connecting to broker...
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 80px' }}>
      {/* Market Closed Banner */}
      {/* (would be dynamic from useBrokerData — keeping it simple) */}

      {/* Error banner for partial failures */}
      {error && (
        <div style={{
          padding: '8px 12px', marginBottom: 10,
          background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 8, fontSize: 11, color: '#f87171',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>⚠ {error}</span>
          <button onClick={refresh} style={{
            background: 'transparent', border: 'none', color: '#f87171',
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }}>
            Retry
          </button>
        </div>
      )}

      {/* Account Summary */}
      <div className="card" style={{ marginBottom: 12 }}>
        <AccountSummaryCard account={account} />
      </div>

      {/* Performance Chart */}
      <div className="card" style={{ marginBottom: 12 }} ref={chartRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Performance</span>
          <span style={{ fontSize: 10 }}>
            <span className={account.totalPnlPercent >= 0 ? 'up' : 'down'}>
              {pct(account.totalPnlPercent)}
            </span>
          </span>
        </div>
        {/* Time Range Selector */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {(Object.keys(RANGE_CONFIG) as RangeKey[]).map(r => (
            <button
              key={r}
              onClick={() => setChartRange(r)}
              style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 12,
                background: chartRange === r ? '#06b6d4' : 'transparent',
                border: chartRange === r ? '1px solid #06b6d4' : '1px solid #334155',
                color: chartRange === r ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {RANGE_CONFIG[r].label}
            </button>
          ))}
        </div>
        {/* Chart */}
        {chartLoading && (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            Loading chart...
          </div>
        )}
        {!chartLoading && chartData && chartData.timestamps.length > 1 ? (() => {
          const W = 600, H = 160, PAD = { top: 10, right: 10, bottom: 28, left: 55 };
          const plotW = W - PAD.left - PAD.right;
          const plotH = H - PAD.top - PAD.bottom;
          const { timestamps, equities } = chartData;
          const minE = Math.min(...equities) * 0.995;
          const maxE = Math.max(...equities) * 1.005;
          const range = maxE - minE || 1;
          const minT = timestamps[0];
          const maxT = timestamps[timestamps.length - 1];
          const tRange = maxT - minT || 1;
          const xVal = (t: number) => PAD.left + ((t - minT) / tRange) * plotW;
          const yVal = (e: number) => PAD.top + plotH - ((e - minE) / range) * plotH;
          const points = timestamps.map((t, i) => `${xVal(t)},${yVal(equities[i])}`).join(' ');
          const isUp = equities[equities.length - 1] >= equities[0];
          const color = isUp ? '#4ade80' : '#f87171';
          // Y-axis ticks
          const yTicks = [minE, minE + range * 0.25, minE + range * 0.5, minE + range * 0.75, maxE];
          // X-axis labels (3-4 evenly spaced)
          const xLabelCount = chartRange === '1D' ? 4 : 4;
          const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
            const ts = minT + (tRange / (xLabelCount - 1)) * i;
            const d = new Date(ts * 1000);
            const fmt = chartRange === '1D' ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
              : chartRange === '7D' ? d.toLocaleDateString([], { weekday: 'short' })
              : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            return { x: xVal(ts), label: fmt };
          });
          return (
            <div style={{ position: 'relative' }}>
              <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
                onMouseMove={(e) => {
                  const rect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect();
                  if (!rect) return;
                  const mx = ((e.clientX - rect.left) / rect.width) * W;
                  if (mx < PAD.left || mx > PAD.left + plotW) { setTooltip(null); return; }
                  const tApprox = minT + ((mx - PAD.left) / plotW) * tRange;
                  let bestIdx = 0, bestDist = Infinity;
                  for (let i = 0; i < timestamps.length; i++) {
                    const d = Math.abs(timestamps[i] - tApprox);
                    if (d < bestDist) { bestDist = d; bestIdx = i; }
                  }
                  setTooltip({ x: mx, idx: bestIdx, visible: true });
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                {/* Grid lines */}
                {yTicks.map((y, i) => (
                  <g key={i}>
                    <line x1={PAD.left} y1={yVal(y)} x2={PAD.left + plotW} y2={yVal(y)} stroke="#1e293b" strokeWidth="1" />
                    <text x={PAD.left - 6} y={yVal(y) + 4} textAnchor="end" fill="#64748b" fontSize="9">
                      ${(y / 1000).toFixed(1)}k
                    </text>
                  </g>
                ))}
                {/* Line */}
                <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
                {/* Area fill */}
                <polygon
                  points={`${xVal(timestamps[0])},${yVal(minE)} ${points} ${xVal(timestamps[timestamps.length - 1])},${yVal(minE)}`}
                  fill={color} opacity="0.08"
                />
                {/* X-axis labels */}
                {xLabels.map((l, i) => (
                  <text key={i} x={l.x} y={H - 6} textAnchor="middle" fill="#64748b" fontSize="9">
                    {l.label}
                  </text>
                ))}
                {/* Tooltip marker */}
                {tooltip?.visible && tooltip.idx < timestamps.length && (
                  <>
                    <line x1={xVal(timestamps[tooltip.idx])} y1={PAD.top} x2={xVal(timestamps[tooltip.idx])} y2={PAD.top + plotH}
                      stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                    <circle cx={xVal(timestamps[tooltip.idx])} cy={yVal(equities[tooltip.idx])} r="4"
                      fill={color} stroke="#0f172a" strokeWidth="2" />
                  </>
                )}
              </svg>
              {/* Tooltip popup */}
              {tooltip?.visible && tooltip.idx < timestamps.length && (() => {
                const t = new Date(timestamps[tooltip.idx] * 1000);
                const dateStr = chartRange === '1D'
                  ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : t.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                const eq = equities[tooltip.idx];
                return (
                  <div style={{
                    position: 'absolute', top: 0, left: Math.max(0, Math.min(tooltip.x - 65, (chartRef.current?.offsetWidth ?? 400) - 130)),
                    background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px',
                    fontSize: 10, color: '#e2e8f0', pointerEvents: 'none', zIndex: 5, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{dateStr}</div>
                    <div style={{ color }}>${eq.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>
                );
              })()}
            </div>
          );
        })() : !chartLoading && (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No history data yet — chart will populate as you trade.
          </div>
        )}
      </div>

      {/* Sector Allocation */}
      <SectorAllocation positions={account.positions} />

      {/* Positions */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={account && selected.size > 0 && selected.size === account.positions.length}
                onChange={selectAll}
                style={{ width: 16, height: 16, accentColor: '#06b6d4', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {selected.size === 0 ? 'Select All' : selected.size === account?.positions.length ? 'Deselect' : `${selected.size} selected`}
              </span>
            </label>
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              Positions ({account?.positions.length || 0})
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {selected.size > 0 && (
              <button
                onClick={() => { setShowSellPanel(true); initSellConfig(Array.from(selected)); }}
                style={{
                  fontSize: 10, fontWeight: 700, padding: '4px 10px',
                  background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 6, color: '#f87171', cursor: 'pointer',
                }}
              >
                Sell {selected.size} Selected
              </button>
            )}
            {/* Sort dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setSortOpen(!sortOpen)}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '4px 8px',
                  background: '#1e293b', border: '1px solid #334155',
                  borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                Sort: {sortBy === 'pct' ? '%' : sortBy === 'pnl' ? 'P&L' : sortBy === 'name' ? 'ABC' : 'Sector'} ▾
              </button>
              {sortOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 9 }}
                    onClick={() => setSortOpen(false)}
                  />
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 10,
                    background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 4,
                    minWidth: 130, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }}>
                    {([
                      { key: 'pct', label: '% Value' },
                      { key: 'name', label: 'Name (A-Z)' },
                      { key: 'sector', label: 'Sector' },
                      { key: 'pnl', label: 'P&L' },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => { setSortBy(key); setSortOpen(false); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '6px 10px', fontSize: 11, borderRadius: 6,
                          background: sortBy === key ? 'rgba(6,182,212,0.12)' : 'transparent',
                          border: 'none', color: sortBy === key ? '#06b6d4' : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {sortedPositions.map((pos) => (
          <div key={pos.symbol} className={`pos-row ${selected.has(pos.symbol) ? 'selected' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected.has(pos.symbol)}
                  onClick={(e) => { e.stopPropagation(); }}
                  onChange={() => toggleSelect(pos.symbol)}
                  style={{ width: 16, height: 16, accentColor: '#06b6d4', cursor: 'pointer', flexShrink: 0, margin: 0 }}
                />
                <div style={{ fontSize: 13, fontWeight: 700 }}>{pos.symbol}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {pos.qty} shares {pos.sector && `· ${pos.sector}`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  ${pos.marketValue.toLocaleString()}
                </div>
                <div
                  className={pos.dayChange >= 0 ? 'up' : 'down'}
                  style={{ fontSize: 10, fontWeight: 600 }}
                >
                  {pos.dayChange >= 0 ? '+' : ''}${pos.dayChange.toLocaleString()} ({pct(pos.dayChangePercent)})
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 4,
                paddingTop: 6,
                borderTop: '1px solid #334155',
              }}
            >
              {([
                ['Avg Cost', `$${pos.avgCost}`],
                ['Current', `$${pos.currentPrice}`],
                ['Total P&L', `${pos.totalPnl >= 0 ? '+' : ''}$${pos.totalPnl.toLocaleString()}`],
                ['% Port', `${pos.portfolioPercent.toFixed(1)}%`],
              ] as [string, string][]).map(([label, val]) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      fontSize: 8,
                      color: 'var(--text-dim)',
                      textTransform: 'uppercase',
                      marginBottom: 1,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: val.startsWith('+') ? '#4ade80' : val.startsWith('-') ? '#f87171' : '#f1f5f9',
                    }}
                  >
                    {val}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                height: 3,
                background: '#334155',
                borderRadius: 2,
                marginTop: 6,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pos.portfolioPercent}%`,
                  background: 'linear-gradient(90deg, #06b6d4, #0d9488)',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Sticky Batch Action Bar */}
      {selected.size > 0 && !showSellPanel && (
        <div className="batch-bar">
          <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>
            <span style={{ color: '#06b6d4' }}>{selected.size}</span> position{selected.size > 1 ? 's' : ''} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSelected(new Set())} className="clear-btn">
              Clear
            </button>
            <button onClick={() => { setShowSellPanel(true); initSellConfig(Array.from(selected)); }} className="sell-btn">
              Sell Now
            </button>
          </div>
        </div>
      )}

      {/* Sell Confirmation Overlay */}
      {showSellPanel && selected.size > 0 && (
        <>
          <div onClick={() => { setShowSellPanel(false); setSellResults([]); }} className="overlay-backdrop" />
          <div className="sell-overlay">
            {/* Header — sticky */}
            <div className="sell-header">
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
                Sell {selected.size} Position{selected.size > 1 ? 's' : ''}
              </span>
              <button onClick={() => { setShowSellPanel(false); setSellResults([]); }} className="close-sell-btn">
                ✕
              </button>
            </div>

            {/* Scrollable position list with per-position config */}
            <div className="sell-body">
              {Array.from(selected).map(symbol => {
                const pos = account?.positions.find(p => p.symbol === symbol);
                const cfg = sellConfigs[symbol];
                const result = sellResults.find(r => r.symbol === symbol);
                if (!pos || !cfg) return null;

                const orderType = cfg.orderType;
                const needsLimit = orderType === 'limit' || orderType === 'stop_limit';
                const needsStop = orderType === 'stop' || orderType === 'stop_limit';

                return (
                  <div key={symbol} className={`sell-pos-card ${result ? (result.ok ? 'sold' : 'failed') : ''}`}>
                    {/* Remove button */}
                    <button
                      onClick={() => setSelected(prev => { const n = new Set(prev); n.delete(symbol); return n; })}
                      style={{
                        position: 'absolute', top: 6, right: 8,
                        width: 22, height: 22, borderRadius: 6,
                        border: '1px solid #334155', background: '#1e293b',
                        color: '#94a3b8', fontSize: 12, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                      title="Remove from sell"
                    >
                      ✕
                    </button>
                    {/* Position summary row */}
                    <div className="sell-pos-header">
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{symbol}</span>
                        <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>
                          {pos.qty} sh @ ${pos.currentPrice?.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>
                          ${(cfg.qty * pos.currentPrice).toFixed(2)}
                        </div>
                        {result && (
                          <div style={{ fontSize: 10, fontWeight: 600, color: result.ok ? '#4ade80' : '#f87171' }}>
                            {result.ok ? '✓ Sold' : `✗ ${result.error}`}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Qty control */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, minWidth: 14 }}>Qty</span>
                      <button
                        onClick={() => { const v = Math.max(1, cfg.qty - 1); updateSellConfig(symbol, { qty: v }); }}
                        style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                      >−</button>
                      <input
                        type="number"
                        min={1}
                        max={pos.qty}
                        value={cfg.qty}
                        onChange={e => { const v = Math.min(pos.qty, Math.max(1, parseInt(e.target.value) || 1)); updateSellConfig(symbol, { qty: v }); }}
                        style={{ width: 60, textAlign: 'center', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '4px 6px', color: '#f1f5f9', fontSize: 12, fontWeight: 600 }}
                      />
                      <button
                        onClick={() => { const v = Math.min(pos.qty, cfg.qty + 1); updateSellConfig(symbol, { qty: v }); }}
                        style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                      >+</button>
                      <span style={{ fontSize: 9, color: '#64748b' }}>of {pos.qty}</span>
                    </div>

                    {/* Order type mini-tabs */}
                    <div style={{ display: 'flex', gap: 3, marginBottom: 6, background: '#0f172a', padding: 3, borderRadius: 6 }}>
                      {(['market', 'limit', 'stop', 'stop_limit'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => updateSellConfig(symbol, { orderType: t })}
                          style={{
                            flex: 1, padding: '4px 2px', fontSize: 9, fontWeight: 600,
                            border: 'none', borderRadius: 4, cursor: 'pointer',
                            background: orderType === t ? '#06b6d4' : 'transparent',
                            color: orderType === t ? 'white' : '#64748b',
                          }}
                        >
                          {t === 'market' ? 'Mkt' : t === 'limit' ? 'Lmt' : t === 'stop' ? 'Stp' : 'StpL'}
                        </button>
                      ))}
                    </div>

                    {/* Price inputs + TIF */}
                    {orderType !== 'market' && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        {needsLimit && (
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Limit</div>
                            <div style={{ display: 'flex', alignItems: 'center', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '0 6px' }}>
                              <span style={{ color: '#64748b', fontSize: 10, marginRight: 2 }}>$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={cfg.limitPrice}
                                onChange={e => updateSellConfig(symbol, { limitPrice: e.target.value })}
                                placeholder="Min price"
                                style={{ flex: 1, padding: '5px 0', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: 11, outline: 'none' }}
                              />
                            </div>
                          </div>
                        )}
                        {needsStop && (
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Stop</div>
                            <div style={{ display: 'flex', alignItems: 'center', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '0 6px' }}>
                              <span style={{ color: '#64748b', fontSize: 10, marginRight: 2 }}>$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={cfg.stopPrice}
                                onChange={e => updateSellConfig(symbol, { stopPrice: e.target.value })}
                                placeholder="Trigger"
                                style={{ flex: 1, padding: '5px 0', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: 11, outline: 'none' }}
                              />
                            </div>
                            {/* Stop order validation */}
                            {cfg.orderType === 'stop' && cfg.stopPrice && (() => {
                              const pos = account?.positions.find(p => p.symbol === symbol);
                              const sp = parseFloat(cfg.stopPrice);
                              const cp = pos?.currentPrice;
                              if (cp && !isNaN(sp) && sp >= cp) {
                                return (
                                  <div style={{ fontSize: 9, color: '#fbbf24', marginTop: 3 }}>
                                    ⚠ Stop ${sp.toFixed(2)} is above current price ($${cp.toFixed(2)}).
                                    For sell stops, stop price must be below market.
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>TIF</div>
                          <select
                            value={cfg.tif}
                            onChange={e => updateSellConfig(symbol, { tif: e.target.value as 'day' | 'gtc' })}
                            style={{ padding: '5px 4px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 10, fontWeight: 600 }}
                          >
                            <option value="day">Day</option>
                            <option value="gtc">GTC</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Sticky footer — always visible */}
            <div className="sell-footer">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>Estimated proceeds</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
                  ${Array.from(selected).reduce((sum, sym) => {
                    const pos = account?.positions.find(p => p.symbol === sym);
                    const cfg = sellConfigs[sym];
                    if (!pos || !cfg) return sum;
                    const price = cfg.orderType === 'limit' && cfg.limitPrice ? parseFloat(cfg.limitPrice) : pos.currentPrice || 0;
                    return sum + (cfg.qty * price);
                  }, 0).toFixed(2)}
                </span>
              </div>

              {/* Validation */}
              {(() => {
                const invalidCfg = Object.values(sellConfigs).find(cfg => {
                  const needsLimit = (cfg.orderType === 'limit' || cfg.orderType === 'stop_limit') && !cfg.limitPrice;
                  const needsStop = (cfg.orderType === 'stop' || cfg.orderType === 'stop_limit') && !cfg.stopPrice;
                  return needsLimit || needsStop;
                });
                return invalidCfg && !sellSubmitting ? (
                  <div className="validation-msg">Missing price(s) for one or more positions</div>
                ) : null;
              })()}

              <button
                onClick={submitBulkSell}
                disabled={
                  sellSubmitting ||
                  Object.values(sellConfigs).some(cfg => {
                    const needsLimit = (cfg.orderType === 'limit' || cfg.orderType === 'stop_limit') && !cfg.limitPrice;
                    const needsStop = (cfg.orderType === 'stop' || cfg.orderType === 'stop_limit') && !cfg.stopPrice;
                    return needsLimit || needsStop;
                  })
                }
                className="confirm-sell-btn"
              >
                {sellSubmitting ? 'Submitting...' : `Confirm — Sell ${selected.size} Position${selected.size > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 12px;
        }
        .pos-row {
          padding: 10px;
          background: #0f172a;
          border-radius: 8px;
          margin-bottom: 8px;
          cursor: pointer;
        }
        .pos-row:active { background: #334155; }
        .pos-row.selected { background: #0a2333; border: 1px solid rgba(6,182,212,0.3); }
        .batch-bar {
          position: sticky; bottom: 60px; z-index: 20;
          margin: 8px 16px 0; padding: 10px 16px;
          background: #0f172a; border: 1px solid #334155;
          border-radius: 12px; display: flex;
          justify-content: space-between; align-items: center;
          box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
        }
        .clear-btn {
          padding: 6px 12px; background: transparent;
          border: 1px solid #334155; border-radius: 6px;
          color: #94a3b8; font-size: 11px; font-weight: 600;
          cursor: pointer; font-family: inherit;
        }
        .sell-btn {
          padding: 6px 16px; background: #ef4444;
          border: none; border-radius: 6px;
          color: white; font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: inherit;
        }
        .overlay-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.6); z-index: 50;
        }
        .sell-overlay {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          background: #1e293b; border: 1px solid #334155;
          border-radius: 16px; z-index: 51;
          width: 92%; max-width: 460px;
          max-height: 80vh; overflow: hidden;
          display: flex; flex-direction: column;
        }
        .sell-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 16px 12px;
          border-bottom: 1px solid #334155;
          flex-shrink: 0;
        }
        .sell-body {
          flex: 1; overflow-y: auto; padding: 12px 16px; min-height: 0;
          display: flex; flex-direction: column; gap: 10px;
        }
        .sell-footer {
          padding: 12px 16px 16px;
          border-top: 1px solid #334155;
          flex-shrink: 0;
          background: #1e293b;
          border-radius: 0 0 16px 16px;
        }
        .sell-pos-card {
          background: #0f172a; border: 1px solid #334155;
          border-radius: 10px; padding: 12px;
          position: relative;
        }
        .sell-pos-card.sold { border-color: rgba(74,222,128,0.3); }
        .sell-pos-card.failed { border-color: rgba(239,68,68,0.3); }
        .sell-pos-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 8px;
        }
        .close-sell-btn {
          background: transparent; border: none; color: #94a3b8;
          font-size: 20px; cursor: pointer; padding: 4px;
        }
        .validation-msg {
          text-align: center; font-size: 10px; color: #fbbf24;
          margin-bottom: 8px; padding: 6px; background: rgba(251,191,36,0.1);
          border-radius: 6px;
        }
        .confirm-sell-btn {
          width: 100%; padding: 13px; border: none; border-radius: 10px;
          font-size: 14px; font-weight: 700; cursor: pointer;
          background: #ef4444; color: white; font-family: inherit;
        }
        .confirm-sell-btn:disabled {
          background: #334155; color: #94a3b8; cursor: not-allowed;
        }
        .sort-btn {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 10px;
          color: #94a3b8;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

const SECTOR_COLORS = [
  '#06b6d4', // Technology — cyan
  '#8b5cf6', // Healthcare — purple
  '#22c55e', // Financial Services — green
  '#f59e0b', // Consumer — amber
  '#ec4899', // Industrials — pink
  '#3b82f6', // Energy — blue
  '#ef4444', // Utilities — red
  '#14b8a6', // Real Estate — teal
  '#a855f7', // Materials — violet
  '#f97316', // Media & Entertainment — orange
  '#84cc16', // Automotive — lime
  '#64748b', // Other — gray
];

function SectorAllocation({ positions }: { positions: import('@/types').Position[] }) {
  const sectorTotals: Record<string, { value: number; color: string }> = {};
  for (const pos of positions) {
    const sector = pos.sector || 'Other';
    if (!sectorTotals[sector]) {
      sectorTotals[sector] = {
        value: 0,
        color: SECTOR_COLORS[Object.keys(sectorTotals).length % SECTOR_COLORS.length],
      };
    }
    sectorTotals[sector].value += pos.marketValue;
  }

  const totalValue = Object.values(sectorTotals).reduce((s, v) => s + v.value, 0);
  const allocations = Object.entries(sectorTotals)
    .map(([sector, { value, color }]) => ({
      sector,
      percent: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
      color,
    }))
    .sort((a, b) => b.percent - a.percent);

  if (allocations.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
        Sector Allocation
      </div>
      <div
        style={{
          display: 'flex',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        {allocations.map((a) => (
          <div
            key={a.sector}
            style={{ width: `${a.percent}%`, height: '100%', background: a.color }}
          />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {allocations.map((a) => (
          <div
            key={a.sector}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: a.color,
              }}
            />
            <span style={{ color: '#cbd5e1', flex: 1 }}>{a.sector}</span>
            <span style={{ color: '#f1f5f9', fontWeight: 600 }}>
              {a.percent}%
            </span>
          </div>
        ))}
      </div>
      <style jsx>{`
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 12px; }
      `}</style>
    </div>
  );
}

function SectorsSkeleton() {
  return (
    <div className="card skeleton" style={{ height: 100 }} />
  );
}
