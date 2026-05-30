'use client';
import { useState, useCallback, useEffect } from 'react';
import { useMarketStore, useOrderFormStore, useTabStore } from '@/store';
import { useMarketData } from '@/hooks/useMarketData';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { DemoBanner } from '@/components/shared/DemoBanner';
import { SymbolSearch } from './SymbolSearch';
import { addPendingDemoOrder } from '@/lib/demo-orders';
import StrategySheet from '@/components/StrategySheet';

export function TradeTab() {
  const { quotes } = useMarketStore();
  const { form, updateForm } = useOrderFormStore();
  const { account } = usePortfolio();
  const { isConnected } = useBroker();

  // Initialize hook
  useMarketData();

  // Default to empty — user picks a symbol
  const [searchSymbol, setSearchSymbol] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState('');

  const { setTab } = useTabStore();

  // ─── Strategy Bottom Sheet ───────────────────────────────
  const STRATEGY_ROWS = [
    ['dca', 'rebalance', 'momentum'],
    ['meanreversion', 'taxharvest'],
  ];
  const STRATEGY_LABELS: Record<string, { icon: string; label: string }> = {
    dca: { icon: '🔄', label: 'DCA' },
    rebalance: { icon: '⚖️', label: 'Rebalance' },
    momentum: { icon: '🚀', label: 'Momentum' },
    meanreversion: { icon: '📉', label: 'Mean Reversion' },
    taxharvest: { icon: '🧾', label: 'Tax Harvest' },
  };
  const [strategySheet, setStrategySheet] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeSheet = useCallback(() => setStrategySheet(null), []);

  // Disabled strategies — show "Soon" badge + toast, don't open sheet
  const DISABLED = new Set(['momentum', 'meanreversion']);

  // Auto-dismiss toast after 2s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);
  // ─── End Strategy Bottom Sheet ───────────────────────────

  const quote = quotes[searchSymbol.toUpperCase()];
  const isBuy = form.side === 'buy';
  const holdings = account?.positions?.map(p => p.symbol) || [];

  return (
    <div style={{ padding: '12px 16px 80px' }}>
      {!isConnected && <DemoBanner />}

      {/* 📊 Strategies */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          📊 Strategies
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {STRATEGY_ROWS.map((row, rowIdx) => (
            <div key={rowIdx} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {row.map((key) => {
                const isActive = strategySheet === key;
                const disabled = DISABLED.has(key);
                const s = STRATEGY_LABELS[key];
                return (
                  <button
                    key={key}
                    onClick={() => {
                      if (disabled) {
                        setToast('Coming in next update');
                        return;
                      }
                      setStrategySheet(key === strategySheet ? null : key);
                    }}
                    style={{
                      position: 'relative',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 14px',
                      borderRadius: 9999,
                      border: disabled ? '1px solid #475569' : '1.5px solid #06b6d4',
                      background: isActive && !disabled ? '#06b6d4' : '#1e293b',
                      color: disabled ? '#94a3b8' : isActive ? '#0f172a' : '#e2e8f0',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                      opacity: disabled ? 0.4 : 1,
                    }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>{s.icon}</span>
                    {s.label}
                    {disabled && (
                      <span
                        style={{
                          position: 'absolute',
                          top: -6,
                          right: -4,
                          fontSize: 8,
                          fontWeight: 700,
                          color: '#64748b',
                          background: '#1e293b',
                          padding: '1px 5px',
                          borderRadius: 4,
                          border: '1px solid #334155',
                          lineHeight: 1.4,
                          letterSpacing: 0.3,
                        }}
                      >
                        Soon
                      </span>
                    )}
                  </button>
                );
              })}
        </div>
      ))}
    </div>
      </div>

      {/* Toast for disabled strategies */}
      {toast && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 12,
            animation: 'toastIn 0.2s ease-out',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 600,
              color: '#64748b',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '6px 16px',
            }}
          >
            {toast}
          </span>
        </div>
      )}

      {/* Plan Trades with AI */}
      <button
        onClick={() => setTab('ai')}
        style={{
          width: '100%',
          padding: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'rgba(6, 182, 212, 0.1)',
          border: '1px dashed rgba(6, 182, 212, 0.3)',
          borderRadius: 8,
          color: '#06b6d4',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: 12,
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: 16 }}>📊</span>
        Plan Trades with AI
      </button>

      {/* ─── Divider ──────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          margin: '8px 0 16px',
        }}
      >
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, #334155)' }} />
        <span style={{ fontSize: 9, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5 }}>
          Research & Place Order
        </span>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, transparent, #334155)' }} />
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <SymbolSearch
          value={searchSymbol}
          onChange={(sym) => { setSearchSymbol(sym); updateForm({ symbol: sym }); }}
          onInputChange={(text) => setSearchSymbol(text)}
          positions={holdings}
        />
      </div>

      {/* Stock Card */}
      {searchSymbol && quote && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{quote.symbol}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Corporation</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>${quote.last.toFixed(2)}</div>
              <div className={quote.changePercent >= 0 ? 'up' : 'down'} style={{ fontSize: 12, fontWeight: 600 }}>
                {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, paddingTop: 10, borderTop: '1px solid #334155' }}>
            {[
              ['Bid', `$${quote.bid.toFixed(2)}`],
              ['Ask', `$${quote.ask.toFixed(2)}`],
              ['Volume', `${(quote.volume / 1e6).toFixed(1)}M`],
              ['52W H', `$${quote.high52w}`],
            ].map(([label, val]) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>{val}</div>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* AI Suggestion — contextual */}
      {quote && (
      <div className="ai-suggestion">
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d4, #0d9488)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>✨</div>
        <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>
          <strong style={{ color: '#06b6d4' }}>{quote.symbol}</strong> — ${quote.last.toFixed(2)} · {' '}
          {quote.changePercent >= 0 ? '↑' : '↓'} {Math.abs(quote.changePercent).toFixed(2)}% today
          {quote.bid && quote.ask && <span> · Spread ${(quote.ask - quote.bid).toFixed(2)}</span>}
        </div>
      </div>
      )}

      {/* Order Form */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Place Order</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Buying Power: $24,500</span>
        </div>

        {/* Buy/Sell Toggle */}
        <div style={{ display: 'flex', background: '#0f172a', borderRadius: 8, padding: 3, marginBottom: 12 }}>
          {(['buy', 'sell'] as const).map((side) => (
            <button
              key={side}
              onClick={() => updateForm({ side })}
              style={{
                flex: 1, padding: '9px', border: 'none', background: 'transparent',
                color: form.side === side ? 'white' : '#94a3b8',
                fontWeight: 700, fontSize: 13, cursor: 'pointer', borderRadius: 6,
                ...(form.side === side ? { background: side === 'buy' ? '#22c55e' : '#ef4444' } : {}),
              }}
            >
              {side === 'buy' ? 'BUY' : 'SELL'}
            </button>
          ))}
        </div>

        {/* Order Type */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Order Type
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {(['market', 'limit', 'stop'] as const).map((t) => (
              <button
                key={t}
                onClick={() => updateForm({ type: t })}
                style={{
                  padding: '7px 4px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  background: form.type === t ? 'rgba(6,182,212,0.2)' : '#0f172a',
                  border: `1px solid ${form.type === t ? '#06b6d4' : '#334155'}`,
                  borderRadius: 6, color: form.type === t ? '#06b6d4' : '#cbd5e1',
                }}
              >
                {t === 'market' ? 'Market' : t === 'limit' ? 'Limit' : 'Stop'}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Quantity
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ display: 'flex', background: '#0f172a', borderRadius: 6, padding: 2 }}>
              {(['shares', 'dollars'] as const).map((qt) => (
                <button
                  key={qt}
                  onClick={() => updateForm({ qtyType: qt })}
                  style={{
                    padding: '6px 10px', background: form.qtyType === qt ? '#06b6d4' : 'transparent',
                    border: 'none', color: form.qtyType === qt ? 'white' : '#94a3b8',
                    fontSize: 11, cursor: 'pointer', borderRadius: 4, fontWeight: 600,
                  }}
                >
                  {qt === 'shares' ? 'Shares' : 'Dollars'}
                </button>
              ))}
            </div>
            <input
              type="number"
              value={form.qty || ''}
              onChange={(e) => updateForm({ qty: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              style={{
                flex: 1, background: '#0f172a', border: '1px solid #334155',
                borderRadius: 8, padding: '9px 11px', color: '#f1f5f9',
                fontSize: 13, outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Limit Price */}
        {form.type === 'limit' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Limit Price
            </label>
            <input
              type="number"
              value={form.limitPrice || ''}
              onChange={(e) => updateForm({ limitPrice: parseFloat(e.target.value) || undefined })}
              placeholder="$0.00"
              style={{
                width: '100%', background: '#0f172a', border: '1px solid #334155',
                borderRadius: 8, padding: '9px 11px', color: '#f1f5f9',
                fontSize: 13, outline: 'none',
              }}
            />
          </div>
        )}

        {/* TIF */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Time in Force
          </label>
          <select
            value={form.timeInForce}
            onChange={(e) => updateForm({ timeInForce: e.target.value as any })}
            style={{
              width: '100%', background: '#0f172a', border: '1px solid #334155',
              borderRadius: 8, padding: '9px 11px', color: '#f1f5f9',
              fontSize: 13, outline: 'none', appearance: 'none', cursor: 'pointer',
            }}
          >
            <option value="day">Day</option>
            <option value="gtc">Good Till Canceled (GTC)</option>
            <option value="ioc">Immediate or Cancel (IOC)</option>
            <option value="fok">Fill or Kill (FOK)</option>
          </select>
        </div>

        {/* Bracket Order Toggle */}
        <div
          onClick={() => updateForm({ bracketOrder: !form.bracketOrder })}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 10, background: '#0f172a', borderRadius: 8, marginBottom: 12,
            cursor: 'pointer',
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: '#f1f5f9', fontWeight: 600 }}>Bracket Order</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stop loss + take profit</div>
          </div>
          <div style={{
            width: 32, height: 18, borderRadius: 9,
            background: form.bracketOrder ? '#06b6d4' : '#334155',
            position: 'relative', transition: 'background 0.2s',
          }}>
            <div style={{
              width: 14, height: 14, background: 'white', borderRadius: '50%',
              position: 'absolute', top: 2,
              left: form.bracketOrder ? 16 : 2,
              transition: 'left 0.2s',
            }} />
          </div>
        </div>

        {/* Bracket Fields */}
        {form.bracketOrder && (
          <div style={{ padding: 10, background: '#0f172a', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Stop Loss
                </label>
                <input
                  type="number"
                  placeholder="$0.00"
                  onChange={(e) => updateForm({ stopLoss: parseFloat(e.target.value) || undefined })}
                  style={{
                    width: '100%', background: '#1e293b', border: '1px solid #334155',
                    borderRadius: 6, padding: '8px 10px', color: '#f1f5f9',
                    fontSize: 13, outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Take Profit
                </label>
                <input
                  type="number"
                  placeholder="$0.00"
                  onChange={(e) => updateForm({ takeProfit: parseFloat(e.target.value) || undefined })}
                  style={{
                    width: '100%', background: '#1e293b', border: '1px solid #334155',
                    borderRadius: 6, padding: '8px 10px', color: '#f1f5f9',
                    fontSize: 13, outline: 'none',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Summary — only when a symbol is selected */}
        {searchSymbol && quote ? (
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {[
            ['Est. Cost', `$${(form.qty * quote.last).toFixed(2)}`],
            ['Commission', '$0.00'],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: '#f1f5f9' }}>
                {val}
              </span>
            </div>
          ))}
        </div>
        ) : (
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>Buying Power</span>
            <span style={{ fontWeight: 600, color: '#f1f5f9' }}>$24,500</span>
          </div>
        </div>
        )}

        {/* Submit */}
        <button
          onClick={async () => {
            const sym = searchSymbol?.trim() || form.symbol;
            if (!sym) { setOrderError('Select a symbol first'); return; }
            setSubmitting(true);
            setOrderError('');
            setOrderSuccess('');
            try {
              const qty = form.qtyType === 'dollars' && quote ? Math.floor(form.qty / quote.last) : form.qty;
              if (!qty || qty <= 0) { setOrderError('Enter a valid quantity'); setSubmitting(false); return; }

              // ─── Demo mode: store locally as pending ──────────
              if (!isConnected) {
                const price = quote?.last ?? 0;
                const totalValue = qty * price;
                const demoOrder: any = {
                  id: `demo-${sym.toUpperCase()}-${Date.now()}`,
                  symbol: sym.toUpperCase(),
                  side: form.side,
                  type: form.type,
                  status: 'pending',
                  qty,
                  filledQty: 0,
                  limitPrice: form.type === 'limit' ? form.limitPrice : undefined,
                  fillPrice: undefined,
                  totalValue: form.type === 'market' ? totalValue : undefined,
                  timeInForce: form.timeInForce,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                addPendingDemoOrder(demoOrder);
                setOrderSuccess('✓ Order accepted · Will execute when market opens');
                updateForm({ qty: 0, limitPrice: undefined, stopPrice: undefined, stopLoss: undefined, takeProfit: undefined });
                setSubmitting(false);
                return;
              }

              // ─── Connected mode: proxy to Alpaca ─────────────
              const body: any = {
                symbol: sym.toUpperCase(),
                qty,
                side: form.side,
                type: form.type,
                time_in_force: form.timeInForce,
              };
              if (form.type === 'limit' && form.limitPrice) body.limit_price = form.limitPrice;
              if (form.type === 'stop' && form.stopPrice) body.stop_price = form.stopPrice;
              if (form.bracketOrder) {
                body.order_class = 'bracket';
                if (form.takeProfit) body.take_profit = { limit_price: form.takeProfit };
                if (form.stopLoss) body.stop_loss = { stop_price: form.stopLoss };
              }
              const res = await fetch('/api/alpaca/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              const json = await res.json();
              if (res.ok) {
                setOrderSuccess(`✓ ${form.side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${sym.toUpperCase()} @ ${form.type}`);
                updateForm({ qty: 0, limitPrice: undefined, stopPrice: undefined, stopLoss: undefined, takeProfit: undefined });
              } else {
                setOrderError(json.error || json.message || 'Order failed');
              }
            } catch (e: any) {
              setOrderError(e.message || 'Network error');
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
          style={{
            width: '100%', padding: 13, border: 'none', borderRadius: 10,
            fontWeight: 700, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer',
            background: submitting ? '#334155' : isBuy ? '#22c55e' : '#ef4444',
            color: submitting ? '#94a3b8' : 'white',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Submitting...' : `Review & Submit ${isBuy ? 'Buy' : 'Sell'} Order`}
        </button>
        {orderError && <div style={{ marginTop: 8, fontSize: 11, color: '#f87171', textAlign: 'center', padding: '6px 10px', background: 'rgba(248,113,113,0.1)', borderRadius: 6 }}>{orderError}</div>}
        {orderSuccess && <div style={{ marginTop: 8, fontSize: 11, color: '#4ade80', textAlign: 'center', padding: '6px 10px', background: 'rgba(74,222,128,0.1)', borderRadius: 6 }}>{orderSuccess}</div>}
      </div>

      <style jsx>{`
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 14px;
        }
        .ai-suggestion {
          background: linear-gradient(135deg, rgba(6,182,212,0.1), rgba(13,148,136,0.05));
          border: 1px solid rgba(6,182,212,0.3);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 12px;
          display: flex;
          gap: 8px;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes toastIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <StrategySheet
        strategy={strategySheet}
        onClose={closeSheet}
        onExecute={closeSheet}
      />
    </div>
  );
}
