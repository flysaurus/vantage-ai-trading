'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingUp, AlertTriangle, Activity, Layers } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { SymbolSearch } from '@/components/trade/SymbolSearch';

// ─── Helpers ───────────────────────────────────────────────

const PRESETS: Record<string, { label: string; description: string; fill: (symbols: string[]) => Record<string, number> }> = {
  '6040': {
    label: '60/40 Stocks/Bonds',
    description: '60% equities, 40% bonds',
    fill: (symbols: string[]) => {
      const alloc: Record<string, number> = {};
      const stocks = symbols.filter(s => !['TLT', 'AGG', 'BND', 'IEF', 'LQD'].includes(s));
      const bonds = symbols.filter(s => ['TLT', 'AGG', 'BND', 'IEF', 'LQD'].includes(s));
      if (stocks.length) {
        const each = Math.round((60 / stocks.length) * 100) / 100;
        stocks.forEach(s => { alloc[s] = each; });
      }
      if (bonds.length) {
        const each = Math.round((40 / bonds.length) * 100) / 100;
        bonds.forEach(s => { alloc[s] = each; });
      }
      return alloc;
    },
  },
  '3fund': {
    label: '3-Fund Portfolio',
    description: 'US 60% / Intl 20% / Bonds 20%',
    fill: (symbols: string[]) => {
      const alloc: Record<string, number> = {};
      const us = symbols.filter(s => ['VTI', 'VOO', 'SPY', 'ITOT', 'SCHB'].includes(s));
      const intl = symbols.filter(s => ['VXUS', 'IXUS', 'SCHF', 'VEA'].includes(s));
      const bonds = symbols.filter(s => ['BND', 'AGG', 'TLT', 'IEF', 'LQD'].includes(s));
      if (us.length) {
        const each = Math.round((60 / us.length) * 100) / 100;
        us.forEach(s => { alloc[s] = each; });
      }
      if (intl.length) {
        const each = Math.round((20 / intl.length) * 100) / 100;
        intl.forEach(s => { alloc[s] = each; });
      }
      if (bonds.length) {
        const each = Math.round((20 / bonds.length) * 100) / 100;
        bonds.forEach(s => { alloc[s] = each; });
      }
      return alloc;
    },
  },
  equal: {
    label: 'Equal Weight',
    description: 'Equal allocation across all holdings',
    fill: (symbols: string[]) => {
      const alloc: Record<string, number> = {};
      if (symbols.length) {
        const each = Math.round((100 / symbols.length) * 100) / 100;
        symbols.forEach(s => { alloc[s] = each; });
      }
      return alloc;
    },
  },
};

interface Trade {
  symbol: string;
  name?: string;
  action: 'BUY' | 'SELL';
  shares: number;
  estimatedValue: number;
  currentPrice: number;
}

// ─── Component ──────────────────────────────────────────────

