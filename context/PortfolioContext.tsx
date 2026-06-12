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
import { getDemoAccount, getDemoSymbols } from '@/lib/demo-data';
import type { AccountSummary, Position, Order } from '@/types';

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
}

interface BasketTradeResult {
  success: boolean;
  executed: number;
  failed: number;
  totalSpent: number;
  error?: string;
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
});

// ─── Provider ──────────────────────────────────────────────

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { isConnected } = useBroker();
  const { user } = useAuth();

  // ── Persistent state (positions, cash, orders) ──
  const [demoState, setDemoState] = useState<DemoState | null>(null);
  const [demoOrders, setDemoOrders] = useState<DemoOrder[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [baskets, setBaskets] = useState<Basket[]>([]);

  // Seed with demo data immediately — cards render on load, prices update async
  const [account, setAccount] = useState<AccountSummary | null>(() => {
    if (isConnected) return null;
    const style = (user?.investorStyle || 'buffett') as any;
    return getDemoAccount(style, {});
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ── Load persisted demo state on mount ──
  useEffect(() => {
    if (isConnected) return;
    try {
      // Clear old unversioned key to force fresh seed
      localStorage.removeItem(OLD_STORAGE_KEY);

      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: DemoState = JSON.parse(raw);
        const age = Date.now() - saved.savedAt;
        if (age < MAX_AGE_MS && saved.positions && saved.positions.length > 0) {
          setDemoState(saved);
          setDemoOrders(saved.orders || []);
          return; // Will be picked up by the account recompute
        }
      }
    } catch { /* ignore corrupt localStorage */ }
    // Fallback: seed from demo-data (positions + generated orders)
    const style = (user?.investorStyle || 'buffett') as any;
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
  }, [isConnected, user?.investorStyle]);

  // ── Persist demo state to localStorage ──
  const persistDemoState = useCallback((state: DemoState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
    } catch { /* ignore quota exceeded */ }
  }, []);

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

      const positions = [...demoState.positions];
      let cashBalance = demoState.cashBalance;

      if (side === 'BUY') {
        const cost = shares * price;
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
        setToast({
          message: `✅ Bought ${shares} shares of ${symbol} at $${price.toFixed(2)}`,
          type: 'success',
        });
        setTimeout(() => setToast(null), 3000);

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
        setToast({
          message: `✅ Sold ${shares} shares of ${symbol} at $${price.toFixed(2)}`,
          type: 'success',
        });
        setTimeout(() => setToast(null), 3000);
      }

      // Add order to history
      const newOrder: DemoOrder = {
        id: generateOrderId(),
        symbol,
        side,
        shares,
        type: 'market',
        fillPrice: price,
        totalCost: shares * price,
        status: 'FILLED',
        createdAt: new Date().toISOString(),
      };

      const newOrders = [newOrder, ...demoOrders.slice(0, 49)]; // keep last 50
      const newState: DemoState = {
        positions,
        cashBalance,
        orders: newOrders,
        savedAt: Date.now(),
      };

      setDemoState(newState);
      setDemoOrders(newOrders);
      persistDemoState(newState);

      return { success: true };
    },
    [demoState, demoOrders, persistDemoState]
  );

  const dismissToast = useCallback(() => setToast(null), []);

  // ── loadBaskets ──
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

  // ── Load baskets on mount + refresh prices periodically ──
  useEffect(() => {
    loadBaskets();
  }, [loadBaskets]);

  useEffect(() => {
    if (baskets.length > 0) {
      refreshBasketPrices(baskets);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── refreshBasketPrices (add real Finnhub quotes to baskets) ──
  const refreshBasketPrices = useCallback(async (basketList: Basket[]) => {
    if (!basketList.length) return;

    const allSymbols = [...new Set(
      basketList.flatMap(b =>
        b.positions.filter(p => p.status === 'active').map(p => p.symbol),
      ),
    )];

    if (!allSymbols.length) return;

    try {
      const res = await fetch('/api/market/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: allSymbols }),
      });

      if (!res.ok) return;

      const data = await res.json();
      const quoteMap: Record<string, any> = data?.quotes || {};

      if (Object.keys(quoteMap).length === 0) return;

      setBaskets(prev => prev.map(basket => {
        const enrichedPositions = basket.positions.map(pos => {
          const quote = quoteMap[pos.symbol];
          if (!quote || pos.status !== 'active') return pos;
          const currentPrice = quote.price || pos.avgCost;
          const marketValue = pos.shares * currentPrice;
          const totalPnL = marketValue - pos.totalCost;
          const totalPnLPct = pos.totalCost > 0 ? (totalPnL / pos.totalCost) * 100 : 0;
          const dailyPnL = pos.shares * (quote.change || 0);
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
    } catch {
      // quote fetch failure is non-critical
    }
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

    return { success: executed > 0, executed, failed, totalSpent };
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
