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
import { useAccounts } from '@/context/AccountContext';
import { useOrderStore } from '@/store';
import { getMarketStatus } from '@/lib/market-hours';
import { syncPortfolioToSupabase, loadPortfolioFromSupabase } from '@/lib/portfolio-sync';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';
import { getBroker, getBrokerAsync } from '@/lib/broker/broker-factory';
import { useMarketOpenWatcher } from '@/hooks/useMarketOpenWatcher';
import type { BrokerEngine, BrokerOrder } from '@/lib/broker/engine';
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
  submittedAt?: string;
  /** Price at which the order was submitted (for OPEN orders) */
  submittedPrice?: number;
  /** Cash reserved for OPEN BUY orders */
  reservedCost?: number;
  /** Optional note (e.g. 'pending execution') */
  note?: string;
  /** When the order was cancelled */
  cancelledAt?: string;
  // Basket metadata — preserved for cron fill processing
  basketOrderId?: string;
  basketId?: string;
  basketName?: string;
  basketEmoji?: string;
  // Advanced order params
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: string;
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
const BASKET_STORAGE_KEY = 'vantage_basket_positions_v1'; // read-only cache key
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const INITIAL_CAPITAL = 100000; // $100K starting demo balance

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
  /** Order ID from the broker, for linking marker executions */
  orderId?: string;
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
    price: number,
    orderType?: 'market' | 'limit' | 'stop' | 'stop_limit',
    stopPrice?: number,
    limitPrice?: number,
    timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok',
    basketId?: string,
    basketName?: string,
    basketEmoji?: string,
  ) => Promise<TradeResult>;
  /** Demo order history */
  demoOrders: DemoOrder[];
  /** Toast message */
  toast: { message: string; type: 'success' | 'error' } | null;
  /** Dismiss toast */
  dismissToast: () => void;
  /** Basket holdings (from localStorage, live-priced) */
  baskets: Basket[];
  /** Reload baskets from Supabase */
  loadBaskets: () => Promise<void>;
  /** Execute a basket trade (all stocks at once) */
  executeBasketTrade: (
    basketId: string,
    basketName: string,
    basketEmoji: string,
    displayName: string,
    stocks: Array<{ symbol: string; allocationPct: number; name: string; fallbackPrice?: number }>,
    budget: number,
  ) => Promise<BasketTradeResult>;
  /** Sell selected basket positions */
  sellBasketPositions: (
    basketId: string,
    symbolsToSell: string[],
    sharesOverride?: Record<string, number>,
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
  /** Whether Supabase is currently unreachable (using stale localStorage cache) */
  supabaseDegraded: boolean;
  /** Data source: 'demo' or 'snaptrade' */
  brokerSource: 'demo' | 'snaptrade';
  /** Broker metadata for UI badges */
  brokerMeta: { slug: string; name: string; tradingEnabled: boolean; isDemo: boolean; environment?: 'paper' | 'live' | 'demo' } | null;
}

const PortfolioContext = createContext<PortfolioContextValue>({
  account: null,
  loading: true,
  error: null,
  refresh: () => {},
  executeTrade: async () => ({ success: false, error: 'Not initialized' } as TradeResult),
  demoOrders: [],
  toast: null,
  dismissToast: () => {},
  baskets: [],
  loadBaskets: async () => {},
  executeBasketTrade: async () => ({ success: false, executed: 0, failed: 0, totalSpent: 0, error: 'Not initialized' }) as any,
  sellBasketPositions: async () => ({ success: false, proceeds: 0, executed: [], failed: [] }),
  cancelOrder: async () => {},
  cancelBasketOrder: () => {},
  executePendingOrders: async () => {},
  basketOrders: [],
  pendingBaskets: [],
  supabaseDegraded: false,
  brokerSource: 'demo',
  brokerMeta: null,
});