export default function RebalancingPage() {
  const router = useRouter();
  const { account, loading: portfolioLoading } = usePortfolio();
  const { isConnected } = useBroker();

  const positions = account?.positions ?? [];
  const totalValue = account?.equity ?? 0;
  const buyingPower = account?.buyingPower ?? 0;

  // Section 2: target allocations
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [addingSymbol, setAddingSymbol] = useState('');
  const [showAddAsset, setShowAddAsset] = useState(false);

  // Section 3: trade preview
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Section 4: alert toggle
  const [alertOnDrift, setAlertOnDrift] = useState(false);
  const [driftThreshold, setDriftThreshold] = useState(5);

  // Initialize targets from current positions
  useEffect(() => {
    if (positions.length && Object.keys(targets).length === 0) {
      const init: Record<string, number> = {};
      positions.forEach(p => {
        const pct = p.portfolioPercent ?? ((p.marketValue / totalValue) * 100);
        init[p.symbol] = Math.round(pct * 100) / 100;
      });
      setTargets(init);
    }
  }, [positions, totalValue]);

  // Derived values
  const symbolList = useMemo(() => {
    const set = new Set(positions.map(p => p.symbol));
    Object.keys(targets).forEach(s => set.add(s));
    return Array.from(set);
  }, [positions, targets]);

  const positionMap = useMemo(() => {
    const map: Record<string, typeof positions[0]> = {};
    positions.forEach(p => { map[p.symbol] = p; });
    return map;
  }, [positions]);

  const totalTarget = useMemo(() => {
    return Object.values(targets).reduce((s, v) => s + v, 0);
  }, [targets]);

  const isBalanced = Math.abs(totalTarget - 100) < 0.05;

  const trades = useMemo((): Trade[] => {
    if (!isBalanced || totalValue <= 0) return [];
    const result: Trade[] = [];
    symbolList.forEach(sym => {
      const pos = positionMap[sym];
      const currentPct = pos ? (pos.marketValue / totalValue) * 100 : 0;
      const targetPct = targets[sym] || 0;
      const diff = targetPct - currentPct;
      const price = pos?.currentPrice ?? 0;
      if (Math.abs(diff) < 0.1 || price <= 0) return; // skip tiny diffs
      const valueShift = (diff / 100) * totalValue;
      const shares = Math.abs(Math.round((Math.abs(valueShift) / price) * 100) / 100);
      if (shares < 0.01) return;
      result.push({
        symbol: sym,
        name: pos?.name,
        action: diff > 0 ? 'BUY' : 'SELL',
        shares,
        estimatedValue: Math.abs(valueShift),
        currentPrice: price,
      });
    });
    return result;
  }, [isBalanced, totalValue, symbolList, positionMap, targets]);

  const totalTradeValue = useMemo(() => trades.reduce((s, t) => s + t.estimatedValue, 0), [trades]);
  const hasAnyTrade = trades.length > 0;
  const hasOnlyMinorDrift = trades.every(t => {
    const pos = positionMap[t.symbol];
    if (!pos) return false;
    const currentPct = (pos.marketValue / totalValue) * 100;
    return Math.abs(currentPct - (targets[t.symbol] || 0)) < 1;
  });

  // ─── Handlers ────────────────────────────────────────────
  const handleTargetChange = (symbol: string, value: string) => {
    const num = value === '' ? 0 : parseFloat(value);
    if (isNaN(num)) return;
    setTargets(prev => ({ ...prev, [symbol]: Math.min(100, Math.max(0, num)) }));
  };

  const handleAddAsset = (symbol: string) => {
    if (!symbol || targetSelected(symbol)) return;
    setTargets(prev => ({ ...prev, [symbol.toUpperCase()]: 0 }));
    setAddingSymbol('');
    setShowAddAsset(false);
    setTimeout(() => {
      const el = document.getElementById(`target-${symbol.toUpperCase()}`);
      el?.focus();
    }, 100);
  };

  const targetSelected = (sym: string) => Object.keys(targets).includes(sym.toUpperCase());

  const removeTarget = (symbol: string) => {
    setTargets(prev => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  };

  const handleQuickFill = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    const filled = preset.fill(symbolList);
    setTargets(filled);
  };

  const handleSubmit = async () => {
    setConfirmOpen(true);
  };

  const executeRebalance = async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const body = {
        trades: trades.map(t => ({
          symbol: t.symbol,
          action: t.action === 'BUY' ? 'buy' : 'sell',
          shares: t.shares,
          estimatedValue: t.estimatedValue,
        })),
        targetAllocations: targets,
        alertOnDrift,
        driftThreshold,
      };

      const res = await fetch('/api/strategies/rebalancing/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        setToast(err.error || 'Rebalance failed');
        return;
      }

      setToast('✓ Rebalancing orders placed');
      setTimeout(() => router.back(), 1500);
    } catch {
      setToast('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#0f172a', color: '#f1f5f9', padding: '16px 16px 180px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, animation: 'dcaToastIn 0.25s ease-out' }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#f1f5f9', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 18px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmOpen && (
        <div onClick={() => setConfirmOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24, maxWidth: 360, width: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 12 }}>Confirm Rebalance</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
              This will place <strong style={{ color: '#f1f5f9' }}>{trades.length} trades</strong> totaling <strong style={{ color: '#f1f5f9' }}>${totalTradeValue.toFixed(2)}</strong>.
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 16 }}>
              {trades.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #1e293b', fontSize: 12, color: '#cbd5e1' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: t.action === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: t.action === 'BUY' ? '#4ade80' : '#f87171' }}>
                    {t.action}
                  </span>
                  <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                  <span style={{ color: '#94a3b8' }}>{t.shares} shares · ${t.estimatedValue.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #475569', background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={executeRebalance} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #06b6d4, #0d9488)', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Execute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button onClick={() => router.push('/strategies')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#06b6d4', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            View strategies →
          </button>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Portfolio Rebalancing</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Restore your target allocation</p>
      </div>

      {/* ─── Section 1: Current Portfolio ───────────── */}
      <Section icon={<Activity size={12} />} label="Current Portfolio">
        {portfolioLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>
            <div style={{ width: 16, height: 16, border: '2px solid #334155', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            Loading portfolio data...
          </div>
        ) : totalValue <= 0 || positions.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0', lineHeight: 1.6 }}>
            {!isConnected ? (
              <>
                No positions found. Connect your broker to see live holdings,<br />
                or use demo data to explore the rebalancing tool.
              </>
            ) : (
              'No positions found in your connected account.'
            )}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', marginBottom: 12 }}>
              Portfolio: ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.6fr 0.5fr', gap: 4, fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 8px', borderBottom: '1px solid #1e293b' }}>
              <span>Symbol</span>
              <span style={{ textAlign: 'right' }}>Value</span>
              <span style={{ textAlign: 'right' }}>Current %</span>
              <span style={{ textAlign: 'right' }}>Target %</span>
              <span style={{ textAlign: 'right' }}>Drift</span>
            </div>
            {positions.map(pos => {
              const currentPct = (pos.marketValue / totalValue) * 100;
              const targetPct = targets[pos.symbol] ?? currentPct;
              const drift = currentPct - targetPct;
              const driftColor = drift > 5 ? '#f87171' : drift < -5 ? '#4ade80' : '#94a3b8';
              return (
                <div key={pos.symbol} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.6fr 0.5fr', gap: 4, alignItems: 'center', padding: '8px', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{pos.symbol}</span>
                  <span style={{ textAlign: 'right', color: '#cbd5e1' }}>${pos.marketValue.toLocaleString()}</span>
                  <span style={{ textAlign: 'right', color: '#94a3b8' }}>{currentPct.toFixed(1)}%</span>
                  <span style={{ textAlign: 'right', color: '#06b6d4', fontWeight: 600 }}>{targetPct.toFixed(1)}%</span>
                  <span style={{ textAlign: 'right', color: driftColor, fontWeight: 600 }}>
                    {drift > 0 ? '+' : ''}{drift.toFixed(1)}%
                  </span>
                </div>
              );
            })}
            {/* Added assets not in portfolio */}
            {Object.keys(targets).filter(s => !positionMap[s]).map(sym => (
              <div key={sym} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.6fr 0.5fr', gap: 4, alignItems: 'center', padding: '8px', borderBottom: '1px solid #1e293b', fontSize: 12, opacity: 0.6 }}>
                <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{sym}</span>
                <span style={{ textAlign: 'right', color: '#64748b' }}>$0.00</span>
                <span style={{ textAlign: 'right', color: '#64748b' }}>0.0%</span>
                <span style={{ textAlign: 'right', color: '#06b6d4', fontWeight: 600 }}>{targets[sym].toFixed(1)}%</span>
                <span style={{ textAlign: 'right', color: '#4ade80', fontWeight: 600 }}>-{targets[sym].toFixed(1)}%</span>
              </div>
            ))}
          </>
        )}
      </Section>

      {/* ─── Section 2: Set Target Allocations ──────── */}
      <Section icon={<Layers size={12} />} label="Set Target Allocations">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {symbolList.map(sym => (
            <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', minWidth: 56 }}>{sym}</span>
              <input
                id={`target-${sym}`}
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={targets[sym] ?? 0}
                onChange={e => handleTargetChange(sym, e.target.value)}
                style={{ width: 60, padding: '6px 8px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 13, fontWeight: 600, textAlign: 'center', fontFamily: 'inherit' }}
              />
              <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
              {positionMap[sym] && (
                <span style={{ fontSize: 11, color: '#475569' }}>
                  (currently {((positionMap[sym].marketValue / totalValue) * 100).toFixed(1)}%)
                </span>
              )}
              {!positionMap[sym] && (
                <button onClick={() => removeTarget(sym)} style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10, fontWeight: 600, background: 'none', border: '1px solid #475569', borderRadius: 4, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add Asset */}
        {showAddAsset ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <SymbolSearch
                value={addingSymbol}
                onChange={handleAddAsset}
                placeholder="Search symbol..."
                positions={positions.map(p => p.symbol)}
              />
            </div>
            <button onClick={() => { setShowAddAsset(false); setAddingSymbol(''); }} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'none', border: '1px solid #475569', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕
            </button>
          </div>
        ) : (
          <button onClick={() => setShowAddAsset(true)} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: 'none', border: '1px dashed #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer', marginBottom: 12, fontFamily: 'inherit' }}>
            + Add Asset
          </button>
        )}

        {/* Running total */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#1e293b', border: `1px solid ${isBalanced ? '#22c55e' : '#ef4444'}`, borderRadius: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>Total Allocation</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: isBalanced ? '#4ade80' : '#f87171' }}>
            {totalTarget.toFixed(1)}%
          </span>
        </div>

        {/* Quick Presets */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Quick Presets</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              onClick={() => handleQuickFill(key)}
              style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, background: '#1e293b', border: '1px solid #334155', borderRadius: 9999, color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      {/* ─── Section 3: Rebalance Preview ───────────── */}
      {isBalanced && (
        <Section icon={<TrendingUp size={12} />} label="Rebalance Preview">
          {!hasAnyTrade ? (
            <div style={{ fontSize: 12, color: '#64748b', padding: '8px 0' }}>
              Portfolio is balanced — no trades needed.
            </div>
          ) : (
            <>
              {trades.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: t.action === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: t.action === 'BUY' ? '#4ade80' : '#f87171' }}>
                      {t.action}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{t.symbol}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: '#cbd5e1' }}>{t.shares} shares</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>~${t.estimatedValue.toFixed(2)}</div>
                  </div>
                </div>
              ))}

              {/* Summary */}
              <div style={{ padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>
                  <span>Total trades</span>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{trades.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
                  <span>Est. total value</span>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>${totalTradeValue.toFixed(2)}</span>
                </div>
              </div>

              {/* Warnings */}
              {trades.some(t => t.action === 'SELL') && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 11, color: '#fbbf24', display: 'flex', alignItems: 'flex-start', gap: 6, fontWeight: 500 }}>
                  <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  Selling may trigger capital gains taxes
                </div>
              )}
              {hasOnlyMinorDrift && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'flex-start', gap: 6, fontWeight: 500 }}>
                  <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  Minor drift — rebalancing may not be worth transaction costs
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {/* ─── Section 4: Rebalance Triggers ──────────── */}
      <Section icon={<AlertTriangle size={12} />} label="Rebalance Triggers">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>Alert me when drift exceeds</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={1}
              max={25}
              value={driftThreshold}
              onChange={e => setDriftThreshold(Math.max(1, Math.min(25, parseInt(e.target.value) || 5)))}
              disabled={!alertOnDrift}
              style={{ width: 40, padding: '4px 6px', background: alertOnDrift ? '#1e293b' : '#0f172a', border: '1px solid #334155', borderRadius: 4, color: alertOnDrift ? '#f1f5f9' : '#475569', fontSize: 13, fontWeight: 600, textAlign: 'center', fontFamily: 'inherit' }}
            />
            <span style={{ fontSize: 12, color: alertOnDrift ? '#94a3b8' : '#475569' }}>%</span>
            <button
              onClick={() => setAlertOnDrift(!alertOnDrift)}
              style={{
                padding: '4px 2px',
                width: 44,
                borderRadius: 9999,
                border: 'none',
                background: alertOnDrift ? '#06b6d4' : '#334155',
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', background: 'white',
                transform: alertOnDrift ? 'translateX(18px)' : 'translateX(0)',
                transition: 'transform 0.15s ease',
              }} />
            </button>
          </div>
        </div>
      </Section>

      {/* ─── Bottom Bar ────────────────────────────── */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'linear-gradient(to top, #0f172a 80%, rgba(15,23,42,0.95))', padding: '12px 16px 64px', borderTop: '1px solid #1e293b' }}>
        {/* Demo mode warning */}
        {!isConnected && (
          <div style={{ fontSize: 10, color: '#fbbf24', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Demo mode — connect broker to execute live trades
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleSubmit}
            disabled={!isBalanced || !hasAnyTrade || submitting || !isConnected}
            style={{
              flex: 1, padding: 14, borderRadius: 10, border: 'none',
              background: isBalanced && hasAnyTrade && !submitting && isConnected ? 'linear-gradient(135deg, #06b6d4, #0d9488)' : '#334155',
              color: isBalanced && hasAnyTrade && !submitting && isConnected ? '#0f172a' : '#64748b',
              fontSize: 15, fontWeight: 700,
              cursor: isBalanced && hasAnyTrade && !submitting && isConnected ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', transition: 'all 0.2s ease',
            }}
          >
            {submitting ? 'Executing...' : isConnected ? 'Approve & Rebalance' : 'Connect Broker to Execute'}
          </button>
          <button onClick={() => router.back()} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Cancel
          </button>
        </div>
      </div>

      <style>{`@keyframes dcaToastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Section Helper ─────────────────────────────────────────
function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}
