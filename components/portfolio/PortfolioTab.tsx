'use client';
import { useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { usePortfolioStore } from '@/store';
import { AccountSummaryCard } from '@/components/shared/AccountSummaryCard';

export function PortfolioTab() {
  const { account, loading, error, refresh } = usePortfolio();
  const store = usePortfolioStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSellPanel, setShowSellPanel] = useState(false);
  const [sellSubmitting, setSellSubmitting] = useState(false);
  const [sellResults, setSellResults] = useState<Array<{ symbol: string; ok: boolean; error?: string }>>([]);
  const [sellOrderType, setSellOrderType] = useState<'market' | 'limit' | 'stop' | 'stop_limit'>('market');
  const [sellLimitPrice, setSellLimitPrice] = useState('');
  const [sellStopPrice, setSellStopPrice] = useState('');
  const [sellTIF, setSellTIF] = useState<'day' | 'gtc'>('day');

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
        if (!pos) continue;
        const body: any = {
          symbol,
          qty: pos.qty,
          side: 'sell',
          type: sellOrderType,
          time_in_force: sellOrderType === 'market' ? 'day' : sellTIF,
        };
        if (sellOrderType === 'limit' || sellOrderType === 'stop_limit') {
          body.limit_price = parseFloat(sellLimitPrice);
        }
        if (sellOrderType === 'stop' || sellOrderType === 'stop_limit') {
          body.stop_price = parseFloat(sellStopPrice);
        }
        const res = await fetch('/api/alpaca/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        results.push({ symbol, ok: res.ok, error: json.error || json.message });
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
      setSellOrderType('market');
      setSellLimitPrice('');
      setSellStopPrice('');
      refresh();
    }
  };

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

      {/* Performance Chart Placeholder */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Performance</span>
          <span style={{ fontSize: 10 }}>
            <span className={account.totalPnlPercent >= 0 ? 'up' : 'down'}>
              {pct(account.totalPnlPercent)}
            </span>
          </span>
        </div>
        <div className="chart-skeleton" style={{ height: 80, position: 'relative', overflow: 'hidden' }}>
          <svg width="100%" height="80" viewBox="0 0 300 80" preserveAspectRatio="none">
            <path
              d="M0,60 L30,55 L60,58 L90,50 L120,45 L150,38 L180,42 L210,30 L240,25 L270,28 L300,18"
              stroke={account.totalPnl >= 0 ? '#4ade80' : '#f87171'}
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </div>
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
                onClick={() => setShowSellPanel(true)}
                style={{
                  fontSize: 10, fontWeight: 700, padding: '4px 10px',
                  background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 6, color: '#f87171', cursor: 'pointer',
                }}
              >
                Sell {selected.size} Selected
              </button>
            )}
            <button className="sort-btn">Sort: % ▼</button>
          </div>
        </div>

        {account.positions.map((pos) => (
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
            <button onClick={() => setShowSellPanel(true)} className="sell-btn">
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
                Sell {selected.size} Position{selected.size > 1 ? 's' : ''}
              </span>
              <button onClick={() => { setShowSellPanel(false); setSellResults([]); }} className="close-sell-btn">
                ✕
              </button>
            </div>

            {/* Order Type Tabs */}
            <div className="order-type-tabs">
              {(['market', 'limit', 'stop', 'stop_limit'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setSellOrderType(t)}
                  className={`type-tab ${sellOrderType === t ? 'active' : ''}`}
                >
                  {t === 'market' ? 'Market' : t === 'limit' ? 'Limit' : t === 'stop' ? 'Stop' : 'Stop Limit'}
                </button>
              ))}
            </div>

            {/* Price Inputs */}
            {(sellOrderType === 'limit' || sellOrderType === 'stop_limit') && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>
                  Limit Price
                </div>
                <div className="price-input-wrap">
                  <span className="price-prefix">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={sellLimitPrice}
                    onChange={e => setSellLimitPrice(e.target.value)}
                    placeholder="Required — minimum sell price"
                    className="price-input"
                  />
                </div>
              </div>
            )}
            {(sellOrderType === 'stop' || sellOrderType === 'stop_limit') && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>
                  Stop Price
                </div>
                <div className="price-input-wrap">
                  <span className="price-prefix">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={sellStopPrice}
                    onChange={e => setSellStopPrice(e.target.value)}
                    placeholder={sellOrderType === 'stop' ? 'Price that triggers order' : 'Price that triggers limit order'}
                    className="price-input"
                  />
                </div>
              </div>
            )}

            {/* TIF (non-market) */}
            {sellOrderType !== 'market' && (
              <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>TIF</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['day', 'gtc'] as const).map(tif => (
                    <button
                      key={tif}
                      onClick={() => setSellTIF(tif)}
                      style={{
                        padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                        border: sellTIF === tif ? 'none' : '1px solid #334155',
                        background: sellTIF === tif ? '#06b6d4' : 'transparent',
                        color: sellTIF === tif ? 'white' : '#94a3b8', cursor: 'pointer',
                      }}
                    >
                      {tif === 'day' ? 'Day' : 'GTC'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Selected Positions */}
            <div style={{ marginBottom: 10 }}>
              {Array.from(selected).map(symbol => {
                const pos = account?.positions.find(p => p.symbol === symbol);
                const result = sellResults.find(r => r.symbol === symbol);
                return (
                  <div key={symbol} className={`sell-pos-row ${result ? (result.ok ? 'sold' : 'failed') : ''}`}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{symbol}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>
                        {pos?.qty} shares @ ${pos?.currentPrice?.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>
                        ${pos ? (pos.qty * pos.currentPrice).toFixed(2) : '—'}
                      </div>
                      {result && (
                        <div style={{ fontSize: 10, fontWeight: 600, color: result.ok ? '#4ade80' : '#f87171' }}>
                          {result.ok ? '✓ Sold' : `✗ ${result.error}`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Estimated Proceeds */}
            <div className="proceeds-bar">
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Estimated {sellOrderType === 'limit' ? 'Proceeds (at limit)' : sellOrderType === 'stop' ? 'Proceeds (at stop)' : 'Proceeds'}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
                ${Array.from(selected).reduce((sum, sym) => {
                  const pos = account?.positions.find(p => p.symbol === sym);
                  const price = sellOrderType === 'limit' && sellLimitPrice ? parseFloat(sellLimitPrice) : pos?.currentPrice || 0;
                  return sum + (pos ? pos.qty * price : 0);
                }, 0).toFixed(2)}
              </span>
            </div>

            {/* Validation */}
            {sellOrderType !== 'market' && sellOrderType !== 'stop' && !sellLimitPrice && !sellSubmitting && (
              <div className="validation-msg">Set a limit price to continue</div>
            )}
            {sellOrderType !== 'market' && sellOrderType !== 'limit' && !sellStopPrice && !sellSubmitting && (
              <div className="validation-msg">Set a stop price to continue</div>
            )}

            {/* Submit */}
            <button
              onClick={submitBulkSell}
              disabled={
                sellSubmitting ||
                ((sellOrderType === 'limit' || sellOrderType === 'stop_limit') && !sellLimitPrice) ||
                ((sellOrderType === 'stop' || sellOrderType === 'stop_limit') && !sellStopPrice)
              }
              className="confirm-sell-btn"
            >
              {sellSubmitting ? 'Submitting...' : `Confirm — Sell ${selected.size} Position${selected.size > 1 ? 's' : ''} (${sellOrderType === 'market' ? 'Market' : sellOrderType === 'limit' ? 'Limit' : sellOrderType === 'stop' ? 'Stop' : 'Stop Limit'})`}
            </button>
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
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 51;
          background: #1e293b; border: 1px solid #334155;
          border-top-left-radius: 20px; border-top-right-radius: 20px;
          padding: 16px 16px 24px; max-height: 80vh; overflow: auto;
        }
        .close-sell-btn {
          background: transparent; border: none; color: #94a3b8;
          font-size: 20px; cursor: pointer; padding: 4px;
        }
        .order-type-tabs {
          display: flex; gap: 4px; margin-bottom: 12px;
          background: #0f172a; padding: 4px; border-radius: 8px;
        }
        .type-tab {
          flex: 1; padding: 7px 4px; font-size: 11px; font-weight: 600;
          border: none; border-radius: 6px; cursor: pointer;
          background: transparent; color: #94a3b8;
          font-family: inherit; transition: all 0.15s;
        }
        .type-tab.active {
          background: #06b6d4; color: white;
        }
        .price-input-wrap {
          display: flex; align-items: center;
          background: #0f172a; border: 1px solid #334155;
          border-radius: 8px; padding: 0 10px;
        }
        .price-prefix {
          color: #64748b; font-size: 13px; font-weight: 600; margin-right: 4px;
        }
        .price-input {
          flex: 1; padding: 9px 0; background: transparent;
          border: none; color: #f1f5f9; font-size: 13px; outline: none;
        }
        .sell-pos-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px; background: #0f172a; border-radius: 8px; margin-bottom: 6px;
          border: 1px solid #334155;
        }
        .sell-pos-row.sold { border-color: rgba(74,222,128,0.3); }
        .sell-pos-row.failed { border-color: rgba(239,68,68,0.3); }
        .proceeds-bar {
          display: flex; justify-content: space-between;
          margin-bottom: 10px; padding: 8px 12px;
          background: #0f172a; border-radius: 8px;
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
