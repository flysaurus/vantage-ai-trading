'use client';
import { useState, useEffect } from 'react';

const DEMO_ORDERS = [
  { id: '1', symbol: 'META', side: 'buy', status: 'filled', qty: 25, price: 593.02, date: 'Jun 1 · 2:14 PM' },
  { id: '2', symbol: 'NVDA', side: 'buy', status: 'filled', qty: 30, price: 205.10, date: 'May 28 · 10:33 AM' },
  { id: '3', symbol: 'GOOGL', side: 'buy', status: 'filled', qty: 45, price: 368.53, date: 'May 15 · 9:45 AM' },
  { id: '4', symbol: 'AMZN', side: 'buy', status: 'filled', qty: 60, price: 246.03, date: 'May 10 · 11:20 AM' },
  { id: '5', symbol: 'CRM', side: 'sell', status: 'open', qty: 20, price: undefined, date: 'Today · pending' },
  { id: '6', symbol: 'NFLX', side: 'buy', status: 'cancelled', qty: 10, price: 85.00, date: 'Apr 22 · 3:45 PM' },
];

const statusBorder: Record<string, string> = {
  filled_buy: '#10b981',
  filled_sell: '#ef4444',
  open: '#f59e0b',
  cancelled: '#475569',
};

function getBorderColor(order: typeof DEMO_ORDERS[number]) {
  if (order.status === 'filled') return order.side === 'buy' ? '#10b981' : '#ef4444';
  if (order.status === 'open') return '#f59e0b';
  return '#475569';
}

function getStatusStyle(status: string) {
  if (status === 'filled') return { color: '#10b981' };
  if (status === 'open') return { color: '#f59e0b' };
  return { color: '#475569' };
}