// ─── Provider ──────────────────────────────────────────────

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { isConnected, broker } = useBroker();
  const { user } = useAuth();
  const { activeAccount } = useAccounts();
  const isShowingDemo = activeAccount?.isDemo ?? false;

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
  // Capture initial persisted state once in a ref — used by the init effect
  // (raw variable would change every render via JSON.parse, creating a dep-loop)
  const initialPersistedStateRef = useRef(initialPersistedState);
  const [demoState, setDemoState] = useState<DemoState | null>(initialPersistedState);
  const [demoOrders, setDemoOrders] = useState<DemoOrder[]>(initialPersistedState?.orders || []);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [basketOrders, setBasketOrders] = useState<any[]>([]);
  const [pendingBaskets, setPendingBaskets] = useState<any[]>([]);

  // ── Account: from persisted state if available, otherwise cash-only ──
  const [account, setAccount] = useState<AccountSummary | null>(() => {
    if (isConnected) return null;
    if (initialPersistedState) return accountFromDemoState(initialPersistedState);
    // Cash-only default — no fake positions/orders. Real data only from trades.
    return {
      equity: 100_000,
      buyingPower: 100_000,
      cash: 100_000,
      dayPnl: 0,
      dayPnlPercent: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      positions: [],
    };
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ── Refs for latest state (used by Supabase sync to avoid stale closures) ──
  const demoStateRef = useRef(demoState);
  const basketPositionsRef = useRef<BasketPosition[]>([]);
  const brokerRef = useRef<BrokerEngine | null>(null);
  const brokerOrdersRef = useRef<any[]>([]); // raw BrokerOrder[] for Supabase sync
  const brokerBasketOrdersRef = useRef<any[]>([]); // raw BrokerBasketOrder[] for Supabase sync
  const demoSeededRef = useRef(false);
  const submittingTradeRef = useRef(false); // double-submit guard
  const submittingBasketRef = useRef(false); // double-submit guard
  // Track which userId we've already initialized for (prevents re-init loops)
  const brokerInitDoneForUserRef = useRef<string | null>(null);
  // Degradation flag: Supabase unreachable → show warning, use localStorage cache
  const [supabaseDegraded, setSupabaseDegraded] = useState(false);
  const [brokerSource, setBrokerSource] = useState<'demo' | 'snaptrade'>('demo');
  const [brokerMeta, setBrokerMeta] = useState<PortfolioContextValue['brokerMeta']>(null);
  useEffect(() => { demoStateRef.current = demoState; }, [demoState]);

  // ── Bridge demo orders to Zustand OrderStore for OrdersTab rendering ──
  // This is the ONLY path for Demo order data to reach the Orders tab.
  // When Demo is the active account, push all demoOrders into the Zustand store.
  // When NOT showing Demo, let useOrders() manage the store (broker data).
  useEffect(() => {
    if (!isShowingDemo) return;

    const mappedOrders: Order[] = demoOrders.map(d => ({
      id: d.id,
      symbol: d.symbol,
      side: (d.side?.toLowerCase() || 'buy') as 'buy' | 'sell',
      type: (d.type?.toLowerCase() || 'market') as any,
      status: (d.status?.toLowerCase() || 'filled') as any,
      qty: d.shares || 0,
      filledQty: d.shares || 0,
      limitPrice: d.limitPrice,
      stopPrice: d.stopPrice,
      filledPrice: d.fillPrice || d.submittedPrice,
      totalValue: d.totalCost || ((d.shares || 0) * (d.fillPrice || d.submittedPrice || 0)),
      timeInForce: (d.timeInForce || 'day') as any,
      createdAt: d.submittedAt || d.createdAt || new Date().toISOString(),
      updatedAt: d.cancelledAt || d.submittedAt || d.createdAt || new Date().toISOString(),
      bracketOrder: undefined,
    }));

    useOrderStore.getState().setOrders(mappedOrders);
  }, [demoOrders, isShowingDemo]);



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
        orderHistory: brokerOrdersRef.current,       // BrokerOrder[] — full metadata for cron
        basketOrders: brokerBasketOrdersRef.current,  // BrokerBasketOrder[] — linked to broker via same column
        savedAt: demoState.savedAt,
      }).then((didSync) => {
        if (!didSync) {
          // Server had newer data — stale client prevented from overwriting.
          // Trigger a reload from Supabase on next mount.
          console.log('[Portfolio Sync] Client state was stale — server preserved');
        }
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [demoState, user?.id]);

  // ── Supabase: primary source on mount (always wins over localStorage/seeds) ──
  useEffect(() => {
    if (!user?.id) return;
    const trySupabaseLoad = async () => {
      const supabaseState = await loadPortfolioFromSupabase(user.id);
      if (!supabaseState || !supabaseState.positions?.length) return;

      const merged: DemoState = {
        positions: supabaseState.positions,
        cashBalance: supabaseState.cashBalance,
        orders: supabaseState.orderHistory || [],
        savedAt: supabaseState.savedAt, // keep original server timestamp
      };
      console.log('[portfolio init] Supabase load SUCCESS, positions:', supabaseState.positions.length, 'cash:', supabaseState.cashBalance, 'basketOrders:', (supabaseState.basketOrders || []).length);
      setDemoState(merged);
      setDemoOrders(merged.orders);
      // Also update broker refs so sync doesn't push stale seed orders
      brokerOrdersRef.current = supabaseState.orderHistory || [];
      brokerBasketOrdersRef.current = supabaseState.basketOrders || [];
      // Restore basket orders into the broker so they survive localStorage clears
      if (brokerRef.current && supabaseState.basketOrders?.length) {
        (brokerRef.current as any).setBasketOrders?.(supabaseState.basketOrders);
      }
      // Cache in localStorage for speed — preserve original savedAt so sync guard works
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...merged, savedAt: supabaseState.savedAt })); } catch {}
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
          exchange: quote?.exchange || '',
          // Override hardcoded 52-week range with live Yahoo Finance data
          weekHigh52: (quote?.high52w != null && quote.high52w > 0) ? quote.high52w : p.weekHigh52,
          weekLow52: (quote?.low52w != null && quote.low52w > 0) ? quote.low52w : p.weekLow52,
        };
      });

      const totalEquity = positions.reduce((sum, p) => sum + p.marketValue, 0) + demoState.cashBalance;
      const totalCost = positions.reduce((sum, p) => sum + p.qty * p.avgCost, 0);
      const totalPnl = totalEquity - totalCost - demoState.cashBalance;
      // TOTAL % vs $100K starting capital (not invested cost basis)
      const totalPnlPercent = (totalPnl / INITIAL_CAPITAL) * 100;
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
    // Fetch live quotes for demo positions as long as demo state exists.
    // Don't block on isConnected — user may switch to Demo while broker is connected.
    if (!demoState) return;

    try {
      setError(null);

      const symbols = demoState.positions.map((p) => p.symbol);
      if (symbols.length === 0) return;

      console.log('[fetchData] requesting quotes for:', symbols);
      const res = await apiPost('/api/market/quotes', { symbols });

      console.log('[fetchData] raw response status:', res.status);
      if (!res.ok) throw new Error('Market data fetch failed');

      const data = await res.json();
      console.log('[fetchData] raw response data:', JSON.stringify(data).slice(0, 400));
      if (!data?.quotes) return;

      console.log('[fetchData] calling recomputeAccount with quotes keys:', Object.keys(data.quotes));
      recomputeAccount(data.quotes);
      setError(null);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load market data');
      }
    }
  }, [demoState, recomputeAccount]);

  // ── Load real broker data when connected (SnapTrade / Alpaca / etc.) ──
  // This replaces the DemoBroker path — PortfolioContext's account state
  // reflects the user's ACTUAL brokerage data, not demo seed data mislabeled
  // as a connected broker.
  useEffect(() => {
    // ONLY load broker data when the user is actively viewing a broker account.
    // When viewing Demo, leave the account state for the demo-init path.
    if (!isConnected || !broker || isShowingDemo) return;

    let cancelled = false;

    const loadBrokerAccount = async () => {
      try {
        const [ba, positions] = await Promise.all([
          broker.getAccount(),
          broker.getPositions(),
        ]);

        if (cancelled) return;

        const summary: AccountSummary = {
          equity: ba.equity,
          buyingPower: ba.buyingPower,
          cash: ba.cash,
          dayPnl: ba.dayPnl ?? 0,
          dayPnlPercent: ba.dayPnlPercent ?? 0,
          totalPnl: ba.totalPnl ?? 0,
          totalPnlPercent: ba.totalPnlPercent ?? 0,
          positions: positions.map(p => ({
            symbol: p.symbol,
            name: p.name,
            qty: p.qty,
            avgCost: p.avgCost,
            currentPrice: p.currentPrice,
            marketValue: p.marketValue,
            dayChange: p.dayChange,
            dayChangePercent: p.dayChangePercent,
            totalPnl: p.totalPnl,
            totalPnlPercent: p.totalPnlPercent,
            portfolioPercent: p.portfolioPercent,
            sector: p.sector,
            type: p.assetType === 'etf' ? 'ETF' as const : 'Stock' as const,
          })),
        };

        setAccount(summary);
        console.error('[portfolio context] broker-load SUCCESS — equity:', summary.equity, 'positions:', summary.positions.length);
      } catch (e) {
        console.error('[portfolio context] broker-load FAILED:', e);
      }
    };

    loadBrokerAccount();
    return () => { cancelled = true; };
  }, [isConnected, broker, isShowingDemo]);

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
    // Preserve real company names and sectors from previous state when broker doesn't have them
    const prevNames = new Map<string, string>();
    const prevSectors = new Map<string, string>();
    if (demoState) {
      for (const p of demoState.positions) {
        if (p.name && p.name !== p.symbol) prevNames.set(p.symbol, p.name);
        if (p.sector) prevSectors.set(p.symbol, p.sector);
      }
    }
    const ctxPositions = bPositions.map((bp: any) => ({
      symbol: bp.symbol, name: bp.name && bp.name !== bp.symbol ? bp.name : prevNames.get(bp.symbol) || bp.name || bp.symbol,
      sector: bp.sector || prevSectors.get(bp.symbol) || '', qty: bp.shares, avgCost: bp.avgCost,
      currentPrice: bp.avgCost, marketValue: bp.shares * bp.avgCost,
      dayChange: 0, dayChangePercent: 0, totalPnl: 0, totalPnlPercent: 0,
      portfolioPercent: 0, type: bp.type,
      basketId: bp.basketId, basketName: bp.basketName, basketEmoji: bp.basketEmoji,
    }));
    // Compute reserved shares from OPEN sell orders for each position
    const reservedBySymbol = new Map<string, number>();
    for (const o of bOrders) {
      if (o.side === 'SELL' && o.status === 'OPEN' && o.reservedShares) {
        reservedBySymbol.set(o.symbol.toUpperCase(), (reservedBySymbol.get(o.symbol.toUpperCase()) || 0) + o.reservedShares);
      }
    }
    for (const pos of ctxPositions) {
      pos.reservedShares = reservedBySymbol.get(pos.symbol.toUpperCase()) || 0;
    }
    const ctxOrders: DemoOrder[] = bOrders.map((bo: any) => ({
      id: bo.id, symbol: bo.symbol, side: bo.side, shares: bo.shares, type: bo.type,
      fillPrice: bo.fillPrice || bo.submittedPrice, totalCost: bo.totalCost,
      status: bo.status, createdAt: bo.submittedAt, submittedAt: bo.submittedAt,
      submittedPrice: bo.submittedPrice,
      reservedCost: bo.reservedCost, note: bo.note, cancelledAt: bo.cancelledAt,
      // Basket metadata — preserved for cron fill processing
      basketOrderId: bo.basketOrderId, basketId: bo.basketId,
      basketName: bo.basketName, basketEmoji: bo.basketEmoji,
      limitPrice: bo.limitPrice, stopPrice: bo.stopPrice,
      timeInForce: bo.timeInForce,
    }));
    // Keep raw BrokerOrder[] for Supabase sync (full metadata, no DemoOrder normalization)
    brokerOrdersRef.current = bOrders;
    brokerBasketOrdersRef.current = bBasketOrders || []; // BrokerBasketOrder[] for Supabase sync
    const newState: DemoState = { positions: ctxPositions, cashBalance: bAccount.cashBalance, orders: ctxOrders, savedAt: Date.now() };
    setDemoState(newState);
    setDemoOrders(ctxOrders);
    persistDemoState(newState);
    // Sync basket orders from broker
    setBasketOrders(bBasketOrders || []);
    setPendingBaskets((bBasketOrders || []).filter((bo: any) => bo.status === 'OPEN'));
  }, [persistDemoState]);

  // ── Broker initialization + seed fallback (merged — no race) ──
  // The seed fallback MUST wait for the Supabase load to definitively
  // succeed or fail before deciding whether to seed. Running them as
  // separate effects created a race where the seed could fire before
  // loadFromSupabase() resolved, wiping real data with empty defaults.
  useEffect(() => {
    const supabaseClient = getSupabaseBrowserClient();
    brokerRef.current = getBroker('demo', user?.id, supabaseClient, user?.email);

    // Don't initialise demo data when broker is the active view.
    // DemoBroker ref is still set above — needed for executeTrade in any mode.
    if (isConnected && !isShowingDemo) return;

    // Guard: only run init sequence once per userId (prevents dep-loop
    // while still allowing re-init when auth resolves from null → real id)
    const currentUserId = (user?.id as string | undefined) ?? null;
    if (brokerInitDoneForUserRef.current === currentUserId) return;
    brokerInitDoneForUserRef.current = currentUserId;

    const initBroker = async () => {
      const b = brokerRef.current as any;
      let restoredFromSupabase = false;

      // Step 1: Try Supabase load — await the result
      if (b?.loadFromSupabase) {
        try {
          restoredFromSupabase = await b.loadFromSupabase();
          if (restoredFromSupabase) {
            console.log('[portfolio] Broker state restored from Supabase');
          }
        } catch (e) {
          console.error('[portfolio] Supabase load failed:', e);
          // restoredFromSupabase stays false — will trigger seed below
        }
      }

      // Step 2: If Supabase had data (or localStorage persisted), skip seed
      if (restoredFromSupabase || initialPersistedStateRef.current) {
        demoSeededRef.current = true;
        refreshStateFromBroker();
        // Recovery sync: push broker's actual positions → basket_holdings
        // Heals any corruption from stale pending syncs that overwrote FILLED positions
        if (b?.syncAllBasketPositions) {
          try { await b.syncAllBasketPositions(); } catch (e) { console.error('[portfolio] Recovery sync failed:', e); }
        }
        if (b?.syncBasketOrderChildStatuses) {
          try { b.syncBasketOrderChildStatuses(); } catch (e) { console.error('[portfolio] Basket order status sync failed:', e); }
        }
        return;
      }

      // Step 3: No data anywhere — seed is legitimate (first-time user)
      if (demoSeededRef.current) {
        refreshStateFromBroker();
        return;
      }

      demoSeededRef.current = true;
      console.log('[portfolio] No existing data — seeding cash-only demo account ($100,000)');
      (brokerRef.current as any)?.seedCashOnly();
      // Wait briefly for broker to process seeds, then sync
      setTimeout(async () => {
        await refreshStateFromBroker();
      }, 100);
    };

    initBroker();
  }, [isConnected, isShowingDemo, user?.investorStyle, refreshStateFromBroker, user?.id]);

  // ── executeTrade ──
  const executeTrade = useCallback(
    async (symbol: string, side: 'BUY' | 'SELL', shares: number, price: number, orderType?: 'market' | 'limit' | 'stop' | 'stop_limit', stopPrice?: number, limitPrice?: number, timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok', basketId?: string, basketName?: string, basketEmoji?: string): Promise<TradeResult> => {
      if (submittingTradeRef.current) {
        console.log('[executeTrade] Already submitting — ignoring duplicate call');
        return { success: false, error: 'Order already in progress' };
      }
      submittingTradeRef.current = true;
      try {
      const b = brokerRef.current;
      if (!b) return { success: false, error: 'Broker not initialized' };
      const result = await b.placeOrder({ symbol, side, type: orderType || 'market', shares, limitPrice, stopPrice, timeInForce, basketId, basketName, basketEmoji });
      if (!result.success) {
        setToast({ message: `❌ ${result.message}`, type: 'error' });
        setTimeout(() => setToast(null), 4000);
        return { success: false, error: result.message || 'Order failed', status: result.status as 'FILLED' | 'OPEN' | 'REJECTED' };
      }
      await refreshStateFromBroker();
      const fillPx = result.fillPrice ?? price;
      if (result.status === 'OPEN') {
        let orderNote = '';
        if (orderType === 'stop') orderNote = ` (stop $${(stopPrice || price).toFixed(2)})`;
        else if (orderType === 'stop_limit') orderNote = ` (stop $${(stopPrice || price).toFixed(2)} limit $${(limitPrice || price).toFixed(2)})`;
        else if (orderType === 'limit') orderNote = ` (limit $${price.toFixed(2)})`;
        setToast({ message: `⏳ ${side} ${shares} ${symbol}${orderNote} queued — ${result.nextOpenLabel || 'pending'}`, type: 'success' });
      } else {
        const sideLabel = side === 'BUY' ? 'Bought' : 'Sold';
        const typeLabel = orderType === 'limit' ? 'limit' : orderType === 'stop' ? 'stop' : orderType === 'stop_limit' ? 'stop-limit' : '';
        setToast({ message: `✅ ${sideLabel} ${result.filledShares || shares} ${symbol} ${typeLabel} at $${fillPx.toFixed(2)}`, type: 'success' });
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
        }
      }

      // Fire-and-forget: re-check AI Noticed triggers after trade (use fresh broker data)
      if (b) {
        b.getAccount().then(acct => {
          b.getPositions().then(pos => {
            fetch('/api/ai/noticed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                portfolio: {
                  cash: acct?.cashBalance ?? 0,
                  equity: acct?.totalValue ?? 0,
                  totalPnL: acct?.totalPnL ?? 0,
                  totalPnLPct: acct?.totalPnLPct ?? 0,
                  todayPnL: acct?.todayPnL ?? 0,
                  todayPnLPct: acct?.todayPnLPct ?? 0,
                },
                positions: (pos || []).map((p: any) => ({
                  symbol: p.symbol,
                  qty: p.qty || 0,
                  marketValue: p.marketValue || 0,
                  avgCost: p.avgCost || 0,
                  totalPnl: p.totalPnl || 0,
                  totalPnlPercent: p.totalPnlPercent || 0,
                })),
                watchlistSymbols: [],
              }),
            }).catch(() => {});
          }).catch(() => {});
        }).catch(() => {});
      }

      return { success: true, status: result.status as 'FILLED' | 'OPEN' | 'REJECTED', orderId: result.orderId };
      } finally {
        submittingTradeRef.current = false;
      }
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
      await loadBasketsRef.current(); // Refresh basket state from BASKET_POSITIONS_KEY
      setToast({ message: `🔔 Executed ${filled} pending orders`, type: 'success' });
      setTimeout(() => setToast(null), 4000);
    }
  }, [brokerRef, refreshStateFromBroker]);

  const loadBasketsRef = useRef<() => Promise<void>>(async () => {});

  const loadBaskets = useCallback(async () => {
    let positions: BasketPosition[] = [];
    let fromSupabase = false;

    // Try Supabase basket_holdings first (single source of truth)
    if (user?.id) {
      try {
        const supabaseClient = getSupabaseBrowserClient();
        // Ensure session is available
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user?.id === user.id) {
          const { data: rows, error } = await (supabaseClient as any)
            .from('basket_holdings')
            .select('*')
            .eq('user_id', user.id)
            .neq('status', 'closed')
            .neq('status', 'sold')
            .neq('status', 'pending');  // Never show pending (shares=0) as held positions

          if (!error && rows) {
            fromSupabase = true;
            setSupabaseDegraded(false);
            positions = rows
              .filter((r: any) => (r.shares ?? 0) > 0)  // Safety net: zero shares = not a real position
              .map((r: any) => ({
              id: r.id,
              basketId: r.basket_id,
              symbol: r.symbol,
              shares: r.shares ?? 0,
              avgCost: r.avg_cost ?? 0,
              totalCost: r.total_cost ?? 0,
              allocationPct: r.allocation_pct ?? 0,
              status: r.status,
              reservedAmount: r.reserved_amount ?? 0,
              nextOpenLabel: r.next_open_label || undefined,
              name: r.name || r.symbol,
              sector: r.sector || '',
              basketName: r.basket_name || '',
              basketEmoji: r.emoji || '',
              boughtAt: r.bought_at || new Date().toISOString(),
            }));
            // Cache in localStorage for fast reads when Supabase is down
            try { localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(positions)); } catch {}
          } else if (error) {
            console.warn('[PortfolioContext] basket_holdings fetch failed:', error.message);
          }
        }
      } catch (err: any) {
        console.warn('[PortfolioContext] Supabase unreachable, using localStorage cache:', err?.message || err);
        setSupabaseDegraded(true);
      }
    }

    // Fallback: read from localStorage cache
    if (!fromSupabase) {
      try {
        const raw = localStorage.getItem(BASKET_STORAGE_KEY);
        if (raw) positions = JSON.parse(raw);
      } catch {}
    }

    // Update ref for external consumers
    basketPositionsRef.current = positions;
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

    // Exclude pending-only baskets — they appear only in the pending section, not as owned
    const ownedBaskets = basketList.filter(b => b.status !== 'pending');
    setBaskets(ownedBaskets);
  }, [user?.id]);

  // Keep ref in sync
  useEffect(() => { loadBasketsRef.current = loadBaskets; }, [loadBaskets]);

  // ── Load baskets on mount + refresh prices periodically ──
  useEffect(() => {
    loadBaskets();
  }, [loadBaskets]);

  // ── Auto-execute pending orders when market is open ──
  // Triggers on mount and whenever pendingBaskets or market status changes
  useEffect(() => {
    if (pendingBaskets.length === 0) return;
    const market = getMarketStatus();
    if (!market.isOpen) return;
    console.log(`[PortfolioContext] Market open, ${pendingBaskets.length} pending baskets — executing`);
    const timer = setTimeout(() => {
      executePendingOrders();
    }, 2000);
    return () => clearTimeout(timer);
  }, [pendingBaskets.length]); // Re-triggers when basket count changes

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
    stocks: Array<{ symbol: string; allocationPct: number; name: string; fallbackPrice?: number }>,
    budget: number,
  ): Promise<BasketTradeResult> => {
    if (submittingBasketRef.current) {
      console.log('[executeBasketTrade] Already submitting — ignoring duplicate call');
      return { success: false, executed: 0, failed: 0, totalSpent: 0, error: 'Basket order already in progress' };
    }
    submittingBasketRef.current = true;
    try {
    const b = brokerRef.current;
    if (!b) return { success: false, executed: 0, failed: 0, totalSpent: 0, error: 'Broker not initialized' };
    const result = await b.placeBasketOrder({
      basketId,
      basketName,
      basketEmoji,
      basketDisplayName: displayName,
      stocks: stocks.map(s => ({ symbol: s.symbol, dollarAmount: (s.allocationPct / 100) * budget * 0.95, allocationPct: s.allocationPct, fallbackPrice: s.fallbackPrice })),
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
    } finally {
      submittingBasketRef.current = false;
    }
  }, [brokerRef, refreshStateFromBroker, loadBaskets]);

  // ── sellBasketPositions ──
  const sellBasketPositions = useCallback(async (
    basketId: string,
    symbolsToSell: string[],
    sharesOverride?: Record<string, number>,  // optional: sell specific share amounts (proportional sell)
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
      const res = await apiPost('/api/market/quotes', { symbols });
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
        const sharesToSell = sharesOverride?.[pos.symbol] ?? pos.shares;
        const isProportional = sharesOverride != null && sharesToSell < pos.shares;
        const proceeds = sharesToSell * price;

        // Remove from individual positions (only basket share portion)
        const existingIdx = positions.findIndex(p => p.symbol === pos.symbol);
        if (existingIdx >= 0) {
          const existing = positions[existingIdx];
          const remainingShares = existing.qty - sharesToSell;
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

    // Update basket position status in Supabase basket_holdings
    try {
      const supabaseClient = getSupabaseBrowserClient();
      for (const symbol of symbolsToSell) {
        const sellQty = sharesOverride?.[symbol];
        if (sellQty != null && sellQty < (basket.positions.find(p => p.symbol === symbol)?.shares ?? 0)) {
          // Partial sell: update shares via upsert
          const pos = basket.positions.find(p => p.symbol === symbol)!;
          await (supabaseClient as any).from('basket_holdings').upsert({
            user_id: user!.id,
            basket_id: basketId,
            symbol,
            shares: pos.shares - sellQty,
            status: 'active',
          }, { onConflict: 'basket_id,symbol,user_id' });
        } else {
          // Full sell: close
          await (supabaseClient as any).from('basket_holdings').upsert({
            user_id: user!.id,
            basket_id: basketId,
            symbol,
            status: 'closed',
          }, { onConflict: 'basket_id,symbol,user_id' });
        }
      }
      // Re-normalize remaining positions' allocation % via basket_holdings
      const remaining = basket.positions.filter(
        p => !symbolsToSell.includes(p.symbol) || (sharesOverride?.[p.symbol] != null && (sharesOverride[p.symbol]) < p.shares)
      );
      if (remaining.length > 0) {
        const totalAlloc = remaining.reduce((sum, p) => sum + (p.allocationPct || 0), 0);
        if (totalAlloc > 0) {
          const scale = 100 / totalAlloc;
          for (const p of remaining) {
            const newAlloc = Math.round((p.allocationPct || 0) * scale * 100) / 100;
            await (supabaseClient as any).from('basket_holdings').upsert({
              user_id: user!.id,
              basket_id: basketId,
              symbol: p.symbol,
              allocation_pct: newAlloc,
              status: p.status,
            }, { onConflict: 'basket_id,symbol,user_id' });
          }
        }
      }
    } catch { /* Supabase unreachable — positions/basket state already updated in-memory */ }

    // Cache the basket state in localStorage for offline reads
    try {
      const savedRaw = localStorage.getItem(BASKET_STORAGE_KEY);
      const saved: BasketPosition[] = savedRaw ? JSON.parse(savedRaw) : [];
      const updated = saved.map(p => {
        if (p.basketId === basketId && symbolsToSell.includes(p.symbol)) {
          const sellQty = sharesOverride?.[p.symbol];
          if (sellQty != null && sellQty < p.shares) {
            return { ...p, shares: p.shares - sellQty };
          }
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

  // ── Derive broker metadata from active account ──
  // brokerSource + brokerMeta are used by PortfolioTab for the AccountHero label.
  // Derived reactively from AccountContext (already fetched on app load) —
  // no separate API call needed & no risk of contaminating demo view.
  useEffect(() => {
    if (isConnected && activeAccount && !activeAccount.isDemo) {
      setBrokerSource('snaptrade');
      setBrokerMeta({
        slug: activeAccount.brokerageSlug || activeAccount.broker || '',
        name: activeAccount.name || 'Connected Broker',
        tradingEnabled: activeAccount.tradingEnabled ?? false,
        isDemo: false,
        environment: (activeAccount.environment as 'paper' | 'live') || 'live',
      });
    } else if (!isConnected) {
      setBrokerSource('demo');
      setBrokerMeta(null);
    }
    // Note: when isConnected=true but showing Demo (isShowingDemo=true),
    // brokerMeta stays as last-known broker values — safe because PortfolioTab
    // already guards on isShowingDemo before using brokerMeta for labels.
  }, [isConnected, activeAccount]);

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
        supabaseDegraded,
        brokerSource,
        brokerMeta,
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
    .map(p => {
      const reservedInfo = (p as any).reservedShares > 0 ? ` | ⚠️ ${(p as any).reservedShares} shares reserved by open sell orders (available: ${Math.max(0, p.qty - (p as any).reservedShares)})` : '';
      return `${p.symbol} (${p.name || p.symbol}): ${p.qty} shares @ ${p.currentPrice.toFixed(2)} | ` +
        `Value: ${p.marketValue.toFixed(0)} | ` +
        `Total P&L: ${p.totalPnl >= 0 ? '+' : ''}${p.totalPnl.toFixed(0)} (${p.totalPnlPercent.toFixed(1)}%) | ` +
        `Today: ${p.dayChange >= 0 ? '+' : ''}${p.dayChange.toFixed(0)} (${p.dayChangePercent.toFixed(1)}%) | ` +
        `Avg Cost: ${p.avgCost.toFixed(2)}${reservedInfo}`;
    })
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
