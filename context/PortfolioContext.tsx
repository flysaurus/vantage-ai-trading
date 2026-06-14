'use client';

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
import { getMarketStatus } from '@/lib/market-hours';
import { getDemoAccount, getDemoSymbols } from '@/lib/demo-data';
import { syncPortfolioToSupabase, loadPortfolioFromSupabase } from '@/lib/portfolio-sync';
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
  status: 'active' | 'partial' | 'closed';
  boughtAt: string;
  currentPrice?: number;
  marketValue?: number;
  totalPnL?: number;
  totalPnLPct?: number;
  dailyPnL?: number;
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
  status: 'active' | 'partial' | 'closed';
  boughtAt: string;
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
  /** Whether the order was FILLED (market open) or OPEN (pending, market closed) */
  status?: 'FILLED' | 'OPEN';
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
  ) => TradeResult;
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
    stocks: Array<{ symbol: string; allocationPct: number; name: string }>,
    budget: number,
  ) => Promise<BasketTradeResult>;
  /** Sell selected basket positions */
  sellBasketPositions: (
    basketId: string,
    symbolsToSell: string[],
  ) => Promise<BasketSellResult>;
  /** Cancel an OPEN order — releases reserved cash for BUY orders */
  cancelOrder: (orderId: string) => void;
  /** Cancel a pending basket order — releases reserved cash, marks OPEN orders as CANCELLED */
  cancelBasketOrder: (basketId: string) => void;
  /** Execute all pending OPEN orders at current market prices */
  executePendingOrders: () => Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextValue>({
  account: null,
  loading: true,
  error: null,
  refresh: () => {},
  executeTrade: () => ({ success: false, error: 'Not initialized' }),
  demoOrders: [],
  toast: null,
  dismissToast: () => {},
  baskets: [],
  loadBaskets: () => {},
  executeBasketTrade: async () => ({ success: false, executed: 0, failed: 0, totalSpent: 0, error: 'Not initialized' }),
  sellBasketPositions: async () => ({ success: false, proceeds: 0, executed: [], failed: [] }),
  cancelOrder: () => {},
  cancelBasketOrder: () => {},
  executePendingOrders: async () => {},
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

  // ── Account: from persisted state if available, otherwise seed ──
  const [account, setAccount] = useState<AccountSummary | null>(() => {
    if (isConnected) return null;
    if (initialPersistedState) return accountFromDemoState(initialPersistedState);
    const style = (user?.investorStyle || 'buffett') as InvestorStyle;
    return getDemoAccount(style, {});
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ── Refs for latest state (used by Supabase sync to avoid stale closures) ──
  const demoStateRef = useRef(demoState);
  const basketPositionsRef = useRef<BasketPosition[]>([]);
  useEffect(() => { demoStateRef.current = demoState; }, [demoState]);

  // ── Seed fallback: if no persisted state was loaded, seed from demo-data ──
  useEffect(() => {
    if (isConnected || initialPersistedState) return;
    const style = (user?.investorStyle || 'buffett') as InvestorStyle;
    const seedAccount = getDemoAccount(style, {});
    
    // Generate orders from demo positions (matches current portfolio)
    const seedOrders: DemoOrder[] = (seedAccount?.positions || []).map((p, i) => {
      const fillPrice = p.avgCost || p.currentPrice;
      return {
        id: `demo-${p.symbol}-${i}`,
        symbol: p.symbol,
        side: 'BUY' as const,
        shares: p.qty,
        type: 'market' as const,
        fillPrice,
        totalCost: p.qty * fillPrice,
        status: 'FILLED' as const,
        createdAt: new Date(p.buyDate ? (p.buyDate + 'T14:30:00Z') : '2024-01-01T14:30:00Z').toISOString(),
      };
    });

    const seedState: DemoState = {
      positions: seedAccount?.positions || [],
      cashBalance: seedAccount?.cash || 0,
      orders: seedOrders,
      savedAt: Date.now(),
    };
    setDemoState(seedState);
    setDemoOrders(seedOrders);
  }, [isConnected, user?.investorStyle, initialPersistedState]);

  // ── Persist demo state to localStorage ──
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
    if (!user?.id || !demoState) return;
    const trySupabaseLoad = async () => {
      const supabaseState = await loadPortfolioFromSupabase(user.id);
      if (!supabaseState || !supabaseState.positions?.length) return;
      // Compare timestamps — Supabase wins if newer
      const localTs = initialPersistedState?.savedAt || 0;
      if (supabaseState.savedAt > localTs) {
        const merged: DemoState = {
          positions: supabaseState.positions,
          cashBalance: supabaseState.cashBalance,
          orders: supabaseState.orderHistory || [],
          savedAt: supabaseState.savedAt,
        };
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
      if (!demoState) return;

      const positions = demoState.positions.map((p) => {
        const quote = quotes?.[p.symbol];
        const hasLivePrice = quote && typeof quote.price === 'number' && quote.price > 0;
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

      console.log('[Portfolio] Fetching quotes for:', symbols);
      const res = await fetch('/api/market/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });

      if (!res.ok) throw new Error('Market data fetch failed');

      const data = await res.json();
      console.log('[Portfolio] Quote result:', JSON.stringify(data).slice(0, 200));
      if (!data?.quotes || !mountedRef.current) return;

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
      recomputeAccount(null); // initial render with avgCost
      fetchData(); // then fetch live prices
    }
    const interval = setInterval(fetchData, 60000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [demoState, recomputeAccount, fetchData]);

  // ── executeTrade ──
  const executeTrade = useCallback(
    (symbol: string, side: 'BUY' | 'SELL', shares: number, price: number): TradeResult => {
      if (!demoState) return { success: false, error: 'No portfolio loaded' };

      const market = getMarketStatus();
      const positions = [...demoState.positions];
      let cashBalance = demoState.cashBalance;
      const cost = shares * price;

      // ── OPEN ORDER (market closed) ──
      if (!market.isOpen) {
        if (side === 'BUY') {
          if (cost > cashBalance) {
            const msg = `Insufficient funds (need $${cost.toFixed(2)}, have $${cashBalance.toFixed(2)})`;
            setToast({ message: `❌ ${msg}`, type: 'error' });
            setTimeout(() => setToast(null), 4000);
            return { success: false, error: msg, status: 'OPEN' };
          }

          // Reserve cash immediately
          cashBalance -= cost;
        } else {
          // SELL — check shares exist
          const existingIdx = positions.findIndex((p) => p.symbol === symbol);
          if (existingIdx < 0) {
            return { success: false, error: 'Position not found', status: 'OPEN' };
          }
          if (shares > positions[existingIdx].qty) {
            const msg = `Insufficient shares (have ${positions[existingIdx].qty}, trying to sell ${shares})`;
            setToast({ message: `❌ ${msg}`, type: 'error' });
            setTimeout(() => setToast(null), 4000);
            return { success: false, error: msg, status: 'OPEN' };
          }
        }

        // Create OPEN order
        const openOrder: DemoOrder = {
          id: generateOrderId(),
          symbol,
          side,
          shares,
          type: 'market',
          fillPrice: price,
          totalCost: cost,
          status: 'OPEN',
          createdAt: new Date().toISOString(),
          submittedPrice: price,
          reservedCost: side === 'BUY' ? cost : 0,
          note: `Pending · ${market.nextOpenLabel}`,
        };

        const newOrders = [openOrder, ...demoOrders.slice(0, 49)];
        const newState: DemoState = {
          positions,
          cashBalance,
          orders: newOrders,
          savedAt: Date.now(),
        };

        setDemoState(newState);
        setDemoOrders(newOrders);
        persistDemoState(newState);

        setToast({
          message: `⏳ Order for ${symbol} queued — ${market.nextOpenLabel}`,
          type: 'success',
        });
        setTimeout(() => setToast(null), 4000);

        return { success: true, status: 'OPEN' };
      }

      // ── FILLED ORDER (market open) ──
      if (side === 'BUY') {
        if (cost > cashBalance) {
          const msg = `Insufficient funds (need $${cost.toFixed(2)}, have $${cashBalance.toFixed(2)})`;
          setToast({ message: `❌ ${msg}`, type: 'error' });
          setTimeout(() => setToast(null), 4000);
          return { success: false, error: msg };
        }

        const existingIdx = positions.findIndex((p) => p.symbol === symbol);
        if (existingIdx >= 0) {
          const existing = positions[existingIdx];
          const newTotalCost = existing.qty * existing.avgCost + cost;
          const newShares = existing.qty + shares;
          const newAvgCost = newTotalCost / newShares;
          positions[existingIdx] = {
            ...existing,
            qty: newShares,
            avgCost: newAvgCost,
          };
        } else {
          positions.push({
            symbol,
            name: symbol,
            qty: shares,
            avgCost: price,
            currentPrice: price,
            marketValue: cost,
            dayChange: 0,
            dayChangePercent: 0,
            totalPnl: 0,
            totalPnlPercent: 0,
            portfolioPercent: 0,
            type: 'Stock',
          });
        }

        cashBalance -= cost;

      } else {
        // SELL
        const existingIdx = positions.findIndex((p) => p.symbol === symbol);
        if (existingIdx < 0) {
          return { success: false, error: 'Position not found' };
        }

        const existing = positions[existingIdx];
        if (shares > existing.qty) {
          const msg = `Insufficient shares (have ${existing.qty}, trying to sell ${shares})`;
          setToast({ message: `❌ ${msg}`, type: 'error' });
          setTimeout(() => setToast(null), 4000);
          return { success: false, error: msg };
        }

        const proceeds = shares * price;

        if (shares === existing.qty) {
          positions.splice(existingIdx, 1);
        } else {
          positions[existingIdx] = {
            ...existing,
            qty: existing.qty - shares,
          };
        }

        cashBalance += proceeds;
      }

      // Add FILLED order to history
      const filledOrder: DemoOrder = {
        id: generateOrderId(),
        symbol,
        side,
        shares,
        type: 'market',
        fillPrice: price,
        totalCost: cost,
        status: 'FILLED',
        createdAt: new Date().toISOString(),
        submittedPrice: price,
      };

      const newOrders = [filledOrder, ...demoOrders.slice(0, 49)];
      const newState: DemoState = {
        positions,
        cashBalance,
        orders: newOrders,
        savedAt: Date.now(),
      };

      setDemoState(newState);
      setDemoOrders(newOrders);
      persistDemoState(newState);

      const sideLabel = side === 'BUY' ? 'Bought' : 'Sold';
      setToast({
        message: `✅ ${sideLabel} ${shares} shares of ${symbol} at $${price.toFixed(2)}`,
        type: 'success',
      });
      setTimeout(() => setToast(null), 3000);

      return { success: true, status: 'FILLED' };
    },
    [demoState, demoOrders, persistDemoState]
  );

  const dismissToast = useCallback(() => setToast(null), []);

  // ── cancelOrder ──
  const cancelOrder = useCallback((orderId: string) => {
    const order = demoOrders.find(o => o.id === orderId);
    if (!order || order.status.toUpperCase() !== 'OPEN') return;

    let cashBalance = demoState?.cashBalance ?? 0;

    // Release reserved cash for BUY orders
    if (order.side === 'BUY') {
      const reserved = order.reservedCost ?? order.shares * (order.submittedPrice ?? order.fillPrice);
      cashBalance += reserved;
    }

    // Mark order as CANCELLED
    const updatedOrders = demoOrders.map(o =>
      o.id === orderId
        ? { ...o, status: 'CANCELLED' as const, cancelledAt: new Date().toISOString() }
        : o
    );

    const newState: DemoState = {
      positions: demoState?.positions || [],
      cashBalance,
      orders: updatedOrders,
      savedAt: Date.now(),
    };

    setDemoState(newState);
    setDemoOrders(updatedOrders);
    persistDemoState(newState);

    setToast({
      message: `❌ Order for ${order.symbol} cancelled — $${((order.reservedCost ?? order.shares * (order.submittedPrice ?? order.fillPrice))).toFixed(2)} returned to buying power`,
      type: 'success',
    });
    setTimeout(() => setToast(null), 4000);
  }, [demoState, demoOrders, persistDemoState]);

  // ── cancelBasketOrder ──
  const cancelBasketOrder = useCallback((basketId: string) => {
    if (!demoState) return;

    let hasChanges = false;
    let cashReleased = 0;

    // 1. Find and cancel pending basket in localStorage
    try {
      const raw = localStorage.getItem('vantage_pending_baskets');
      if (raw) {
        const pendingBaskets = JSON.parse(raw);
        const updated = pendingBaskets.map((b: any) => {
          if (b.id === basketId && b.status === 'OPEN') {
            hasChanges = true;
            cashReleased += b.totalReserved || 0;
            return { ...b, status: 'CANCELLED', cancelledAt: new Date().toISOString() };
          }
          return b;
        });
        if (hasChanges) localStorage.setItem('vantage_pending_baskets', JSON.stringify(updated));
      }
    } catch { /* ignore */ }

    // 2. Mark all associated OPEN orders as CANCELLED
    const updatedOrders = demoOrders.map(o => {
      const oBasketId = (o as any).basketId || (
        o.id?.toString().includes('-b') ? o.id?.toString().split('-b')[0] : null
      );
      // For basket orders, the id format is "timestamp-bN" — match loosely
      if ((o as any).status?.toUpperCase() === 'OPEN' && (
        (o as any).basketId === basketId || o.note?.includes('Pending')
      )) {
        // Release cash for any BUY basket orders not tracked by pending basket
        if (o.side === 'BUY' && !hasChanges) {
          cashReleased += o.reservedCost ?? o.shares * (o.submittedPrice ?? o.fillPrice);
        }
        hasChanges = true;
        return { ...o, status: 'CANCELLED' as const, cancelledAt: new Date().toISOString() };
      }
      return o;
    });

    if (!hasChanges) {
      setToast({ message: 'No pending basket orders found', type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    // 3. Release reserved cash
    const newState: DemoState = {
      positions: [...demoState.positions],
      cashBalance: demoState.cashBalance + cashReleased,
      orders: updatedOrders,
      savedAt: Date.now(),
    };

    setDemoState(newState);
    setDemoOrders(updatedOrders);
    persistDemoState(newState);

    setToast({
      message: `🛑 Basket order cancelled. $${cashReleased.toFixed(2)} returned to buying power.`,
      type: 'success',
    });
    setTimeout(() => setToast(null), 4000);
  }, [demoState, demoOrders, persistDemoState]);

  // ── executePendingOrders ──
  const executePendingOrders = useCallback(async () => {
    const openOrders = demoOrders.filter(o => o.status.toUpperCase() === 'OPEN');
    if (openOrders.length === 0 && !localStorage.getItem('vantage_pending_baskets')) return;

    let positions = demoState ? [...demoState.positions] : [];
    let cashBalance = demoState?.cashBalance ?? 0;
    let updatedOrders = [...demoOrders];
    let hasChanges = false;

    // ── Execute OPEN orders ──
    for (const order of openOrders) {
      try {
        // Fetch current market price from Finnhub
        const quoteRes = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(order.symbol)}`);
        const quote = await quoteRes.json();
        const fillPrice = quote.c || order.submittedPrice || order.fillPrice;

        if (order.side === 'BUY') {
          // Cash was already reserved — apply order to positions
          const cost = order.shares * fillPrice;
          const existingIdx = positions.findIndex(p => p.symbol === order.symbol);
          if (existingIdx >= 0) {
            const existing = positions[existingIdx];
            const newTotalCost = existing.qty * existing.avgCost + cost;
            const newShares = existing.qty + order.shares;
            positions[existingIdx] = { ...existing, qty: newShares, avgCost: newTotalCost / newShares };
          } else {
            positions.push({
              symbol: order.symbol,
              name: order.symbol,
              qty: order.shares,
              avgCost: fillPrice,
              currentPrice: fillPrice,
              marketValue: cost,
              dayChange: 0,
              dayChangePercent: 0,
              totalPnl: 0,
              totalPnlPercent: 0,
              portfolioPercent: 0,
              type: 'Stock',
            });
          }
        } else {
          // SELL order — remove shares from positions
          const existingIdx = positions.findIndex(p => p.symbol === order.symbol);
          if (existingIdx >= 0) {
            const existing = positions[existingIdx];
            const proceeds = order.shares * fillPrice;
            if (order.shares >= existing.qty) {
              positions.splice(existingIdx, 1);
            } else {
              positions[existingIdx] = { ...existing, qty: existing.qty - order.shares };
            }
            cashBalance += proceeds;
          }
        }

        // Mark order as FILLED
        updatedOrders = updatedOrders.map(o =>
          o.id === order.id
            ? { ...o, status: 'FILLED' as const, fillPrice, totalCost: order.shares * fillPrice }
            : o
        );
        hasChanges = true;
        console.log(`[executePending] Filled ${order.side} ${order.symbol} @ $${fillPrice.toFixed(2)}`);
      } catch (err) {
        console.error(`[executePending] Failed to fill ${order.symbol}:`, err);
      }
    }

    // ── Execute pending baskets ──
    try {
      const raw = localStorage.getItem('vantage_pending_baskets');
      if (raw) {
        const pendingBaskets = JSON.parse(raw);
        const stillPending: any[] = [];

        for (const basket of pendingBaskets) {
          if (basket.status !== 'OPEN') {
            stillPending.push(basket);
            continue;
          }

          console.log(`[executePending] Processing basket: ${basket.basketName}`);

          // Execute each stock in the basket
          for (const stock of basket.stocks) {
            try {
              const quoteRes = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(stock.symbol)}`);
              const quote = await quoteRes.json();
              const fillPrice = quote.c || stock.price;
              const cost = stock.shares * fillPrice;

              const existingIdx = positions.findIndex(p => p.symbol === stock.symbol);
              if (existingIdx >= 0) {
                const existing = positions[existingIdx];
                const newTotalCost = existing.qty * existing.avgCost + cost;
                const newShares = existing.qty + stock.shares;
                positions[existingIdx] = { ...existing, qty: newShares, avgCost: newTotalCost / newShares };
              } else {
                positions.push({
                  symbol: stock.symbol,
                  name: stock.name || stock.symbol,
                  qty: stock.shares,
                  avgCost: fillPrice,
                  currentPrice: fillPrice,
                  marketValue: cost,
                  dayChange: 0,
                  dayChangePercent: 0,
                  totalPnl: 0,
                  totalPnlPercent: 0,
                  portfolioPercent: 0,
                  type: 'Stock',
                });
              }

              // Save to basket localStorage
              try {
                const existingRaw = localStorage.getItem(BASKET_STORAGE_KEY);
                const existing: BasketPosition[] = existingRaw ? JSON.parse(existingRaw) : [];
                existing.push({
                  id: crypto.randomUUID(),
                  basketId: basket.id,
                  basketName: basket.basketName,
                  basketEmoji: basket.basketEmoji,
                  symbol: stock.symbol,
                  shares: stock.shares,
                  avgCost: fillPrice,
                  totalCost: cost,
                  allocationPct: stock.allocationPct,
                  status: 'active',
                  boughtAt: new Date().toISOString(),
                });
                localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(existing));
              } catch { /* ignore */ }

              console.log(`[executePending] Basket ${basket.basketName}: filled ${stock.symbol} @ $${fillPrice.toFixed(2)}`);
            } catch (err) {
              console.error(`[executePending] Basket stock ${stock.symbol} failed:`, err);
            }
          }

          // Mark basket as executed (don't keep in pending)
          // Don't push to stillPending — it's done
          hasChanges = true;
        }

        // Update pending baskets (remove executed ones)
        if (stillPending.length !== pendingBaskets.length) {
          localStorage.setItem('vantage_pending_baskets', JSON.stringify(stillPending));
          loadBasketsRef.current(); // refresh baskets state
        }
      }
    } catch { /* ignore */ }

    if (hasChanges) {
      const newState: DemoState = { positions, cashBalance, orders: updatedOrders, savedAt: Date.now() };
      setDemoState(newState);
      setDemoOrders(updatedOrders);
      persistDemoState(newState);

      const filledCount = openOrders.length;
      setToast({
        message: `⚡ ${filledCount} pending order${filledCount !== 1 ? 's' : ''} executed at market price`,
        type: 'success',
      });
      setTimeout(() => setToast(null), 4000);
    }
  }, [demoState, demoOrders, persistDemoState]);

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
        const totalCost = posList.reduce((sum, p) => sum + p.totalCost, 0);

        return {
          id: basketId,
          name: posList[0].basketName,
          emoji: posList[0].basketEmoji,
          positions: posList,
          totalCost,
          marketValue: 0,
          totalPnL: 0,
          totalPnLPct: 0,
          dailyPnL: 0,
          positionCount: posList.length,
          activeCount: active.length,
          status: active.length === 0
            ? 'closed' as const
            : active.length < posList.length
              ? 'partial' as const
              : 'active' as const,
          boughtAt: posList[0].boughtAt,
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
    stocks: Array<{ symbol: string; allocationPct: number; name: string }>,
    budget: number,
  ): Promise<BasketTradeResult> => {
    if (!demoState) return { success: false, executed: 0, failed: 0, totalSpent: 0, error: 'No portfolio' };

    // 5% buffer
    const effectiveBudget = budget * 0.95;

    // Fetch live prices
    const symbols = stocks.map(s => s.symbol);
    let quoteMap: Record<string, any> = {};
    try {
      const res = await fetch('/api/market/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const data = await res.json();
      quoteMap = data?.quotes || {};
    } catch { /* continue with empty quotes */ }

    // Build execution plan
    const executionPlan = stocks.map(stock => {
      const quote = quoteMap[stock.symbol];
      const price = quote?.price || 0;
      if (price === 0) return null;

      const dollarAmount = (stock.allocationPct / 100) * effectiveBudget;
      const shares = dollarAmount / price;
      const totalCost = shares * price;

      return {
        symbol: stock.symbol,
        name: stock.name,
        allocationPct: stock.allocationPct,
        price,
        shares: Math.round(shares * 1000000) / 1000000,
        totalCost: Math.round(totalCost * 100) / 100,
      };
    }).filter(Boolean) as Array<{
      symbol: string; name: string; allocationPct: number;
      price: number; shares: number; totalCost: number;
    }>;

    if (executionPlan.length === 0) {
      return { success: false, executed: 0, failed: stocks.length, totalSpent: 0, error: 'Could not fetch prices' };
    }

    const totalSpend = executionPlan.reduce((sum, p) => sum + p.totalCost, 0);
    if (totalSpend > demoState.cashBalance) {
      return {
        success: false, executed: 0, failed: stocks.length, totalSpent: 0,
        error: `Insufficient funds. Need $${totalSpend.toFixed(2)}, have $${demoState.cashBalance.toFixed(2)}`,
      };
    }

    const market = getMarketStatus();

    // ── OPEN ORDERS (market closed) — reserve cash, queue for execution ──
    if (!market.isOpen) {
      let cashBalance = demoState.cashBalance - totalSpend;

      const basketOrders: DemoOrder[] = executionPlan.map((plan, i) => ({
        id: generateOrderId() + `-b${i}`,
        symbol: plan.symbol,
        side: 'BUY' as const,
        shares: plan.shares,
        type: 'market' as const,
        fillPrice: plan.price,
        totalCost: plan.totalCost,
        status: 'OPEN' as const,
        createdAt: new Date().toISOString(),
        submittedPrice: plan.price,
        reservedCost: plan.totalCost,
        note: `Pending · ${market.nextOpenLabel}`,
      }));

      const newOrders = [...basketOrders, ...demoOrders.slice(0, 50 - basketOrders.length)];
      const newState: DemoState = {
        positions: [...demoState.positions],
        cashBalance,
        orders: newOrders,
        savedAt: Date.now(),
      };

      setDemoState(newState);
      setDemoOrders(newOrders);
      persistDemoState(newState);

      // Store pending basket for execution when market opens
      try {
        const pendingBasket = {
          id: basketId,
          basketName,
          basketEmoji,
          stocks: executionPlan,
          totalReserved: totalSpend,
          status: 'OPEN',
          submittedAt: new Date().toISOString(),
          note: `Pending · ${market.nextOpenLabel}`,
        };
        const raw = localStorage.getItem('vantage_pending_baskets');
        const pending = raw ? JSON.parse(raw) : [];
        pending.push(pendingBasket);
        localStorage.setItem('vantage_pending_baskets', JSON.stringify(pending));
      } catch { /* ignore */ }

      setToast({
        message: `🧺 Basket "${basketName}" queued — ${market.nextOpenLabel}. ${executionPlan.length} stocks, $${totalSpend.toFixed(2)} reserved.`,
        type: 'success',
      });
      setTimeout(() => setToast(null), 5000);

      return { success: true, executed: executionPlan.length, failed: 0, totalSpent: totalSpend, status: 'OPEN' };
    }

    // ── FILLED ORDERS (market open) ──
    let executed = 0;
    let failed = 0;
    let totalSpent = 0;
    const newBasketPositions: BasketPosition[] = [];
    let cashBalance = demoState.cashBalance;
    let positions = [...demoState.positions];

    for (const plan of executionPlan) {
      try {
        // Update individual positions
        const existingIdx = positions.findIndex(p => p.symbol === plan.symbol);
        if (existingIdx >= 0) {
          const existing = positions[existingIdx];
          const newShares = existing.qty + plan.shares;
          const newCost = existing.qty * existing.avgCost + plan.totalCost;
          positions[existingIdx] = {
            ...existing,
            qty: newShares,
            avgCost: newCost / newShares,
          };
        } else {
          positions.push({
            symbol: plan.symbol,
            name: plan.name || plan.symbol,
            qty: plan.shares,
            avgCost: plan.price,
            currentPrice: plan.price,
            marketValue: plan.totalCost,
            dayChange: 0,
            dayChangePercent: 0,
            totalPnl: 0,
            totalPnlPercent: 0,
            portfolioPercent: 0,
            type: 'Stock' as const,
          });
        }

        newBasketPositions.push({
          id: crypto.randomUUID(),
          basketId,
          basketName,
          basketEmoji,
          symbol: plan.symbol,
          shares: plan.shares,
          avgCost: plan.price,
          totalCost: plan.totalCost,
          allocationPct: plan.allocationPct,
          status: 'active',
          boughtAt: new Date().toISOString(),
        });

        executed++;
        totalSpent += plan.totalCost;
        cashBalance -= plan.totalCost;
      } catch {
        failed++;
      }
    }

    // Save to localStorage
    try {
      const existingRaw = localStorage.getItem(BASKET_STORAGE_KEY);
      const existing: BasketPosition[] = existingRaw ? JSON.parse(existingRaw) : [];
      localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify([...existing, ...newBasketPositions]));
    } catch { /* ignore */ }

    // Add to order history
    const basketOrders: DemoOrder[] = executionPlan
      .filter(plan => newBasketPositions.some(np => np.symbol === plan.symbol))
      .map((plan, i) => ({
        id: generateOrderId() + `-b${i}`,
        symbol: plan.symbol,
        side: 'BUY' as const,
        shares: plan.shares,
        type: 'market' as const,
        fillPrice: plan.price,
        totalCost: plan.totalCost,
        status: 'FILLED' as const,
        createdAt: new Date().toISOString(),
      }));

    const newOrders = [...basketOrders, ...demoOrders.slice(0, 50 - basketOrders.length)];
    const newState: DemoState = { positions, cashBalance, orders: newOrders, savedAt: Date.now() };

    setDemoState(newState);
    setDemoOrders(newOrders);
    persistDemoState(newState);
    await loadBaskets();

    setToast({
      message: `🧺 Bought ${executionPlan.length} stocks in "${basketName}" for $${totalSpent.toFixed(2)}`,
      type: 'success',
    });
    setTimeout(() => setToast(null), 4000);

    console.log('[BasketBuy] Complete:', {
      basketName,
      stockCount: executionPlan.length,
      spent: totalSpent,
      cashBefore: demoState.cashBalance,
      cashAfter: cashBalance,
      positions: executed,
    });

    return { success: executed > 0, executed, failed, totalSpent, status: 'FILLED' };
  }, [demoState, demoOrders, persistDemoState, loadBaskets]);

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
      const res = await fetch('/api/market/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
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