export function TradeTab() {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>('market');
  const [qtyType, setQtyType] = useState<'shares' | 'dollars'>('shares');
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [tif, setTif] = useState<'day' | 'gtc'>('day');
  const [historyTab, setHistoryTab] = useState<'filled' | 'open' | 'cancelled' | 'all'>('filled');

  // ─── Symbol search state ───
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    { symbol: string; description: string; type: string }[]
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(
          `/api/finnhub/search?q=${encodeURIComponent(searchQuery)}`
        );
        const data = await res.json();
        const filtered = (data.result || [])
          .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP')
          .slice(0, 8);
        setSearchResults(filtered);
        setShowResults(true);
      } catch (e) {
        console.error(e);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredOrders = DEMO_ORDERS.filter(o => {
    if (historyTab === 'all') return true;
    return o.status === historyTab;
  });

  return (
    <div style={{ paddingBottom: '120px' }} onClick={() => setShowResults(false)}>

      {/* ─── 1. SYMBOL SEARCH BAR ─── */}
      <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
        <div style={{
          margin: '16px 16px 0 16px',
          background: '#1a2235',
          border: '1px solid #2a3448',
          borderRadius: '10px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ color: '#64748b', fontSize: '16px' }}>🔍</span>
          <input
            placeholder="Search symbol..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#ffffff',
              fontSize: '15px',
              flex: 1
            }}
          />
        </div>

        {/* Search Results Dropdown */}
        {showResults && searchResults.length > 0 && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% - 16px)',
            left: '16px',
            right: '16px',
            background: '#1a2235',
            border: '1px solid #2a3448',
            borderRadius: '10px',
            marginTop: '4px',
            zIndex: 100,
            overflow: 'hidden'
          }}>
            {searchLoading && (
              <div style={{ padding: '12px 16px', color: '#64748b', fontSize: '13px' }}>
                Searching...
              </div>
            )}
            {searchResults.map((r, i) => (
              <div
                key={r.symbol}
                onClick={() => {
                  setSelectedSymbol(r.symbol);
                  setSearchQuery(r.symbol);
                  setShowResults(false);
                }}
                style={{
                  padding: '12px 16px',
                  borderBottom: i < searchResults.length - 1 ? '1px solid #2a3448' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff' }}>
                    {r.symbol}
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>
                    {r.description}
                  </span>
                </div>
                <span style={{
                  fontSize: '11px',
                  color: '#334155',
                  background: '#0f1829',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  {r.type === 'ETP' ? 'ETF' : 'Stock'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Symbol Indicator */}
      {selectedSymbol && (
        <div style={{
          padding: '8px 16px',
          margin: '8px 16px 0 16px',
          background: '#1e3a5f',
          border: '1px solid #22d3ee',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ color: '#22d3ee', fontWeight: '700', fontSize: '14px' }}>
            {selectedSymbol}
          </span>
          <button
            onClick={() => { setSelectedSymbol(''); setSearchQuery(''); setSearchResults([]); }}
            style={{ color: '#64748b', background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', padding: '0 4px' }}
          >
            ×
          </button>
        </div>
      )}

      {/* ─── 2. PLACE ORDER FORM ─── */}
      <div style={{
        margin: '16px',
        background: '#1a2235',
        border: '1px solid #2a3448',
        borderRadius: '12px',
        padding: '20px'
      }}>
        <div style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.1em', marginBottom: '16px' }}>
          PLACE ORDER
        </div>

        {/* BUY / SELL toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['buy', 'sell'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSide(s)}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: '8px',
                border: side === s ? 'none' : '1px solid #2a3448',
                background: side === s ? (s === 'buy' ? '#10b981' : '#ef4444') : '#0f1829',
                color: side === s ? '#ffffff' : '#64748b',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {s === 'buy' ? 'BUY' : 'SELL'}
            </button>
          ))}
        </div>

        {/* ORDER TYPE */}
        <div style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.1em', marginBottom: '8px' }}>
          ORDER TYPE
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['market', 'limit', 'stop'] as const).map(t => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: '8px',
                border: orderType === t ? '1px solid #22d3ee' : '1px solid #2a3448',
                background: orderType === t ? '#1e3a5f' : '#0f1829',
                color: orderType === t ? '#22d3ee' : '#64748b',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              {t === 'market' ? 'Market' : t === 'limit' ? 'Limit' : 'Stop'}
            </button>
          ))}
        </div>

        {/* QUANTITY */}
        <div style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.1em', marginBottom: '8px' }}>
          QUANTITY
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {(['shares', 'dollars'] as const).map(qt => (
            <button
              key={qt}
              onClick={() => setQtyType(qt)}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: '8px',
                border: qtyType === qt ? '1px solid #22d3ee' : '1px solid #2a3448',
                background: qtyType === qt ? '#1e3a5f' : '#0f1829',
                color: qtyType === qt ? '#22d3ee' : '#64748b',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              {qt === 'shares' ? 'Shares' : 'Dollars'}
            </button>
          ))}
        </div>
        <input
          type="number"
          placeholder="0"
          value={qty}
          onChange={e => setQty(e.target.value)}
          style={{
            width: '100%',
            background: '#0f1829',
            border: '1px solid #2a3448',
            borderRadius: '8px',
            padding: '14px 16px',
            color: '#ffffff',
            fontSize: '24px',
            fontWeight: '600',
            outline: 'none',
            marginBottom: '20px',
            boxSizing: 'border-box'
          }}
        />

        {/* LIMIT PRICE */}
        {(orderType === 'limit' || orderType === 'stop') && (
          <>
            <div style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.1em', marginBottom: '8px' }}>
              LIMIT PRICE
            </div>
            <input
              type="number"
              placeholder="0.00"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              style={{
                width: '100%',
                background: '#0f1829',
                border: '1px solid #2a3448',
                borderRadius: '8px',
                padding: '14px 16px',
                color: '#ffffff',
                fontSize: '18px',
                fontWeight: '600',
                outline: 'none',
                marginBottom: '20px',
                boxSizing: 'border-box'
              }}
            />
          </>
        )}

        {/* TIME IN FORCE */}
        <div style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.1em', marginBottom: '8px' }}>
          TIME IN FORCE
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['day', 'gtc'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTif(t)}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: '8px',
                border: tif === t ? '1px solid #22d3ee' : '1px solid #2a3448',
                background: tif === t ? '#1e3a5f' : '#0f1829',
                color: tif === t ? '#22d3ee' : '#64748b',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              {t === 'day' ? 'Day' : 'GTC'}
            </button>
          ))}
        </div>

        {/* Est. value */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ color: '#64748b', fontSize: '13px' }}>Est. value</span>
          <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: '600' }}>$0.00</span>
        </div>

        {/* Buying Power */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <span style={{ color: '#64748b', fontSize: '13px' }}>Buying Power</span>
          <span style={{ color: '#94a3b8', fontSize: '13px' }}>$145,217.48</span>
        </div>

        {/* Limit/Stop advisory */}
        {(orderType === 'limit' || orderType === 'stop') && (
          <div style={{
            background: 'rgba(34,211,238,0.08)',
            border: '1px solid rgba(34,211,238,0.2)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px'
          }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.5' }}>
              ℹ️ For advanced limit and stop orders, review your order carefully before submitting.
            </div>
          </div>
        )}

        {/* PLACE ORDER BUTTON */}
        <button
          style={{
            width: '100%',
            padding: '16px',
            background: side === 'buy' ? '#10b981' : '#ef4444',
            border: 'none',
            borderRadius: '10px',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: '700',
            cursor: 'pointer'
          }}
        >
          Place Order
        </button>
      </div>

      {/* ─── 3. STRATEGIES SECTION ─── */}
      <div style={{ margin: '0 16px 16px 16px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.1em', marginBottom: '12px' }}>
          STRATEGIES
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          {['DCA', 'Rebalance', 'Tax Harvest'].map(name => (
            <div
              key={name}
              style={{
                background: '#1a2235',
                border: '1px solid #2a3448',
                borderRadius: '8px',
                padding: '12px 8px',
                textAlign: 'center',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              {name}
            </div>
          ))}
          {['Momentum', 'Mean Rev.'].map(name => (
            <div
              key={name}
              style={{
                background: '#0f1829',
                border: '1px solid #1e2d45',
                borderRadius: '8px',
                padding: '12px 8px',
                textAlign: 'center',
                color: '#334155',
                fontSize: '12px',
                cursor: 'not-allowed',
                position: 'relative'
              }}
            >
              {name}
              <span style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                background: '#1e3a5f',
                color: '#22d3ee',
                fontSize: '9px',
                borderRadius: '4px',
                padding: '1px 4px'
              }}>
                Soon
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── 4. ORDER HISTORY ─── */}
      <div style={{ margin: '0 16px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.1em', marginBottom: '12px' }}>
          ORDER HISTORY
        </div>

        {/* History tabs */}
        <div style={{ display: 'flex', marginBottom: '12px' }}>
          {([
            { key: 'open', label: 'Open' },
            { key: 'filled', label: 'Filled ✓' },
            { key: 'cancelled', label: 'Cancelled' },
            { key: 'all', label: 'All' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setHistoryTab(tab.key)}
              style={{
                fontSize: '13px',
                padding: '8px 12px',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                borderBottom: historyTab === tab.key ? '2px solid #22d3ee' : '2px solid transparent',
                color: historyTab === tab.key ? '#22d3ee' : '#64748b'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Order cards */}
        {filteredOrders.map(order => (
          <div
            key={order.id}
            style={{
              background: '#1a2235',
              border: '1px solid #2a3448',
              borderLeft: `3px solid ${getBorderColor(order)}`,
              borderRadius: '8px',
              padding: '14px 16px',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            {/* LEFT */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff' }}>
                  {order.symbol}
                </span>
                <span style={{
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  fontWeight: '600',
                  background: order.side === 'buy' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                  color: order.side === 'buy' ? '#10b981' : '#ef4444'
                }}>
                  {order.side.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                market · {order.qty} shares
              </div>
            </div>

            {/* RIGHT */}
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: '11px',
                fontWeight: '600',
                textTransform: 'uppercase',
                ...getStatusStyle(order.status)
              }}>
                {order.status.toUpperCase()}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                {order.price ? `$${order.price.toFixed(2)}/share` : 'pending'}
              </div>
              <div style={{ fontSize: '11px', color: '#475569' }}>
                {order.date}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── 5. Bottom spacer ─── */}
      <div style={{ height: '80px' }} />
    </div>
  );
}
