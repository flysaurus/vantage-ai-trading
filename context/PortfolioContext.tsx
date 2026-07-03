'use client';

import { apiPost } from '@/lib/api-client';

/**
 * PortfolioContext — single source of truth for demo portfolio data.
 *
 * - Seeds from demo-data on first load
 * - Persists mutable state to localStorage (positions, cash, orders)
 * - Supports executeTrade() for demo buy/sell
 * - Live Finnhub quotes refresh every 60s, overlaying on persisted positions
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { onTradeExecuted } from '@/lib/gamification/events';
import { getMarketStatus } from '@/lib/market-hours';
import { getDemoAccount, getDemoSymbols } from '@/lib/demo-data';
import { syncPortfolioToSupabase, loadPortfolioFromSupabase } from '@/lib/portfolio-sync';
import { getBroker } from '@/lib/broker/broker-factory';
import { useMarketOpenWatcher } from '@/hooks/useMarketOpenWatcher';
import type { BrokerEngine, BrokerOrder } from '@/lib/broker/engine';
import type { AccountSummary, Position, Order, InvestorStyle } from '@/types';

// ─── Basket types ──────────────────────────────────────────

export interface BasketPosition {
  id: string;
  basketId: string;
  basketName: string;
  basketEmoji: string;
  symbol: string;
  shares: number;
  avgCost: number;
  totalCost: number;
  allocationPct: number;
  status: 'active' | 'partial' | 'closed' | 'pending';
  boughtAt: string;
  currentPrice?: number;
  marketValue?: number;
  totalPnL?: number;
  totalPnLPct?: number;
  dailyPnL?: number;
  /** For pending baskets: when the order will execute */
  nextOpenLabel?: string;
  /** Cash reserved for pending order */
  reservedAmount?: number;
}

export interface Basket {
  id: string;
  name: string;
  emoji: string;
  positions: BasketPosition[];
  totalCost: number;
  marketValue: number;
  totalPnL: number;
  totalPnLPct: number;
  dailyPnL: number;
  positionCount: number;
  activeCount: number;
  status: 'active' | 'partial' | 'closed' | 'pending';
  boughtAt: string;
  nextOpenLabel?: string;
}

// ─── Demo-only types ───────────────────────────────────────

interface DemoOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  shares: number;
  type: string;
  fillPrice: number;
  totalCost: number;
  status: string;
  createdAt: string;
  /** Price at which the order was submitted (for OPEN orders) */
  submittedPrice?: number;
  /** Cash reserved for OPEN BUY orders */
  reservedCost?: number;
  /** Optional note (e.g. 'pending execution') */
  note?: string;
  /** When the order was cancelled */
  cancelledAt?: string;
}

interface DemoState {
  positions: Position[];
  cashBalance: number;
  orders: DemoOrder[];
  savedAt: number;
}

const STORAGE_VERSION = 'v2';
const STORAGE_KEY = `vantage_demo_portfolio_${STORAGE_VERSION}`;
const OLD_STORAGE_KEY = 'vantage_demo_portfolio';
const BASKET_STORAGE_KEY = 'vantage_basket_positions_v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Helpers ───────────────────────────────────────────────

