'use client';
import { useState } from 'react';
import { useMarketStore, useOrderFormStore } from '@/store';
import { useMarketData } from '@/hooks/useMarketData';
import { usePortfolio } from '@/hooks/usePortfolio';
import { SymbolSearch } from './SymbolSearch';

export function TradeTab() {
  const { quotes } = useMarketStore();
  const { form, updateForm } = useOrderFormStore();
  const { account } = usePortfolio();

  // Initialize hook
  useMarketData();

  // Default to largest position, or empty if no holdings
  const defaultSymbol = (() => {
    if (!account?.positions?.length) return '';
    const largest = account.positions.sort((a, b) => b.marketValue - a.marketValue)[0];
    return largest.symbol;
  })();
  const [searchSymbol, setSearchSymbol] = useState(defaultSymbol);

  const quote = quotes[searchSymbol.toUpperCase()];
  const isBuy = form.side === 'buy';
  const holdings = account?.positions?.map(p => p.symbol) || [];

  return (
    <div style={{ padding: '12px 16px 80px' }}>
      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <SymbolSearch
          value={searchSymbol}
          onChange={setSearchSymbol}
          positions={holdings}
        />
      </div>

      {/* Stock Card */}
      {quote && (
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

          {/* Mini chart placeholder */}
          <div className="chart-skeleton" style={{ height: 100, marginTop: 10, display: 'flex', alignItems: 'flex-end', padding: 8, gap: 3 }}>
            {[60, 65, 55, 75, 70, 80, 78, 72, 68, 55, 48, 42, 45, 40, 38].map((h, i) => (
              <div key={i} style={{ flex: 1, height: h, background: 'linear-gradient(180deg, #06b6d4, #0d9488)', borderRadius: 2, opacity: 0.7 }} />
            ))}
          </div>
        </div>
      )}

      {/* AI Suggestion */}
      <div className="ai-suggestion">
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d4, #0d9488)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>✨</div>
        <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>
          <strong style={{ color: '#06b6d4' }}>AI suggests:</strong> Limit buy at $375 with stop loss at $370 and take profit at $395. Position size: $500 for 1.2% portfolio allocation.
        </div>
      </div>

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

        {/* Summary */}
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {[
            ['Est. Cost', '$498.75'],
            ['Commission', '$0.00'],
            ['Max Loss', '-$6.65'],
            ['Max Gain', '+$26.60'],
            ['Risk/Reward', '1 : 4.0'],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: val.startsWith('+') ? '#4ade80' : val.startsWith('-') ? '#f87171' : '#f1f5f9' }}>
                {val}
              </span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #334155', paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Buying Power After</span>
            <span style={{ fontWeight: 700 }}>$24,001.25</span>
          </div>
        </div>

        {/* Submit */}
        <button
          style={{
            width: '100%', padding: 13, border: 'none', borderRadius: 10,
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: isBuy ? '#22c55e' : '#ef4444',
            color: 'white',
          }}
        >
          Review & Submit {isBuy ? 'Buy' : 'Sell'} Order
        </button>
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
      `}</style>
    </div>
  );
}
