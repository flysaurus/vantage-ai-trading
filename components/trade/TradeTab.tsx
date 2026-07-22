'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLivePortfolio } from '@/context/PortfolioContext';
import { useTabStore } from '@/store';
import BuildBasketModal from '@/components/BuildBasketModal';
import { useAuth } from '@/components/providers/AuthProvider';
import { onBasketCreated } from '@/lib/gamification/events';
import { getMarketStatus } from '@/lib/market-hours';
import BasketActionPanel from '@/components/basket/BasketActionPanel';

const DEMO_ORDERS = [
  { id: '1', symbol: 'SPY', side: 'buy', status: 'filled', qty: 25, price: 480.00, date: 'Jan 8, 2024' },
  { id: '2', symbol: 'QQQ', side: 'buy', status: 'filled', qty: 20, price: 415.00, date: 'Jan 8, 2024' },
  { id: '3', symbol: 'GOOGL', side: 'buy', status: 'filled', qty: 60, price: 140.00, date: 'Jan 15, 2024' },
  { id: '4', symbol: 'MSFT', side: 'buy', status: 'filled', qty: 20, price: 415.00, date: 'Feb 5, 2024' },
  { id: '5', symbol: 'JPM', side: 'buy', status: 'filled', qty: 45, price: 195.00, date: 'Feb 20, 2024' },
  { id: '6', symbol: 'ADBE', side: 'buy', status: 'filled', qty: 12, price: 560.00, date: 'Mar 1, 2024' },
  { id: '7', symbol: 'ISRG', side: 'buy', status: 'filled', qty: 8, price: 395.00, date: 'Apr 12, 2024' },
  { id: '8', symbol: 'COST', side: 'buy', status: 'filled', qty: 10, price: 720.00, date: 'May 3, 2024' },
  { id: '9', symbol: 'LLY', side: 'buy', status: 'filled', qty: 18, price: 750.00, date: 'Jun 18, 2024' },
  { id: '10', symbol: 'NVDA', side: 'buy', status: 'filled', qty: 80, price: 108.00, date: 'Aug 15, 2024' },
  { id: '11', symbol: 'CRM', side: 'sell', status: 'open', qty: 20, price: undefined, date: 'Today · pending' },
  { id: '12', symbol: 'NFLX', side: 'buy', status: 'cancelled', qty: 10, price: 85.00, date: 'Apr 22, 2024' },
];

const statusBorder: Record<string, string> = {
  filled_buy: '#10b981',
  filled_sell: '#ef4444',
  open: '#f59e0b',
  cancelled: '#475569',
};

function getBorderColor(order: any): string {
  const side = (order.side || '').toUpperCase();
  if (order.status === 'filled') return side === 'BUY' ? '#10b981' : '#ef4444';
  if (order.status === 'open') return '#f59e0b';
  return '#475569';
}

function getStatusStyle(status: string) {
  if (status === 'filled') return { color: '#10b981' };
  if (status === 'open') return { color: '#f59e0b' };
  return { color: '#94a3b8' };
}

function formatQuoteDate(ts: number) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