function generateOrderId(): string {
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Context Types ─────────────────────────────────────────

interface TradeResult {
  success: boolean;
  error?: string;
  /** Whether the order was FILLED (market open), OPEN (pending, market closed), or REJECTED */
  status?: 'FILLED' | 'OPEN' | 'REJECTED';
}

interface BasketTradeResult {
  success: boolean;
  executed: number;
  failed: number;
  totalSpent: number;
  error?: string;
  status?: 'FILLED' | 'OPEN';
}

interface BasketSellResult {
  success: boolean;
  proceeds: number;
  executed: string[];
  failed: string[];
}

interface PortfolioContextValue {
  /** Live-priced account summary */
  account: AccountSummary | null;
  /** Whether quotes are still loading */
  loading: boolean;
  /** Error message if quote fetch failed */
  error: string | null;
  /** Force refresh quotes */
  refresh: () => void;
  /** Execute a demo trade */
  executeTrade: (
    symbol: string,
    side: 'BUY' | 'SELL',
    shares: number,
    price: number
  ) => Promise<TradeResult>;
  /** Demo order history */
  demoOrders: DemoOrder[];
  /** Toast message */
  toast: { message: string; type: 'success' | 'error' } | null;
  /** Dismiss toast */
  dismissToast: () => void;
  /** Basket holdings (from localStorage, live-priced) */
  baskets: Basket[];
  /** Reload baskets from localStorage */
  loadBaskets: () => void;
  /** Execute a basket trade (all stocks at once) */
  executeBasketTrade: (
    basketId: string,
    basketName: string,
    basketEmoji: string,
    displayName: string,
    stocks: Array<{ symbol: string; allocationPct: number; name: string }>,
    budget: number,
  ) => Promise<BasketTradeResult>;
  /** Sell selected basket positions */
  sellBasketPositions: (
    basketId: string,
    symbolsToSell: string[],
  ) => Promise<BasketSellResult>;
  /** Cancel an OPEN order — releases reserved cash for BUY orders */
  cancelOrder: (orderId: string) => Promise<void>;
  /** Cancel a pending basket order — releases reserved cash, marks OPEN orders as CANCELLED */
  cancelBasketOrder: (basketId: string) => void;
  /** Execute all pending OPEN orders at current market prices */
  executePendingOrders: () => Promise<void>;
  /** All basket orders (grouped, from broker) */
  basketOrders: any[];
  /** Pending basket orders (OPEN status, awaiting market open) */
  pendingBaskets: any[];
}

const PortfolioContext = createContext<PortfolioContextValue>({
  account: null,
  loading: true,
  error: null,
  refresh: () => {},
  executeTrade: async () => ({ success: false, error: 'Not initialized' }),
  demoOrders: [],
  toast: null,
  dismissToast: () => {},
  baskets: [],
  loadBaskets: () => {},
  executeBasketTrade: async () => ({ success: false, executed: 0, failed: 0, totalSpent: 0, error: 'Not initialized' }) as any,
  sellBasketPositions: async () => ({ success: false, proceeds: 0, executed: [], failed: [] }),
  cancelOrder: async () => {},
  cancelBasketOrder: () => {},
  executePendingOrders: async () => {},
  basketOrders: [],
  pendingBaskets: [],
});

// ─── Provider ──────────────────────────────────────────────

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { isConnected } = useBroker();
  const { user } = useAuth();

  // ── Load persisted demo state synchronously (SSR-safe lazy init) ──
  function loadPersistedDemoState(): DemoState | null {
    if (typeof window === 'undefined') return null;
    try {
      localStorage.removeItem(OLD_STORAGE_KEY);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved: DemoState = JSON.parse(raw);
      const age = Date.now() - (saved.savedAt || 0);
      if (age < MAX_AGE_MS && saved.positions && saved.positions.length > 0) {
        return saved;
      }
    } catch { /* ignore corrupt localStorage */ }
    return null;
  }

  // ── Build AccountSummary from DemoState (no live quotes, for initial render) ──
  function accountFromDemoState(state: DemoState): AccountSummary {
    const positions = state.positions.map(p => ({
      ...p,
      currentPrice: p.avgCost,
      marketValue: p.qty * p.avgCost,
      dayChange: 0,
      dayChangePercent: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      portfolioPercent: 0,
    }));
    const totalEquity = positions.reduce((sum, p) => sum + p.marketValue, 0) + state.cashBalance;
    positions.forEach(p => {
      p.portfolioPercent = totalEquity > 0 ? (p.marketValue / totalEquity) * 100 : 0;
    });
    return {
      equity: totalEquity,
      buyingPower: state.cashBalance,
      cash: state.cashBalance,
      dayPnl: 0,
      dayPnlPercent: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      positions,
    };
  }

  // ── Persistent state (positions, cash, orders) — load from localStorage first ──
  const initialPersistedState = typeof window !== 'undefined' ? loadPersistedDemoState() : null;
  const [demoState, setDemoState] = useState<DemoState | null>(initialPersistedState);
  const [demoOrders, setDemoOrders] = useState<DemoOrder[]>(initialPersistedState?.orders || []);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [basketOrders, setBasketOrders] = useState<any[]>([]);
  const [pendingBaskets, setPendingBaskets] = useState<any[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem('vantage_pending_baskets');
      if (raw) return JSON.parse(raw).filter((b: any) => b.status === 'OPEN');
    } catch { }
    return [];
  });

  // ── Account: from persisted state if available, otherwise seed ──
  const [account, setAccount] = useState<AccountSummary | null>(() => {
    if (isConnected) return null;
    if (initialPersistedState) return accountFromDemoState(initialPersistedState);
    const localStyle = typeof window !== 'undefined' ? localStorage.getItem('vantage:investorStyle') : null;
    const style = (user?.investorStyle || localStyle || 'buffett') as InvestorStyle;
    return getDemoAccount(style, {});
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ── Refs for latest state (used by Supabase sync to avoid stale closures) ──
  const demoStateRef = useRef(demoState);
  const basketPositionsRef = useRef<BasketPosition[]>([]);
  const brokerRef = useRef<BrokerEngine | null>(null);
  useEffect(() => { demoStateRef.current = demoState; }, [demoState]);

  // ── Clear stale demo portfolio cache on mount ──
  // Forces fresh data from Supabase instead of stale localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.includes('demo_portfolio') || key.includes('vantage_demo')) {
          localStorage.removeItem(key);
          console.log('[portfolio] cleared stale cache:', key);
        }
      });
    } catch (e) {
      // localStorage not available
    }
  }, []);

  const persistDemoState = useCallback((state: DemoState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
    } catch { /* ignore quota exceeded */ }
  }, []);

  // ── Supabase: cross-device backup (fire-and-forget) ──
  useEffect(() => {
    if (!demoState || !user?.id) return;
    // Debounce: only sync every 5s max
    const timer = setTimeout(() => {
      syncPortfolioToSupabase(user.id, {
        positions: demoState.positions,
        cashBalance: demoState.cashBalance,
        orderHistory: demoState.orders || [],
        basketPositions: basketPositionsRef.current,
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [demoState, user?.id]);

  // ── Supabase: load on mount (overrides localStorage if newer) ──
  useEffect(() => {
    if (!user?.id) return;
    const trySupabaseLoad = async () => {
      const supabaseState = await loadPortfolioFromSupabase(user.id);
      if (!supabaseState || !supabaseState.positions?.length) return;
      // Compare timestamps — Supabase wins if newer
      const localTs = initialPersistedState?.savedAt || demoState?.savedAt || 0;
      if (supabaseState.savedAt > localTs) {
        const merged: DemoState = {
          positions: supabaseState.positions,
          cashBalance: supabaseState.cashBalance,
          orders: supabaseState.orderHistory || [],
          savedAt: supabaseState.savedAt,
        };
        console.log('[portfolio init] Supabase load SUCCESS, positions:', supabaseState.positions.length, 'cash:', supabaseState.cashBalance);
        setDemoState(merged);
        setDemoOrders(merged.orders);
        // Also update localStorage as cache
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...merged, savedAt: Date.now() })); } catch {}
      }
    };
    trySupabaseLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Recompute AccountSummary from mutable state + live quotes ──
  const recomputeAccount = useCallback(
    (quotes: Record<string, any> | null) => {
      console.log('[recomputeAccount] called, quotes null?:', quotes === null, 'demoState exists?:', !!demoState);
      if (!demoState) return;

      const positions = demoState.positions.map((p) => {
        const quote = quotes?.[p.symbol];
        const hasLivePrice = quote && typeof quote.price === 'number' && quote.price > 0;
        console.log('[recomputeAccount] position:', p.symbol, 'quote received:', JSON.stringify(quote), 'hasLivePrice:', hasLivePrice, 'currentPrice used:', hasLivePrice ? quote.price : p.avgCost);
        const currentPrice = hasLivePrice ? quote.price : p.avgCost;
        const dayChange = hasLivePrice ? (quote.change || 0) * p.qty : 0;
        const dayChangePercent = hasLivePrice && currentPrice > 0
          ? ((quote.change || 0) / quote.previousClose) * 100
          : 0;
        const marketValue = p.qty * currentPrice;
        const totalPnl = marketValue - (p.qty * p.avgCost);
        const totalPnlPercent = p.avgCost > 0 ? (totalPnl / (p.qty * p.avgCost)) * 100 : 0;
        const totalEquity = demoState.positions.reduce(
          (sum, pos) => sum + pos.qty * currentPrice, 0
        ) + demoState.cashBalance;
        const portfolioPercent = totalEquity > 0 ? (marketValue / totalEquity) * 100 : 0;

        return {
          ...p,
          currentPrice,
          marketValue,
          dayChange,
          dayChangePercent,
          totalPnl,
          totalPnlPercent,
          portfolioPercent,
        };
      });

      const totalEquity = positions.reduce((sum, p) => sum + p.marketValue, 0) + demoState.cashBalance;
      const totalCost = positions.reduce((sum, p) => sum + p.qty * p.avgCost, 0);
      const totalPnl = totalEquity - totalCost - demoState.cashBalance;
      const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
      const dayPnl = positions.reduce((sum, p) => sum + p.dayChange, 0);
      const dayPnlPercent = totalEquity > 0 && dayPnl !== 0
        ? (dayPnl / (totalEquity - dayPnl)) * 100
        : 0;

      const summary: AccountSummary = {
        equity: totalEquity,
        buyingPower: demoState.cashBalance,
        cash: demoState.cashBalance,
        dayPnl,
        dayPnlPercent,
        totalPnl,
        totalPnlPercent,
        positions,
      };

      console.log('[recomputeAccount] account set, sample position currentPrice:', summary.positions?.[0]?.currentPrice);
      setAccount(summary);
    },
    [demoState]
  );

  // ── Fetch live quotes + recompute ──
  const fetchData = useCallback(async () => {
    if (isConnected || !demoState) return;

    try {
      setError(null);

      const symbols = demoState.positions.map((p) => p.symbol);
      if (symbols.length === 0) return;

      console.log('[fetchData] requesting quotes for:', symbols);
      const res = await await apiPost('/api/market/quotes', JSON.stringify({ symbols }));

      console.log('[fetchData] raw response status:', res.status);
      if (!res.ok) throw new Error('Market data fetch failed');

      const data = await res.json();
      console.log('[fetchData] raw response data:', JSON.stringify(data).slice(0, 400));
      if (!data?.quotes || !mountedRef.current) return;

      console.log('[fetchData] calling recomputeAccount with quotes keys:', Object.keys(data.quotes));
      recomputeAccount(data.quotes);
      setError(null);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load market data');
      }
    }
  }, [isConnected, demoState, recomputeAccount]);

  // Fetch on mount and when state changes
  useEffect(() => {
    mountedRef.current = true;
    if (demoState) {
      console.log('[portfolio init] demoState loaded, positions:', demoState.positions.length, 'cash:', demoState.cashBalance);
      console.log('[portfolio init] calling recomputeAccount(null) for initial render');
      recomputeAccount(null); // initial render with avgCost
      console.log('[portfolio init] calling fetchData() for live quotes');
      fetchData(); // then fetch live prices
    }
    const interval = setInterval(fetchData, 60000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [demoState, recomputeAccount, fetchData]);

  // ── refreshStateFromBroker: sync broker state → React state ──
  const refreshStateFromBroker = useCallback(async () => {
    const b = brokerRef.current;
    if (!b) return;
    const [bPositions, bAccount, bOrders, bBasketOrders] = await Promise.all([
      b.getPositions(),
      b.getAccount(),
      b.getOrders(),
      b.getBasketOrders(),
    ]);
    const ctxPositions = bPositions.map((bp: any) => ({
      symbol: bp.symbol, name: bp.symbol, qty: bp.shares, avgCost: bp.avgCost,
      currentPrice: bp.avgCost, marketValue: bp.shares * bp.avgCost,
      dayChange: 0, dayChangePercent: 0, totalPnl: 0, totalPnlPercent: 0,
      portfolioPercent: 0, type: bp.type,
      basketId: bp.basketId, basketName: bp.basketName, basketEmoji: bp.basketEmoji,
    }));
    const ctxOrders: DemoOrder[] = bOrders.map((bo: any) => ({
      id: bo.id, symbol: bo.symbol, side: bo.side, shares: bo.shares, type: bo.type,
      fillPrice: bo.fillPrice || bo.submittedPrice, totalCost: bo.totalCost,
      status: bo.status, createdAt: bo.submittedAt, submittedPrice: bo.submittedPrice,
      reservedCost: bo.reservedCost, note: bo.note, cancelledAt: bo.cancelledAt,
    }));
    const newState: DemoState = { positions: ctxPositions, cashBalance: bAccount.cashBalance, orders: ctxOrders, savedAt: Date.now() };
    setDemoState(newState);
    setDemoOrders(ctxOrders);
    persistDemoState(newState);
    // Sync basket orders from broker
    setBasketOrders(bBasketOrders || []);
    setPendingBaskets((bBasketOrders || []).filter((bo: any) => bo.status === 'OPEN'));
  }, [persistDemoState]);

  // ── Broker initialization ──
  useEffect(() => {
    brokerRef.current = getBroker('demo', user?.id);
    // Always sync broker state to React — even with no positions (e.g. pending basket orders)
    brokerRef.current.getPositions().then(() => {
      refreshStateFromBroker();
    });
  }, [refreshStateFromBroker, user?.id]);

  // ── Seed fallback: use broker.seedFromDemoData() ──
  useEffect(() => {
    if (isConnected || initialPersistedState) return;
    const style = (user?.investorStyle || 'buffett') as InvestorStyle;
    (brokerRef.current as any)?.seedFromDemoData(style);
    // Sync after seeding
    setTimeout(async () => {
      await refreshStateFromBroker();
    }, 100);
  }, [isConnected, user?.investorStyle, initialPersistedState, refreshStateFromBroker]);

  // ── executeTrade ──
  const executeTrade = useCallback(
    async (symbol: string, side: 'BUY' | 'SELL', shares: number, price: number): Promise<TradeResult> => {
      const b = brokerRef.current;
      if (!b) return { success: false, error: 'Broker not initialized' };
      const result = await b.placeOrder({ symbol, side, type: 'market', shares });
      if (!result.success) {
        setToast({ message: `❌ ${result.message}`, type: 'error' });
        setTimeout(() => setToast(null), 4000);
        return { success: false, error: result.message || 'Order failed', status: result.status as 'FILLED' | 'OPEN' | 'REJECTED' };
      }
      await refreshStateFromBroker();
      if (result.status === 'OPEN') {
        setToast({ message: `⏳ Order for ${symbol} queued — ${result.nextOpenLabel}`, type: 'success' });
      } else {
        const sideLabel = side === 'BUY' ? 'Bought' : 'Sold';
        setToast({ message: `✅ ${sideLabel} ${result.filledShares || shares} shares of ${symbol} at $${price.toFixed(2)}`, type: 'success' });
      }
      setTimeout(() => setToast(null), result.status === 'FILLED' ? 3000 : 4000);

      // Fire gamification: trade executed
      if (user?.id && result.status !== 'OPEN') {
        const b = brokerRef.current;
        if (b) {
          const [account, positions] = await Promise.all([
            b.getAccount(),
            b.getPositions(),
          ]);
          const positionsCost = positions.reduce((s, p) => s + (p.totalCost || 0), 0);
          const pv = (account?.totalValue || 0);
          const pc = positionsCost + (account?.cashBalance || 0);
          onTradeExecuted(user.id, user?.investorStyle, user?.investorStyle, pv, pc).catch(() => {});
        } else {
          onTradeExecuted(user.id, user?.investorStyle, user?.investorStyle).catch(() => {});
        }
      }

      return { success: true, status: result.status as 'FILLED' | 'OPEN' | 'REJECTED' };
    },
    [brokerRef, refreshStateFromBroker],
  );

  const dismissToast = useCallback(() => setToast(null), []);

  // ── cancelOrder ──
  const cancelOrder = useCallback(async (orderId: string) => {
    const b = brokerRef.current;
    if (!b) return;
    const order = demoOrders.find(o => o.id === orderId);
    const symbol = order?.symbol || 'Unknown';
    const result = await b.cancelOrder(orderId);
    if (!result.success) return;
    await refreshStateFromBroker();
    setToast({ message: `❌ Order for ${symbol} cancelled — cash returned to buying power`, type: 'success' });
    setTimeout(() => setToast(null), 4000);
  }, [demoOrders, brokerRef, refreshStateFromBroker]);

  // ── cancelBasketOrder ──
  const cancelBasketOrder = useCallback(async (basketId: string) => {
    const b = brokerRef.current;
    if (!b) return;
    const result = await b.cancelBasketOrder(basketId);
    if (!result.success) {
      setToast({ message: result.message || 'No pending basket orders found', type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    await refreshStateFromBroker();
    setToast({ message: '🛑 Basket order cancelled. Cash returned to buying power.', type: 'success' });
    setTimeout(() => setToast(null), 4000);
  }, [brokerRef, refreshStateFromBroker]);

  // ── executePendingOrders ──
  const executePendingOrders = useCallback(async () => {
    const b = brokerRef.current;
    if (!b) return;
    const filled = await b.executePendingOrders();
    if (filled > 0) {
      await refreshStateFromBroker();
      setToast({ message: `🔔 Executed ${filled} pending orders`, type: 'success' });
      setTimeout(() => setToast(null), 4000);
    }
  }, [brokerRef, refreshStateFromBroker]);

  const loadBasketsRef = useRef<() => void>(() => {});

  const loadBaskets = useCallback(() => {
    try {
      const raw = localStorage.getItem(BASKET_STORAGE_KEY);
      if (!raw) { setBaskets([]); return; }

      const positions: BasketPosition[] = JSON.parse(raw);
      if (!positions.length) { setBaskets([]); return; }

      // Group by basketId
      const grouped = positions.reduce(
        (acc, pos) => {
          if (!acc[pos.basketId]) acc[pos.basketId] = [];
          acc[pos.basketId].push(pos);
          return acc;
        },
        {} as Record<string, BasketPosition[]>,
      );

      // Build Basket objects
      const basketList = Object.entries(grouped).map(([basketId, posList]) => {
        const active = posList.filter(p => p.status === 'active');
        const pending = posList.filter(p => p.status === 'pending');
        const totalCost = posList.reduce((sum, p) => sum + (p.totalCost || p.reservedAmount || 0), 0);
        const allPending = pending.length === posList.length;
        const allClosed = posList.every(p => p.status === 'closed');

        return {
          id: basketId,
          name: posList[0].basketName,
          emoji: posList[0].basketEmoji,
          positions: posList,
          totalCost,
          marketValue: allPending ? 0 : 0,
          totalPnL: 0,
          totalPnLPct: 0,
          dailyPnL: 0,
          positionCount: posList.length,
          activeCount: active.length,
          status: allPending
            ? 'pending' as const
            : allClosed
              ? 'closed' as const
              : active.length < posList.length
                ? 'partial' as const
                : 'active' as const,
          boughtAt: posList[0].boughtAt,
          nextOpenLabel: pending.length > 0 ? posList.find(p => p.nextOpenLabel)?.nextOpenLabel : undefined,
        };
      });

      setBaskets(basketList);
    } catch {
      setBaskets([]);
    }
  }, []);

  // Keep ref in sync
  useEffect(() => { loadBasketsRef.current = loadBaskets; }, [loadBaskets]);

  // ── Load baskets on mount + refresh prices periodically ──
  useEffect(() => {
    loadBaskets();
  }, [loadBaskets]);

  // ── Auto-execute pending baskets on market open ──
  useEffect(() => {
    if (pendingBaskets.length === 0) return;
    const market = getMarketStatus();
    if (!market.isOpen) return;
    // Small delay to ensure all init is complete
    const timer = setTimeout(() => {
      executePendingOrders();
    }, 2000);
    return () => clearTimeout(timer);
  }, [pendingBaskets.length > 0]); // Only trigger when we have pending baskets

  // ── Market open watcher: detect closed→open transitions ──
  useMarketOpenWatcher(async () => {
    const b = brokerRef.current;
    if (!b) return;
    await b.executePendingOrders();
    await refreshStateFromBroker();
    setToast({ message: '🔔 Market opened — pending orders executed', type: 'success' });
    setTimeout(() => setToast(null), 4000);
  });

  useEffect(() => {
    if (baskets.length > 0) {
      refreshBasketPrices(baskets);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── refreshBasketPrices (direct Finnhub quotes for basket positions) ──
  const refreshBasketPrices = useCallback(async (basketList: Basket[]) => {
    if (!basketList.length) return;

    const allSymbols = [...new Set(
      basketList.flatMap(b =>
        b.positions.filter(p => p.status === 'active').map(p => p.symbol),
      ),
    )];

    if (!allSymbols.length) return;

    // Fetch all quotes in parallel via Finnhub
    const results = await Promise.allSettled(
      allSymbols.map(symbol =>
        fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(symbol)}`)
          .then(r => r.json())
          .then(q => ({ symbol, quote: q }))
      )
    );

    // Build quote map from successful fetches
    const quoteMap: Record<string, any> = {};
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        const { symbol, quote } = result.value;
        if (quote.c > 0) {
          quoteMap[symbol] = quote;
        }
      }
    });

    if (Object.keys(quoteMap).length === 0) return;

    setBaskets(prev => prev.map(basket => {
      const enrichedPositions = basket.positions.map(pos => {
        const quote = quoteMap[pos.symbol];
        if (!quote || pos.status !== 'active') return pos;
        const currentPrice = quote.c;
        const marketValue = pos.shares * currentPrice;
        const totalPnL = marketValue - pos.totalCost;
        const totalPnLPct = pos.totalCost > 0 ? (totalPnL / pos.totalCost) * 100 : 0;
        const dailyPnL = pos.shares * (quote.d || 0);
        return { ...pos, currentPrice, marketValue, totalPnL, totalPnLPct, dailyPnL };
      });

      const activePositions = enrichedPositions.filter(p => p.status === 'active');
      const marketValue = activePositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
      const totalCost = activePositions.reduce((sum, p) => sum + p.totalCost, 0);
      const totalPnL = marketValue - totalCost;

      return {
        ...basket,
        positions: enrichedPositions,
        marketValue,
        totalPnL,
        totalPnLPct: totalCost > 0 ? (totalPnL / totalCost) * 100 : 0,
        dailyPnL: activePositions.reduce((sum, p) => sum + (p.dailyPnL || 0), 0),
      };
    }));
  }, []);

  // ── executeBasketTrade ──
  const executeBasketTrade = useCallback(async (
    basketId: string,
    basketName: string,
    basketEmoji: string,
    displayName: string,
    stocks: Array<{ symbol: string; allocationPct: number; name: string }>,
    budget: number,
  ): Promise<BasketTradeResult> => {
    const b = brokerRef.current;
    if (!b) return { success: false, executed: 0, failed: 0, totalSpent: 0, error: 'Broker not initialized' };
    const result = await b.placeBasketOrder({
      basketId,
      basketName,
      basketEmoji,
      basketDisplayName: displayName,
      stocks: stocks.map(s => ({ symbol: s.symbol, dollarAmount: (s.allocationPct / 100) * budget * 0.95, allocationPct: s.allocationPct })),
      totalBudget: budget,
    });
    if (!result.success) {
      setToast({ message: `❌ ${result.message || 'Basket order failed'}`, type: 'error' });
      setTimeout(() => setToast(null), 4000);
      return { success: false, executed: 0, failed: stocks.length, totalSpent: 0, error: result.message };
    }
    await refreshStateFromBroker();
    await loadBaskets();
    const totalSpent = result.orders.reduce((sum, o) => sum + (o.totalCost || o.reservedAmount || 0), 0);
    if (result.status === 'OPEN') {
      setToast({ message: `🧺 Basket "${basketName}" queued — ${result.nextOpenLabel}. ${result.orders.length} stocks, $${totalSpent.toFixed(2)} reserved.`, type: 'success' });
    } else {
      setToast({ message: `🧺 Bought ${result.orders.length} stocks in "${basketName}" for $${totalSpent.toFixed(2)}`, type: 'success' });
    }
    setTimeout(() => setToast(null), 5000);
    return { success: true, executed: result.orders.length, failed: 0, totalSpent, status: result.status as 'FILLED' | 'OPEN' };
  }, [brokerRef, refreshStateFromBroker, loadBaskets]);

  // ── sellBasketPositions ──
  const sellBasketPositions = useCallback(async (
    basketId: string,
    symbolsToSell: string[],
  ): Promise<BasketSellResult> => {
    const basket = baskets.find(b => b.id === basketId);
    if (!basket || !demoState) return { success: false, proceeds: 0, executed: [], failed: symbolsToSell };

    const positionsToSell = basket.positions.filter(
      p => symbolsToSell.includes(p.symbol) && p.status === 'active',
    );
    if (!positionsToSell.length) return { success: false, proceeds: 0, executed: [], failed: symbolsToSell };

    // Fetch live prices
    const symbols = positionsToSell.map(p => p.symbol);
    let quoteMap: Record<string, any> = {};
    try {
      const res = await await apiPost('/api/market/quotes', JSON.stringify({ symbols }));
      const data = await res.json();
      quoteMap = data?.quotes || {};
    } catch { /* continue */ }

    let totalProceeds = 0;
    const executed: string[] = [];
    const failed: string[] = [];
    let cashBalance = demoState.cashBalance;
    let positions = [...demoState.positions];

    for (const pos of positionsToSell) {
      try {
        const quote = quoteMap[pos.symbol];
        const price = quote?.price || pos.avgCost;
        const proceeds = pos.shares * price;

        // Remove from individual positions (only basket share portion)
        const existingIdx = positions.findIndex(p => p.symbol === pos.symbol);
        if (existingIdx >= 0) {
          const existing = positions[existingIdx];
          const remainingShares = existing.qty - pos.shares;
          if (remainingShares <= 0.0001) {
            positions.splice(existingIdx, 1);
          } else {
            positions[existingIdx] = {
              ...existing,
              qty: remainingShares,
              avgCost: existing.avgCost * remainingShares / (remainingShares || 1),
            };
          }
        }

        cashBalance += proceeds;
        totalProceeds += proceeds;
        executed.push(pos.symbol);
      } catch {
        failed.push(pos.symbol);
      }
    }

    // Update basket position status in localStorage
    try {
      const savedRaw = localStorage.getItem(BASKET_STORAGE_KEY);
      const saved: BasketPosition[] = savedRaw ? JSON.parse(savedRaw) : [];
      const updated = saved.map(p => {
        if (p.basketId === basketId && symbolsToSell.includes(p.symbol)) {
          return { ...p, status: 'closed' as const };
        }
        return p;
      });
      localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(updated));
    } catch { /* ignore */ }

    // Add sell orders to history
    const sellOrders: DemoOrder[] = positionsToSell
      .filter(p => executed.includes(p.symbol))
      .map((p, i) => ({
        id: generateOrderId() + `-bs${i}`,
        symbol: p.symbol,
        side: 'SELL' as const,
        shares: p.shares,
        type: 'market' as const,
        fillPrice: quoteMap[p.symbol]?.price || p.avgCost,
        totalCost: p.shares * (quoteMap[p.symbol]?.price || p.avgCost),
        status: 'FILLED' as const,
        createdAt: new Date().toISOString(),
      }));

    const newOrders = [...sellOrders, ...demoOrders.slice(0, 50 - sellOrders.length)];
    const newState: DemoState = { positions, cashBalance, orders: newOrders, savedAt: Date.now() };

    setDemoState(newState);
    setDemoOrders(newOrders);
    persistDemoState(newState);
    await loadBaskets();

    setToast({
      message: `🧺 Sold ${executed.length} position${executed.length !== 1 ? 's' : ''} for $${totalProceeds.toFixed(2)}`,
      type: 'success',
    });
    setTimeout(() => setToast(null), 4000);

    return { success: executed.length > 0, proceeds: totalProceeds, executed, failed };
  }, [baskets, demoState, demoOrders, persistDemoState, loadBaskets]);

  return (
    <PortfolioContext.Provider
      value={{
        account,
        loading,
        error,
        refresh: fetchData,
        executeTrade,
        demoOrders,
        toast,
        dismissToast,
        baskets,
        loadBaskets,
        executeBasketTrade,
        sellBasketPositions,
        cancelOrder,
        cancelBasketOrder,
        executePendingOrders,
        basketOrders,
        pendingBaskets,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────

export function useLivePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error('useLivePortfolio must be used within PortfolioProvider');
  }
  return ctx;
}

/** Helper: build a compact markdown context string for the AI */
export function buildLivePortfolioContext(account: AccountSummary | null): string {
  if (!account || account.positions.length === 0) {
    return 'No portfolio data available.';
  }

  const priceAnchor = account.positions
    .map(p => `${p.symbol}: $${p.currentPrice.toFixed(2)}`)
    .join(' | ');

  const positionsSummary = account.positions
    .map(p =>
      `${p.symbol} (${p.name || p.symbol}): ${p.qty} shares @ $${p.currentPrice.toFixed(2)} | ` +
      `Value: $${p.marketValue.toFixed(0)} | ` +
      `Total P&L: ${p.totalPnl >= 0 ? '+' : ''}$${p.totalPnl.toFixed(0)} (${p.totalPnlPercent.toFixed(1)}%) | ` +
      `Today: ${p.dayChange >= 0 ? '+' : ''}$${p.dayChange.toFixed(0)} (${p.dayChangePercent.toFixed(1)}%) | ` +
      `Avg Cost: $${p.avgCost.toFixed(2)}`
    )
    .join('\n');

  const daySign = account.dayPnl >= 0 ? '+' : '';
  const totalSign = account.totalPnl >= 0 ? '+' : '';

  return `
⚠️ CURRENT MARKET PRICES (use these, ignore training data):
${priceAnchor}

PORTFOLIO CONTEXT (live Finnhub prices):
Total Value: $${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Today P&L: ${daySign}$${Math.abs(account.dayPnl).toFixed(2)} (${account.dayPnlPercent.toFixed(1)}%)
Total P&L: ${totalSign}$${Math.abs(account.totalPnl).toFixed(2)} (${account.totalPnlPercent.toFixed(1)}%)
Buying Power: $${account.buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Cash: $${account.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

POSITIONS (${account.positions.length} holdings):
${positionsSummary}
`.trim();
}