export function TradeTab() {
  const { user } = useAuth();
  const { setTab: setActiveTab } = useTabStore();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop' | 'stop_limit'>('market');
  const [qtyType, setQtyType] = useState<'shares' | 'dollars'>('shares');
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [tif, setTif] = useState<'day' | 'gtc'>('day');
  const [historyTab, setHistoryTab] = useState<'filled' | 'open' | 'cancelled' | 'all'>('filled');
  const [showBuildBasket, setShowBuildBasket] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<{ orderId: string; symbol: string; side: string; shares: number; price: number } | null>(null);
  const [expandedBasketOrder, setExpandedBasketOrder] = useState<string | null>(null);
  const [confirmCancelBasket, setConfirmCancelBasket] = useState<{ basketOrderId: string; basketDisplayName: string; orderCount: number; totalReserved: number } | null>(null);
  const [editingBasket, setEditingBasket] = useState<any>(null);

  // ─── Symbol search state ───
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    { symbol: string; description: string; type: string }[]
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [selectedResult, setSelectedResult] = useState<{ description: string; type: string } | null>(null);
  const skipSearchRef = useRef(false);

  // ─── Symbol quote state ───
  const [symbolQuote, setSymbolQuote] = useState<{
    price: number;
    change: number;
    changePct: number;
    description: string;
    type: string;
    dayHigh: number;
    dayLow: number;
    open: number;
    prevClose: number;
    volume: number;
    weekHigh52: number;
    weekLow52: number;
    lastTradeTime: number;
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const { account, executeTrade, demoOrders: liveOrders, basketOrders: liveBasketOrders, pendingBaskets, baskets, cancelOrder, cancelBasketOrder, executePendingOrders, toast, dismissToast } = useLivePortfolio();

  // Fetch quote when symbol selected
  useEffect(() => {
    if (!selectedSymbol || !selectedResult) return;
    let cancelled = false;
    const fetchQuote = async () => {
      setQuoteLoading(true);
      try {
        const [quoteRes, metricRes] = await Promise.all([
          fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(selectedSymbol)}`),
          fetch(`/api/finnhub/metric?symbol=${encodeURIComponent(selectedSymbol)}`)
        ]);
        const quote = await quoteRes.json();
        const metric = await metricRes.json();
        if (cancelled) return;
        setSymbolQuote({
          price: quote.c ?? 0,
          change: quote.d ?? 0,
          changePct: quote.dp ?? 0,
          description: selectedResult.description,
          type: selectedResult.type,
          dayHigh: quote.h ?? 0,
          dayLow: quote.l ?? 0,
          open: quote.o ?? 0,
          prevClose: quote.pc ?? 0,
          volume: quote.v ?? 0,
          weekHigh52: metric?.metric?.['52WeekHigh'] ?? 0,
          weekLow52: metric?.metric?.['52WeekLow'] ?? 0,
          lastTradeTime: quote.t ?? 0,
        });
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };
    fetchQuote();
    return () => { cancelled = true; };
  }, [selectedSymbol, selectedResult]);

  // Debounced search
  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
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
          .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'ETF' || r.type === 'ADR' || r.type === 'REIT')
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

  // Use live orders from PortfolioContext if available, fall back to demo seed
  const displayOrders = liveOrders.length > 0 ? liveOrders : DEMO_ORDERS;
  
  // Execute pending orders on tab mount + periodic check while market is open
  // Two-pronged: local DemoBroker (fast, primary) + server API (reliable fallback)
  useEffect(() => {
    const doServerExec = async () => {
      try {
        await fetch('/api/cron/trigger-execution');
      } catch {
        // silent — server exec is a best-effort fallback
      }
    };
    executePendingOrders();
    doServerExec();
    const interval = setInterval(() => {
      if (getMarketStatus().isOpen) {
        executePendingOrders();
        doServerExec();
      }
    }, 120000); // every 2 min while market is open
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for sub-tab navigation (e.g. from basket success screen)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.subTab === 'open') {
        setHistoryTab('open');
      }
    };
    window.addEventListener('vantage-set-subtab', handler);
    return () => window.removeEventListener('vantage-set-subtab', handler);
  }, []);

  // Load pending baskets from localStorage, computing real status from broker orders.
  // Basket status must be derived from the actual order state (order_history via context),
  // never from a stale localStorage field that was set at submission time.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('vantage_pending_baskets');
      if (!raw) { return; }

      const all: any[] = JSON.parse(raw);

      // ── Source A: basket-level orders from broker (liveBasketOrders) ──
      // These are the canonical "did this basket fill?" records.
      // Build sets from BOTH basketId (user-facing) AND id (basketOrderId UUID) —
      // old broker saves may not have basketId set on the BrokerBasketOrder.
      const norm = (s: any) => String(s || '').toUpperCase();
      const filledBasketIds = new Set<string>();
      const cancelledBasketIds = new Set<string>();
      for (const bo of (liveBasketOrders || [])) {
        const s = norm(bo.status);
        if (s === 'FILLED') {
          if (bo.basketId) filledBasketIds.add(bo.basketId);
          if (bo.id) filledBasketIds.add(bo.id);
        } else if (s === 'CANCELLED') {
          if (bo.basketId) cancelledBasketIds.add(bo.basketId);
          if (bo.id) cancelledBasketIds.add(bo.id);
        }
      }

      // ── Source B: individual orders from broker (liveOrders) ──
      // Fallback for baskets whose BrokerBasketOrder isn't in liveBasketOrders yet.
      const ordersByBasket: Record<string, { filled: number; total: number }> = {};
      for (const order of (liveOrders || [])) {
        const bid = order.basketId || order.basketOrderId;
        if (!bid) continue;
        if (!ordersByBasket[bid]) ordersByBasket[bid] = { filled: 0, total: 0 };
        ordersByBasket[bid].total++;
        if (norm(order.status) === 'FILLED') ordersByBasket[bid].filled++;
      }

      const stillPending: any[] = [];
      let changed = false;

      for (const basket of all) {
        const bid = basket.basketId || basket.id;

        // Check basket-level order FIRST (canonical source).
        // Match against BOTH bid (basketId) and basket.id (UUID) —
        // the filledBasketIds set contains both from BrokerBasketOrder entries.
        const isFilled = filledBasketIds.has(bid) || filledBasketIds.has(basket.id);
        const isCancelled = cancelledBasketIds.has(bid) || cancelledBasketIds.has(basket.id);
        if (isFilled || isCancelled) {
          changed = true;
          continue; // Basket filled/cancelled → remove from pending
        }

        // Fall back to individual order check
        const info = ordersByBasket[bid];

        if (!info || info.total === 0) {
          // No broker orders found yet → still pending
          stillPending.push(basket);
          continue;
        }

        if (info.filled === info.total) {
          // All orders FILLED → basket complete, remove from pending
          changed = true;
          continue;
        }

        if (info.filled > 0) {
          // Partial fill
          changed = true;
          stillPending.push({ ...basket, computedStatus: 'PARTIAL', filledCount: info.filled, totalCount: info.total });
          continue;
        }

        // No fills yet → still pending
        stillPending.push(basket);
      }

      // Compute which baskets are still pending for localStorage cleanup below

      // Clean up localStorage: remove filled/cancelled baskets
      if (changed) {
        const clean = all.filter(b => {
          const bid2 = b.basketId || b.id;
          if (filledBasketIds.has(bid2) || filledBasketIds.has(b.id) ||
              cancelledBasketIds.has(bid2) || cancelledBasketIds.has(b.id)) return false;
          const info = ordersByBasket[bid2];
          return !(info && info.filled === info.total);
        });
        localStorage.setItem('vantage_pending_baskets', JSON.stringify(clean));
      }
    } catch {
      // localStorage parse error — ignore
    }
  }, [baskets, liveOrders, liveBasketOrders]); // re-check when broker orders change

  // ── Normalize orders for rendering (handles both DemoOrder and DEMO_ORDERS format)
  const normalizedOrders = displayOrders.map((o: any) => ({
    id: o.id,
    symbol: o.symbol,
    side: (o.side || '').toUpperCase(),
    status: (o.status || '').toLowerCase(),
    shares: o.shares ?? o.qty ?? 0,
    price: o.fillPrice ?? o.price ?? 0,
    submittedPrice: o.submittedPrice ?? o.fillPrice ?? o.price ?? 0,
    date: o.createdAt ?? o.date ?? '',
    note: o.note ?? '',
    reservedCost: o.reservedCost,
    fillPrice: o.fillPrice,
    totalCost: o.totalCost,
    basketId: o.basketId,
    basketOrderId: o.basketOrderId,
    basketName: o.basketName,
    basketEmoji: o.basketEmoji,
    submittedAt: o.submittedAt,
  }));

  const filteredOrders = normalizedOrders.filter((o: any) => {
    if (historyTab === 'all') return true;
    return o.status === historyTab;
  });

  return (
    <div style={{ paddingBottom: '120px' }} onClick={() => setShowResults(false)}>

      {/* ─── Symbol Search ─── */}
      <div style={{ margin: '0 16px 16px 16px', position: 'relative' }}>
        <input
          placeholder="Search symbol (e.g. AAPL)"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
          style={{
            width: '100%',
            background: '#1a2235',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            padding: '12px 14px',
            color: '#ffffff',
            fontSize: '14px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {/* Autocomplete dropdown */}
        {showResults && searchResults.length > 0 && (
          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            marginTop: '4px',
            background: '#0a0f1e',
            borderRadius: '10px',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
            zIndex: 10,
          }}>
            {searchResults.map((r, i) => (
              <div
                key={r.symbol}
                onClick={() => {
                  skipSearchRef.current = true;
                  setSelectedSymbol(r.symbol);
                  setSelectedResult({ description: r.description, type: r.type });
                  setSearchQuery('');
                  setSearchResults([]);
                  setShowResults(false);
                }}
                style={{
                  padding: '10px 14px',
                  borderBottom: i < searchResults.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '14px' }}>
                  {r.symbol}
                </span>
                <span style={{ color: '#cbd5e1', fontSize: '12px', marginLeft: '8px' }}>
                  {r.description}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Quote + Order ─── */}
      {selectedSymbol && selectedResult && symbolQuote && (
        <div style={{
          background: '#1a2235',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          overflow: 'hidden',
          margin: '0 16px 16px',
        }}>
          {/* Quote Info */}
          <div style={{ padding: '16px' }}>
          {/* Symbol name + type badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>
              {selectedSymbol}
            </span>
            <span style={{
              fontSize: '10px',
              color: '#334155',
              background: '#0f1829',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              {symbolQuote.type === 'ETP' ? 'ETF' : 'Stock'}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#e2e8f0', marginBottom: '8px' }}>
            {symbolQuote.description}
          </div>

          {/* Price + Change */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#ffffff' }}>
              ${symbolQuote.price.toFixed(2)}
            </span>
            <span style={{
              fontSize: '14px',
              fontWeight: '600',
              color: symbolQuote.change >= 0 ? '#10b981' : '#ef4444'
            }}>
              {symbolQuote.change >= 0 ? '+' : ''}{symbolQuote.change.toFixed(2)}
              {' '}({symbolQuote.changePct >= 0 ? '+' : ''}{symbolQuote.changePct.toFixed(2)}%)
            </span>
          </div>

          {/* Day Range */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid #2a3448'
          }}>
            <span style={{ fontSize: '11px', color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Day Range
            </span>
            <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: '500' }}>
              ${symbolQuote.dayLow.toFixed(2)} — ${symbolQuote.dayHigh.toFixed(2)}
            </span>
          </div>

          {/* Day Range Bar */}
          <div style={{ marginTop: '6px', marginBottom: '4px' }}>
            <div style={{
              position: 'relative',
              height: '4px',
              background: '#0f1829',
              borderRadius: '2px'
            }}>
              <div style={{
                position: 'absolute',
                height: '8px',
                width: '8px',
                background: '#22d3ee',
                borderRadius: '50%',
                top: '-2px',
                left: `${Math.min(98, Math.max(2,
                  ((symbolQuote.price - symbolQuote.dayLow) /
                  (symbolQuote.dayHigh - symbolQuote.dayLow || 1)) * 100
                ))}%`,
                transform: 'translateX(-50%)'
              }} />
            </div>
          </div>

          {/* 52-Week Range */}
          {symbolQuote.weekLow52 > 0 && (
            <>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '10px'
              }}>
                <span style={{ fontSize: '11px', color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  52-Wk Range
                </span>
                <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: '500' }}>
                  ${symbolQuote.weekLow52.toFixed(2)} — ${symbolQuote.weekHigh52.toFixed(2)}
                </span>
              </div>
              <div style={{ marginTop: '6px', marginBottom: '4px' }}>
                <div style={{
                  position: 'relative',
                  height: '4px',
                  background: '#0f1829',
                  borderRadius: '2px'
                }}>
                  <div style={{
                    position: 'absolute',
                    height: '8px',
                    width: '8px',
                    background: '#ffffff',
                    borderRadius: '50%',
                    top: '-2px',
                    left: `${Math.min(98, Math.max(2,
                      ((symbolQuote.price - symbolQuote.weekLow52) /
                      (symbolQuote.weekHigh52 - symbolQuote.weekLow52 || 1)) * 100
                    ))}%`,
                    transform: 'translateX(-50%)'
                  }} />
                </div>
              </div>
            </>
          )}

          {/* Open */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '10px'
          }}>
            <span style={{ fontSize: '11px', color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              OPEN ({symbolQuote.lastTradeTime ? formatQuoteDate(symbolQuote.lastTradeTime) : ''})
            </span>
            <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: '500' }}>
              {symbolQuote.open > 0 ? `$${symbolQuote.open.toFixed(2)}` : '—'}
            </span>
          </div>

          {/* Prev Close */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '8px'
          }}>
            <span style={{ fontSize: '11px', color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              PREV CLOSE ({symbolQuote.lastTradeTime ? formatQuoteDate(symbolQuote.lastTradeTime - 86400) : ''})
            </span>
            <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: '500' }}>
              {symbolQuote.prevClose > 0
                ? `$${symbolQuote.prevClose.toFixed(2)}` : '—'}
            </span>
          </div>

          {quoteLoading && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#e2e8f0', textAlign: 'center' }}>
              Loading quote...
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />

        {/* Order Form */}
        <div style={{ padding: '16px' }}>
        <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '16px' }}>
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
                color: side === s ? '#ffffff' : '#94a3b8',
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
        <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '8px' }}>
          ORDER TYPE
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['market', 'limit', 'stop', 'stop_limit'] as const).map(t => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: '8px',
                border: orderType === t ? '1px solid #22d3ee' : '1px solid #2a3448',
                background: orderType === t ? '#1e3a5f' : '#0f1829',
                color: orderType === t ? '#22d3ee' : '#94a3b8',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              {t === 'market' ? 'Market' : t === 'limit' ? 'Limit' : t === 'stop' ? 'Stop' : 'Stop Limit'}
            </button>
          ))}
        </div>

        {/* QUANTITY */}
        <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '8px' }}>
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
                color: qtyType === qt ? '#22d3ee' : '#94a3b8',
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

        {/* STOP PRICE */}
        {(orderType === 'stop' || orderType === 'stop_limit') && (
          <>
            <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '8px' }}>
              STOP PRICE
            </div>
            <input
              type="number"
              placeholder="0.00"
              value={stopPrice}
              onChange={e => setStopPrice(e.target.value)}
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
                marginBottom: '12px',
                boxSizing: 'border-box'
              }}
            />
          </>
        )}

        {/* LIMIT PRICE */}
        {(orderType === 'limit' || orderType === 'stop_limit') && (
          <>
            <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '8px' }}>
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
        <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '8px' }}>
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
                color: tif === t ? '#22d3ee' : '#94a3b8',
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
          <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Est. value</span>
          <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: '600' }}>
            {(() => {
              const price = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
                ? parseFloat(limitPrice)
                : symbolQuote?.price;
              if (!price || !qty || isNaN(price)) return '$0.00';
              const shares = qtyType === 'dollars' && price > 0
                ? parseFloat(qty) / price
                : parseFloat(qty);
              const estValue = shares * price;
              return `$${estValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            })()}
          </span>
        </div>

        {/* Buying Power */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Buying Power</span>
          <span style={{
            color: (() => {
              const price = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
                ? parseFloat(limitPrice)
                : symbolQuote?.price;
              if (!price || !qty || isNaN(price)) return '#94a3b8';
              const shares = qtyType === 'dollars' && price > 0
                ? parseFloat(qty) / price
                : parseFloat(qty);
              const estCost = shares * price;
              const bp = account?.buyingPower ?? 0;
              if (side === 'buy' && estCost > bp) return '#ef4444';
              return '#94a3b8';
            })(),
            fontSize: '13px'
          }}>
            ${(account?.buyingPower ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Insufficient funds warning */}
        {side === 'buy' && (() => {
          const price = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
            ? parseFloat(limitPrice)
            : symbolQuote?.price;
          if (!price || !qty || isNaN(price)) return null;
          const shares = qtyType === 'dollars' && price > 0
            ? parseFloat(qty) / price
            : parseFloat(qty);
          const estCost = shares * price;
          const bp = account?.buyingPower ?? 0;
          if (estCost > bp) {
            return (
              <div style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '16px',
                fontSize: '12px',
                color: '#ef4444',
                lineHeight: '1.5',
              }}>
                ⚠️ Insufficient buying power. You need ${estCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} but only have ${bp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} available.
              </div>
            );
          }
          return null;
        })()}

        {/* Insufficient shares warning (sell) */}
        {side === 'sell' && (() => {
          const price = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
            ? parseFloat(limitPrice)
            : symbolQuote?.price;
          if (!price || !qty || isNaN(price)) return null;
          const shares = qtyType === 'dollars' && price > 0
            ? parseFloat(qty) / price
            : parseFloat(qty);
          if (!shares || shares <= 0) return null;
          const position = account?.positions?.find(p => p.symbol === selectedSymbol);
          const reserved = position?.reservedShares ?? 0;
          const owned = position?.qty ?? 0;
          const available = owned - reserved;
          if (!position || available < shares) {
            const msg = !position
              ? `You don't own any shares of ${selectedSymbol}`
              : reserved > 0
                ? `Insufficient shares. You want to sell ${shares.toLocaleString()} but only have ${available.toLocaleString()} available (${owned.toLocaleString()} held, ${reserved.toLocaleString()} reserved by pending orders)`
                : `Insufficient shares. You want to sell ${shares.toLocaleString()} but only own ${owned.toLocaleString()}`;
            return (
              <div style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '16px',
                fontSize: '12px',
                color: '#ef4444',
                lineHeight: '1.5',
              }}>
                ⚠️ {msg}
              </div>
            );
          }
          return null;
        })()}

        {/* Limit/Stop advisory */}
        {(orderType === 'limit' || orderType === 'stop' || orderType === 'stop_limit') && (
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
          onClick={async () => {
            if (!selectedSymbol) return;
            const price = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
              ? parseFloat(limitPrice)
              : symbolQuote?.price;
            if (!price || isNaN(price) || price <= 0) return;
            const shares = qtyType === 'dollars' && price > 0
              ? Math.floor(parseFloat(qty || '0') / price)
              : parseInt(qty || '0');
            if (!shares || shares <= 0) return;

            const stopPx = (orderType === 'stop' || orderType === 'stop_limit') && stopPrice
              ? parseFloat(stopPrice)
              : undefined;
            const limitPx = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
              ? parseFloat(limitPrice)
              : undefined;

            // Pre-check buying power for BUY orders
            if (side === 'buy') {
              const estCost = shares * price;
              const bp = account?.buyingPower ?? 0;
              if (estCost > bp) return; // Blocked by buy warning — don't submit
            }

            // Pre-check share ownership for SELL orders
            if (side === 'sell') {
              const pos = account?.positions?.find(p => p.symbol === selectedSymbol);
              const available = (pos?.qty ?? 0) - (pos?.reservedShares ?? 0);
              if (!pos || available < shares) return; // Blocked by sell warning — don't submit
            }

            const result = await executeTrade(
              selectedSymbol,
              side === 'buy' ? 'BUY' : 'SELL',
              shares,
              price,
              orderType,
              stopPx,
              limitPx,
              tif,
            );
            if (result.success) {
              setQty('');
              setLimitPrice('');
              setStopPrice('');
              // Switch to the correct order history tab
              setHistoryTab(result.status === 'FILLED' ? 'filled' : 'open');
              // Scroll to order history
              setTimeout(() => {
                document.getElementById('order-history')?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            }
          }}
          style={{
            width: '100%',
            padding: '16px',
            background: side === 'buy' ? '#10b981' : '#ef4444',
            border: 'none',
            borderRadius: '10px',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: '700',
            cursor: (() => {
              if (!selectedSymbol || !symbolQuote) return 'not-allowed';
              const price = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
                ? parseFloat(limitPrice) : symbolQuote?.price;
              if (!price || !qty || isNaN(price)) return 'not-allowed';
              const shares = qtyType === 'dollars' && price > 0
                ? parseFloat(qty) / price : parseFloat(qty);
              if (!shares || shares <= 0) return 'not-allowed';
              if (side === 'buy') {
                if (shares * price > (account?.buyingPower ?? 0)) return 'not-allowed';
              }
              if (side === 'sell') {
                const pos = account?.positions?.find(p => p.symbol === selectedSymbol);
                const available = (pos?.qty ?? 0) - (pos?.reservedShares ?? 0);
                if (!pos || available < shares) return 'not-allowed';
              }
              return 'pointer';
            })(),
            opacity: (() => {
              if (!selectedSymbol || !symbolQuote) return 0.5;
              const price = (orderType === 'limit' || orderType === 'stop_limit') && limitPrice
                ? parseFloat(limitPrice) : symbolQuote?.price;
              if (!price || !qty || isNaN(price)) return 0.5;
              const shares = qtyType === 'dollars' && price > 0
                ? parseFloat(qty) / price : parseFloat(qty);
              if (!shares || shares <= 0) return 0.5;
              if (side === 'buy') {
                if (shares * price > (account?.buyingPower ?? 0)) return 0.5;
              }
              if (side === 'sell') {
                const pos = account?.positions?.find(p => p.symbol === selectedSymbol);
                const available = (pos?.qty ?? 0) - (pos?.reservedShares ?? 0);
                if (!pos || available < shares) return 0.5;
              }
              return 1;
            })(),
          }}
        >
          {side === 'buy' ? 'Place Buy Order' : 'Place Sell Order'}
        </button>
      </div>
      </div>
      )}

      {/* ─── 2. STRATEGIES SECTION ─── */}
      <div data-testid="strategies-section" style={{ margin: '0 16px 16px 16px' }} id="strategies-section">
        <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '12px' }}>
          STRATEGIES
        </div>
        {/* AVAILABLE */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.08em', marginBottom: '10px', padding: '0 16px' }}>
            AVAILABLE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '0 16px' }}>
            <button
              onClick={() => setShowBuildBasket(true)}
              style={{
                background: '#1a2235',
                border: '1px solid rgba(34,211,238,0.3)',
                borderRadius: '12px',
                padding: '14px 10px',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>🧺</div>
              <div style={{ color: '#ffffff', fontSize: '12px', fontWeight: '600', marginBottom: '3px' }}>Build Basket</div>
              <div style={{ color: '#cbd5e1', fontSize: '10px', lineHeight: '1.3' }}>AI-curated themed portfolios</div>
            </button>
            <button
              onClick={() => setActiveTab('invest')}
              style={{
                background: '#1a2235',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '12px',
                padding: '14px 10px',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              <div style={{ color: '#ffffff', fontSize: '12px', fontWeight: '600', marginBottom: '3px' }}>DCA</div>
              <div style={{ color: '#cbd5e1', fontSize: '10px', lineHeight: '1.3' }}>Dollar cost averaging</div>
            </button>
          </div>
        </div>
        {/* COMING SOON */}
        <div>
          <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.08em', marginBottom: '10px', padding: '0 16px' }}>
            COMING SOON
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '0 16px' }}>
            {[
              { id: 'rebalance', label: 'Rebalance', description: 'Optimize allocations' },
              { id: 'tax-harvest', label: 'Tax Harvest', description: 'Offset gains with losses' },
              { id: 'momentum', label: 'Momentum', description: 'Ride market leaders' },
              { id: 'mean-reversion', label: 'Mean Rev.', description: 'Buy the dip' },
            ].map(s => (
              <div
                key={s.id}
                style={{
                  background: '#1a2235',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '12px',
                  padding: '14px 10px',
                  textAlign: 'center',
                  opacity: 0.45,
                  position: 'relative',
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  background: 'rgba(34,211,238,0.15)',
                  color: '#22d3ee',
                  fontSize: '8px',
                  fontWeight: '600',
                  padding: '2px 5px',
                  borderRadius: '4px',
                  letterSpacing: '0.05em',
                }}>
                  SOON
                </div>
                <div style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600', marginBottom: '3px' }}>{s.label}</div>
                <div style={{ color: '#64748b', fontSize: '10px', lineHeight: '1.3' }}>{s.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── 4. ORDER HISTORY ─── */}
      <div id="order-history" style={{ margin: '0 16px' }}>
        <div style={{ fontSize: '11px', color: '#e2e8f0', letterSpacing: '0.1em', marginBottom: '12px' }}>
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
                color: historyTab === tab.key ? '#22d3ee' : '#94a3b8'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filtered basket orders for current tab */}
        {(() => {
          const filteredBasketOrders = (liveBasketOrders || []).filter((bo: any) => {
            if (historyTab === 'all') return true;
            return bo.status === historyTab.toUpperCase();
          });

          // ── Group individual orders by basketId for orders not covered by liveBasketOrders ──
          // This handles baskets whose orders exist in order_history but not as basket-level
          // entries (e.g. baskets filled via manual recovery or cross-session via Supabase sync).
          const ordersWithBasketId = filteredOrders.filter((o: any) => o.basketId && !o.basketOrderId);
          const groupMap = new Map<string, any[]>();
          for (const order of ordersWithBasketId) {
            const bid = order.basketId!;
            if (!groupMap.has(bid)) groupMap.set(bid, []);
            groupMap.get(bid)!.push(order);
          }
          const basketOrderGroups = Array.from(groupMap.entries()).map(([basketId, orders]) => {
            const allFilled = orders.every((o: any) => o.status === 'filled');
            const someFilled = orders.some((o: any) => o.status === 'filled');
            const allCancelled = orders.every((o: any) => o.status === 'cancelled');
            const aggregateStatus = allFilled ? 'FILLED' : allCancelled ? 'CANCELLED' : 'OPEN';
            const displayStatus = (someFilled && !allFilled) ? 'PARTIAL' : aggregateStatus;
            const first = orders[0];
            const totalCost = orders.reduce((s: number, o: any) =>
              s + (o.totalCost || o.reservedCost || (o.shares * (o.fillPrice || o.submittedPrice || 0))), 0);
            return {
              id: `basket-grp-${basketId}`,
              basketId,
              basketName: first.basketName || orders[0].symbol || 'Basket',
              basketEmoji: first.basketEmoji || '🧺',
              orders,
              aggregateStatus,
              displayStatus,
              totalCost,
              orderCount: orders.length,
              filledCount: orders.filter((o: any) => o.status === 'filled').length,
              submittedAt: first.submittedAt || first.createdAt || first.date,
            };
          });

          // Filter basket groups by current tab
          const visibleGroups = basketOrderGroups.filter((g: any) => {
            if (historyTab === 'all') return true;
            const s = g.aggregateStatus;
            // PARTIAL baskets appear under Open tab (user explicitly chose this)
            if (historyTab === 'open') return s === 'OPEN' || g.displayStatus === 'PARTIAL';
            if (historyTab === 'filled') return s === 'FILLED';
            if (historyTab === 'cancelled') return s === 'CANCELLED';
            return true;
          });

          // Already-grouped basket orders (from liveBasketOrders) — track which basketOrderIds
          // and basketIds are covered so we don't duplicate in the individual section
          const coveredBasketIds = new Set(filteredBasketOrders.map((b: any) => b.basketId));
          const groupedOrderIds = new Set(basketOrderGroups.flatMap((g: any) => g.orders.map((o: any) => o.id)));

          // Solo orders: exclude basket-covered orders + already-grouped
          const soloOrders = filteredOrders.filter((o: any) => {
            if (o.basketOrderId) return false;
            if (o.id?.toString().includes('-b')) return false;
            if (groupedOrderIds.has(o.id)) return false;
            if (o.basketId && coveredBasketIds.has(o.basketId)) return false;
            return true;
          });

          return (
            <>
              {/* ── BASKET ORDER GROUPS ── */}
              {filteredBasketOrders.map((basket: any) => {
                const isExpanded = expandedBasketOrder === basket.id;
                const isOpen = basket.status === 'OPEN';
                  return (
                  <div
                    key={basket.id}
                    style={{
                      background: '#1a2235',
                      border: `1px solid ${isOpen ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '12px',
                      marginBottom: '10px',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Basket header — tap to expand (filled) or edit (pending) */}
                    <div
                      onClick={() => {
                        if (isOpen) {
                          // Build edit payload from LIVE broker basket order data (not stale localStorage)
                          const stocks = (basket.orders || []).map((o: any) => ({
                            symbol: o.symbol,
                            price: o.submittedPrice || 0,
                            shares: o.shares || 0,
                            dollarAmount: o.totalCost || o.reservedCost || 0,
                            allocationPct: basket.totalReserved > 0
                              ? ((o.totalCost || o.reservedCost || 0) / basket.totalReserved) * 100
                              : 0,
                          }));
                          setEditingBasket({
                            id: basket.id,
                            basketName: basket.basketName,
                            basketEmoji: basket.basketEmoji,
                            basketDisplayName: basket.basketDisplayName || basket.basketName,
                            stocks,
                            totalReserved: basket.totalReserved || 0,
                            status: 'OPEN',
                            submittedAt: basket.submittedAt,
                            nextOpenLabel: basket.nextOpenLabel || '',
                          });
                          setShowBuildBasket(true);
                        } else {
                          setExpandedBasketOrder(isExpanded ? null : basket.id);
                        }
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '14px 16px',
                        cursor: 'pointer',
                      }}
                    >
                      <div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '4px',
                        }}>
                          <span style={{ fontSize: '18px' }}>
                            {basket.basketEmoji || '🧺'}
                          </span>
                          <span style={{
                            color: '#ffffff',
                            fontWeight: '700',
                            fontSize: '15px',
                          }}>
                            {basket.basketDisplayName || basket.basketName}
                          </span>
                        </div>
                        <div style={{
                          color: '#cbd5e1',
                          fontSize: '11px',
                        }}>
                          {basket.orders?.length || 0} positions ·
                          ${(basket.totalReserved || 0).toFixed(2)}
                          {isOpen && (
                            <span style={{ color: '#f59e0b' }}>
                              {' · '}⏳ {getMarketStatus().isOpen ? '⚡ Market Open — executing soon' : basket.nextOpenLabel || 'awaiting market open'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}>
                        {isOpen && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmCancelBasket({
                                basketOrderId: basket.id,
                                basketDisplayName: basket.basketDisplayName || basket.basketName,
                                orderCount: basket.orders?.length || 0,
                                totalReserved: basket.totalReserved || 0,
                              });
                            }}
                            style={{
                              background: 'none',
                              border: '1px solid rgba(239,68,68,0.4)',
                              borderRadius: '6px',
                              color: '#ef4444',
                              fontSize: '11px',
                              padding: '4px 10px',
                              cursor: 'pointer',
                              fontWeight: '600',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '700',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          background: isOpen ? 'rgba(245,158,11,0.15)'
                            : basket.status === 'FILLED' ? 'rgba(16,185,129,0.15)'
                            : 'rgba(100,116,139,0.15)',
                          color: isOpen ? '#f59e0b'
                            : basket.status === 'FILLED' ? '#10b981'
                            : '#64748b',
                        }}>
                          {basket.status}
                        </span>
                        {!isOpen && (
                          <span style={{
                            color: '#cbd5e1',
                            fontSize: '14px',
                            transform: isExpanded ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.2s',
                          }}>
                            ›
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expanded — individual orders */}
                    {isExpanded && (
                      <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        {(basket.orders || []).map((order: any) => (
                          <div key={order.id} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '10px 16px',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                          }}>
                            <div>
                              <div style={{
                                color: '#ffffff',
                                fontWeight: '600',
                                fontSize: '13px',
                              }}>
                                {order.symbol}
                                <span style={{
                                  color: '#10b981',
                                  fontSize: '10px',
                                  marginLeft: '6px',
                                  background: 'rgba(16,185,129,0.15)',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                }}>
                                  BUY
                                </span>
                              </div>
                              <div style={{
                                color: '#cbd5e1',
                                fontSize: '11px',
                                marginTop: '2px',
                              }}>
                                {order.shares?.toFixed(4)}sh
                                {order.fillPrice
                                  ? ` @ $${order.fillPrice.toFixed(2)}`
                                  : ` @ ~$${(order.submittedPrice || 0).toFixed(2)}`
                                }
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{
                                color: order.status === 'FILLED' ? '#10b981'
                                  : order.status === 'OPEN' ? '#f59e0b'
                                  : '#64748b',
                                fontSize: '11px',
                                fontWeight: '600',
                              }}>
                                {order.status}
                              </div>
                              <div style={{
                                color: '#cbd5e1',
                                fontSize: '11px',
                              }}>
                                ${(order.totalCost || 0).toFixed(2)}
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Cancel basket — OPEN only */}
                        {basket.status === 'OPEN' && (
                          <div style={{ padding: '12px 16px' }}>
                            <button
                              onClick={() => setConfirmCancelBasket({
                                basketOrderId: basket.id,
                                basketDisplayName: basket.basketDisplayName || basket.basketName || 'Basket',
                                orderCount: basket.orders?.length || 0,
                                totalReserved: basket.totalReserved || 0,
                              })}
                              style={{
                                width: '100%',
                                padding: '10px',
                                background: 'none',
                                border: '1px solid rgba(239,68,68,0.3)',
                                borderRadius: '8px',
                                color: '#ef4444',
                                fontSize: '13px',
                                cursor: 'pointer',
                              }}
                            >
                              Cancel Basket Order
                            </button>
                            <div style={{
                              color: '#cbd5e1',
                              fontSize: '10px',
                              textAlign: 'center',
                              marginTop: '6px',
                            }}>
                              Individual orders cannot be cancelled
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── BASKET GROUPS FROM INDIVIDUAL ORDERS ── */}
              {visibleGroups.map((group: any) => {
                const isExpanded = expandedBasketOrder === group.id;
                const isPending = group.aggregateStatus === 'OPEN' && group.displayStatus !== 'PARTIAL';
                const statusColor = group.aggregateStatus === 'FILLED' ? '#10b981'
                  : group.aggregateStatus === 'CANCELLED' ? '#64748b'
                  : group.displayStatus === 'PARTIAL' ? '#22d3ee'
                  : '#f59e0b';
                const statusBg = group.aggregateStatus === 'FILLED' ? 'rgba(16,185,129,0.15)'
                  : group.aggregateStatus === 'CANCELLED' ? 'rgba(100,116,139,0.15)'
                  : group.displayStatus === 'PARTIAL' ? 'rgba(34,211,238,0.15)'
                  : 'rgba(245,158,11,0.15)';
                return (
                  <div key={group.id} style={{
                    background: '#1a2235',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '12px',
                    marginBottom: '10px',
                    overflow: 'hidden',
                  }}>
                    {/* Basket header — tap to expand */}
                    <div
                      onClick={() => {
                        if (isPending) {
                          // Build edit payload from LIVE grouped orders (not stale localStorage)
                          const stocks = (group.orders || []).map((o: any) => ({
                            symbol: o.symbol,
                            price: o.submittedPrice || o.fillPrice || 0,
                            shares: o.shares || 0,
                            dollarAmount: o.totalCost || o.reservedCost || 0,
                            allocationPct: group.totalCost > 0
                              ? ((o.totalCost || o.reservedCost || 0) / group.totalCost) * 100
                              : 0,
                          }));
                          setEditingBasket({
                            id: group.basketId,
                            basketName: group.basketName,
                            basketEmoji: group.basketEmoji,
                            basketDisplayName: group.basketName,
                            stocks,
                            totalReserved: group.totalCost || 0,
                            status: 'OPEN',
                            submittedAt: group.submittedAt,
                            nextOpenLabel: '',
                          });
                          setShowBuildBasket(true);
                        } else {
                          setExpandedBasketOrder(isExpanded ? null : group.id);
                        }
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '14px 16px',
                        cursor: isPending ? 'pointer' : 'pointer',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '18px' }}>{group.basketEmoji}</span>
                          <span style={{ color: '#ffffff', fontWeight: '700', fontSize: '15px' }}>
                            {group.basketName}
                          </span>
                        </div>
                        <div style={{ color: '#cbd5e1', fontSize: '11px' }}>
                          {group.orderCount} positions · ${group.totalCost.toFixed(2)}
                          {group.displayStatus === 'PARTIAL' && (
                            <span style={{ color: '#22d3ee' }}>
                              {' · '}⚠️ {group.filledCount}/{group.orderCount} filled
                            </span>
                          )}
                          {isPending && (
                            <span style={{ color: '#f59e0b' }}>
                              {' · '}⏳ {getMarketStatus().isOpen ? '⚡ Market Open — executing soon' : 'awaiting market open'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '11px', fontWeight: '700',
                          padding: '3px 8px', borderRadius: '4px',
                          background: statusBg, color: statusColor,
                        }}>
                          {group.displayStatus}
                        </span>
                        {!isPending && (
                          <span style={{
                            color: '#cbd5e1', fontSize: '14px',
                            transform: isExpanded ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.2s',
                          }}>›</span>
                        )}
                        {isPending && (
                          <span style={{ color: '#cbd5e1', fontSize: '10px', opacity: 0.6 }}>✏️</span>
                        )}
                      </div>
                    </div>

                    {/* Expanded — stock breakdown + basket actions (FILLED / PARTIAL only) */}
                    {isExpanded && !isPending && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {group.orders.map((order: any) => (
                          <div key={order.id} style={{
                            display: 'flex', justifyContent: 'space-between',
                            padding: '10px 16px',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                          }}>
                            <div>
                              <div style={{ color: '#ffffff', fontWeight: '600', fontSize: '13px' }}>
                                {order.symbol}
                                <span style={{
                                  color: '#10b981', fontSize: '10px', marginLeft: '6px',
                                  background: 'rgba(16,185,129,0.15)',
                                  padding: '1px 5px', borderRadius: '3px',
                                }}>BUY</span>
                              </div>
                              <div style={{ color: '#cbd5e1', fontSize: '11px', marginTop: '2px' }}>
                                {order.shares?.toFixed(4)}sh
                                {order.fillPrice ? ` @ $${order.fillPrice.toFixed(2)}` : ` @ ~$${(order.submittedPrice || 0).toFixed(2)}`}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{
                                color: order.status === 'filled' ? '#10b981'
                                  : order.status === 'open' ? '#f59e0b'
                                  : '#64748b',
                                fontSize: '11px', fontWeight: '600',
                              }}>
                                {order.status.toUpperCase()}
                              </div>
                              <div style={{ color: '#cbd5e1', fontSize: '11px' }}>
                                ${((order.totalCost || order.reservedCost || (order.shares * (order.fillPrice || order.submittedPrice || 0)) as number)).toFixed(2)}
                              </div>
                            </div>
                          </div>
                        ))}
                        {/* Shared Basket Action Panel — buy/sell from Invest tab */}
                        {(() => {
                          const ctxBasket = baskets.find(b => b.id === group.basketId);
                          if (!ctxBasket || !ctxBasket.positions || ctxBasket.positions.length === 0) return null;
                          return (
                            <BasketActionPanel
                              basketId={ctxBasket.id}
                              basketName={ctxBasket.name}
                              basketEmoji={ctxBasket.emoji || '🧺'}
                              positions={ctxBasket.positions.map((p: any) => ({
                                symbol: p.symbol,
                                shares: p.shares,
                                avgCost: p.avgCost,
                                currentPrice: p.currentPrice || p.avgCost,
                                allocationPct: p.allocationPct || 0,
                                marketValue: p.marketValue,
                                totalPnL: p.totalPnL,
                                totalPnLPct: p.totalPnLPct,
                                name: p.name,
                                status: p.status,
                              }))}
                              totalCost={ctxBasket.totalCost}
                              marketValue={ctxBasket.marketValue}
                              totalPnL={ctxBasket.totalPnL}
                              totalPnLPct={ctxBasket.totalPnLPct}
                              context="invest"
                            />
                          );
                        })()}
                      </div>
                    )}

                    {/* Pending basket — tapping opens edit, no inline expand */}
                    {isPending && (
                      <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        padding: '10px 16px',
                        color: '#94a3b8', fontSize: '11px',
                        textAlign: 'center',
                      }}>
                        Tap to edit in Build Basket
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── INDIVIDUAL (NON-BASKET) ORDERS ── */}
              {soloOrders.map(order => (
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
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
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
                        background: order.side === 'BUY' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                        color: order.side === 'BUY' ? '#10b981' : '#ef4444'
                      }}>
                        {order.side}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#e2e8f0', marginBottom: '2px' }}>
                      market · {order.shares} shares
                    </div>
                    {order.status === 'filled' && order.price && (
                      <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                        Total: ${(order.shares * order.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {order.status === 'open' && (
                      <>
                        {order.submittedPrice > 0 && (
                          <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
                            Total: ${(order.shares * order.submittedPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                        {order.note && (
                          <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '4px' }}>
                            ⏳ {order.note}
                          </div>
                        )}
                        {!order.note && (
                          <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                            ⏳ Pending execution
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* RIGHT */}
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      ...getStatusStyle(order.status)
                    }}>
                      {order.status.toUpperCase()}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      {order.price ? `$${(order.price as number).toFixed(2)}/share` : 'pending'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {(() => {
                        try {
                          const d = new Date(order.date);
                          if (!isNaN(d.getTime())) {
                            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                          }
                        } catch {}
                        return order.date || '';
                      })()}
                    </div>
                    {/* Cancel button for OPEN orders */}
                    {order.status === 'open' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmCancel({
                            orderId: order.id,
                            symbol: order.symbol,
                            side: order.side,
                            shares: order.shares,
                            price: order.submittedPrice || order.price || 0,
                          });
                        }}
                        style={{
                          background: 'none',
                          border: '1px solid rgba(239,68,68,0.4)',
                          borderRadius: '6px',
                          color: '#ef4444',
                          fontSize: '11px',
                          padding: '4px 10px',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontWeight: '600',
                          alignSelf: 'flex-end',
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </>
          );
        })()}
      </div>

      {/* ─── 5. Bottom spacer ─── */}
      <div style={{ height: '80px' }} />

      {/* ─── Cancel Confirmation Modal ─── */}
      {confirmCancel && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 10001,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            background: '#1a2235',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '320px',
            width: '100%',
          }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff', marginBottom: '16px' }}>
              Cancel this order?
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
            }}>
              <div style={{ fontSize: '14px', color: '#ffffff', fontWeight: '600', marginBottom: '4px' }}>
                {confirmCancel.symbol} <span style={{
                  color: confirmCancel.side?.toUpperCase() === 'BUY' ? '#10b981' : '#ef4444',
                  fontSize: '12px',
                }}>{confirmCancel.side}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                {confirmCancel.shares} shares @ ${confirmCancel.price.toFixed(2)}
              </div>
              <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '4px' }}>
                ⚠ Reserved cash will be returned to your buying power.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setConfirmCancel(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  color: '#cbd5e1',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Keep Order
              </button>
              <button
                onClick={() => {
                  cancelOrder(confirmCancel.orderId);
                  setConfirmCancel(null);
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: '10px',
                  color: '#ef4444',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Cancel Basket Confirmation Modal ─── */}
      {confirmCancelBasket && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 10002,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            background: '#1a2235',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '320px',
            width: '100%',
          }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff', marginBottom: '16px' }}>
              Cancel basket order?
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
            }}>
              <div style={{ fontSize: '14px', color: '#ffffff', fontWeight: '600', marginBottom: '4px' }}>
                🔨 {confirmCancelBasket.basketDisplayName}
              </div>
              <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                {confirmCancelBasket.orderCount} orders · ${confirmCancelBasket.totalReserved.toFixed(2)} reserved
              </div>
              <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '4px' }}>
                Cash will be returned to your buying power immediately.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setConfirmCancelBasket(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  color: '#cbd5e1',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Keep Order
              </button>
              <button
                onClick={() => {
                  cancelBasketOrder(confirmCancelBasket.basketOrderId);
                  setConfirmCancelBasket(null);
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: '10px',
                  color: '#ef4444',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Build Basket Modal ─── */}
      {showBuildBasket && createPortal(
        <BuildBasketModal
          isOpen={showBuildBasket}
          onClose={() => { setShowBuildBasket(false); setEditingBasket(null); }}
          onBasketGenerated={(msg, result) => {
            setShowBuildBasket(false);
            setEditingBasket(null);
            if (result?.success) {
              // Fire gamification
              const anonId = (user as any)?.id || 'unknown';
              onBasketCreated(anonId).catch(() => {});
              // Navigate to Portfolio tab → baskets section
              window.dispatchEvent(new CustomEvent('vantage-navigate', {
                detail: { tab: 'portfolio', section: 'baskets-section' },
              }));
            }
          }}
          editBasket={editingBasket}
        />,
        document.body
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '60px',
          left: '16px',
          right: '16px',
          zIndex: 10001,
          background: '#1a2235',
          border: `1px solid ${toast.type === 'error' ? '#ef4444' : '#22d3ee'}`,
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          animation: 'slideDown 0.25s ease',
        }}>
          <span style={{ fontSize: '13px', color: '#ffffff', flex: 1 }}>{toast.message}</span>
          <button
            onClick={dismissToast}
            style={{ color: '#cbd5e1', background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', marginLeft: '8px' }}
          >×</button>
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      ` }} />

    </div>
  );
}
