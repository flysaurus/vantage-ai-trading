'use client';

import { apiGet, apiPost } from '@/lib/api-client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingUp, AlertTriangle, Activity, Layers, Download } from 'lucide-react';
import { usePortfolioStore, useTabStore } from '@/store';
import { useAuth } from '@/components/providers/AuthProvider';
import { getStyleContent } from '@/lib/content/investor-styles';
import { getDemoSymbols, getDemoAccount, DEMO_PORTFOLIOS } from '@/lib/demo-data';
import type { AccountSummary } from '@/types';
import { SymbolSearch } from '@/components/trade/SymbolSearch';
import { returnToApp } from '@/lib/nav-back';

// ─── Helpers ───────────────────────────────────────────────

const PRESETS: Record<string, { label: string; description: string; fill: (symbols: string[]) => Record<string, number> }> = {
  equal: {
    label: 'Equal Weight',
    description: 'Same allocation to every holding',
    fill: (symbols: string[]) => {
      const alloc: Record<string, number> = {};
      if (symbols.length) {
        const each = Math.round((100 / symbols.length) * 100) / 100;
        symbols.forEach(s => { alloc[s] = each; });
      }
      return alloc;
    },
  },
  concentrated: {
    label: 'Concentrated',
    description: '50% split among top 3, rest spread equally',
    fill: (symbols: string[]) => {
      const alloc: Record<string, number> = {};
      if (symbols.length <= 3) {
        const each = Math.round((100 / symbols.length) * 100) / 100;
        symbols.forEach(s => { alloc[s] = each; });
      } else {
        const top3 = symbols.slice(0, 3);
        const rest = symbols.slice(3);
        const topEach = Math.round((50 / 3) * 100) / 100;
        const restEach = Math.round((50 / rest.length) * 100) / 100;
        top3.forEach(s => { alloc[s] = topEach; });
        rest.forEach(s => { alloc[s] = restEach; });
      }
      return alloc;
    },
  },
  core: {
    label: 'Core + Satellite',
    description: '70% to first 5, 30% spread across rest',
    fill: (symbols: string[]) => {
      const alloc: Record<string, number> = {};
      if (symbols.length <= 5) {
        const each = Math.round((100 / symbols.length) * 100) / 100;
        symbols.forEach(s => { alloc[s] = each; });
      } else {
        const core = symbols.slice(0, 5);
        const sat = symbols.slice(5);
        const coreEach = Math.round((70 / 5) * 100) / 100;
        const satEach = Math.round((30 / sat.length) * 100) / 100;
        core.forEach(s => { alloc[s] = coreEach; });
        sat.forEach(s => { alloc[s] = satEach; });
      }
      return alloc;
    },
  },
  graduated: {
    label: 'Graduated',
    description: 'Descending weight — top pick gets most, bottom gets least',
    fill: (symbols: string[]) => {
      const alloc: Record<string, number> = {};
      if (!symbols.length) return alloc;
      // Weighted: position 1 = N parts, position 2 = N-1 parts, etc.
      const n = symbols.length;
      const total = (n * (n + 1)) / 2; // triangular number
      symbols.forEach((s, i) => {
        alloc[s] = Math.round(((n - i) / total * 100) * 100) / 100;
      });
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
  const { user } = useAuth();
  const { setTab, setChatOpen } = useTabStore();
  const investorStyle = (user?.investorStyle || 'buffett') as import('@/types').InvestorStyle;

  // Read account from global Zustand store (populated by usePortfolio elsewhere)
  const storeAccount = usePortfolioStore(s => s.account) as (AccountSummary & { sectorAllocations?: any[] }) | null;
  const [account, setAccount] = useState<(AccountSummary & { sectorAllocations?: any[] }) | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // ── Load portfolio data (demo or broker) ──
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Check broker status (fire and forget — doesn't block).
      // Scope to the ACTIVE connection: with 2+ connected brokers the unscoped
      // call returns `ambiguous` → trading_enabled:false, which would wrongly
      // disable Execute on a tradeable account. Same scoping as BrokerProvider.
      let activeConnId = '';
      try {
        const stored = localStorage.getItem('vantage:activeAccount') || '';
        activeConnId = stored.startsWith('snaptrade:') ? stored.slice('snaptrade:'.length) : '';
      } catch { /* ignore — unscoped fallback */ }
apiGet(activeConnId ? `/api/broker/status?connectionId=${encodeURIComponent(activeConnId)}` : '/api/broker/status')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (cancelled) return;
          // Route returns `connected` (NOT `isConnected`) — reading the wrong
          // key previously left isConnected permanently false (always demo).
          if (data?.connected) {
            setIsConnected(true);
            // Read-only (view-only) connections are connected but can't trade.
            if (data?.trading_enabled === false) setIsReadOnly(true);
          }
        })
        .catch(() => {});

      // If store already has data from usePortfolio (on main dashboard), use it
      if (storeAccount && storeAccount.positions?.length > 0) {
        if (!cancelled) {
          setAccount(storeAccount);
          setDataLoading(false);
        }
        return;
      }

      // Fallback: show demo data instantly with avgCost prices,
      // then refresh asynchronously with live market prices
      try {
        const symbols = getDemoSymbols(investorStyle);

        // Phase 1: Show demo data immediately using avgCost as price proxy
        const costPrices: Record<string, any> = {};
        const portfolio = (DEMO_PORTFOLIOS as any)[investorStyle];
        if (portfolio?.positions) {
          for (const p of portfolio.positions) {
            costPrices[p.symbol] = { price: p.avgCost };
          }
        }
        const instantDemo = getDemoAccount(investorStyle, costPrices);
        if (!cancelled && instantDemo) {
          setAccount(instantDemo as any);
          setDataLoading(false);
        }

        // Phase 2: Fetch live prices and update (fire and forget)
        try {
          const res = await await apiPost('/api/market/quotes', { symbols });
          if (res.ok && !cancelled) {
            const data = await res.json();
            const livePrices = data.quotes || {};
            const updatedDemo = getDemoAccount(investorStyle, livePrices);
            if (updatedDemo) setAccount(updatedDemo as any);
          }
        } catch { /* keep cost-basis prices — already showing data */ }
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e.message || 'Failed to load portfolio');
          setDataLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [storeAccount, investorStyle]);

  const positions = account?.positions ?? [];
  const totalValue = account?.equity ?? 0;
  const buyingPower = account?.buyingPower ?? 0;
  const dataReady = !dataLoading;

  // Section 2: target allocations
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [addingSymbol, setAddingSymbol] = useState('');
  const [showAddAsset, setShowAddAsset] = useState(false);

  // Section 2b: save/load targets
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetsSaved, setTargetsSaved] = useState(false);
  const [fromAi, setFromAi] = useState(false);
  const [isFresh, setIsFresh] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  // Section 3: trade preview
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Auto-prepare orders
  const [autoMode, setAutoMode] = useState<'auto' | 'manual'>('auto');
  const [editedOrders, setEditedOrders] = useState<Array<Trade & { orderType: string; limitPrice?: number }>>([]);
  const [editingOrderIdx, setEditingOrderIdx] = useState<number | null>(null);
  const [queueSaved, setQueueSaved] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [execProgress, setExecProgress] = useState('');

  // Section 4: alert toggle
  const [alertOnDrift, setAlertOnDrift] = useState(false);
  const [driftThreshold, setDriftThreshold] = useState(5);

  // Initialize targets from saved allocations or current positions
  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const sid = params?.get('session');
    const tradesParam = params?.get('trades');
    console.log('[rebalancing page] Init — session param:', sid || 'NONE', 'trades param:', tradesParam ? 'YES' : 'NO', 'source:', params?.get('source') || 'NONE');

    // Check if opened from AI Advisor
    if (params?.get('source') === 'ai') setFromAi(true);

    // Detect fresh mode (AI-suggested plan, no saved targets)
    const freshMode = params?.get('fresh') === 'true';
    if (freshMode) {
      setIsFresh(true);
      console.log('[rebalancing page] Fresh mode — using session data only');
    }

    // Load client-side session from URL trades param (no DB needed)
    if (tradesParam && !sessionId && !sid) {
      console.log('[rebalancing page] Loading trades from URL param...');
      try {
        const parsed = JSON.parse(decodeURIComponent(tradesParam));
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessionId('local');
          setFromAi(true);
          const orders = parsed.map((t: any) => ({
            symbol: t.symbol,
            name: t.symbol,
            action: t.action === 'trim' || t.action === 'sell' ? 'SELL' as const : 'BUY' as const,
            shares: Number(t.shares || t.qty || 0),
            estimatedValue: Number(t.estimatedValue || t.dollarAmount || 0),
            currentPrice: Number(t.shares || t.qty) > 0 ? Number(t.estimatedValue || t.dollarAmount) / Number(t.shares || t.qty) : 0,
            orderType: 'market' as const,
            isAiSuggested: true,
          })).filter((o: any) => o.symbol && o.shares > 0);
          if (orders.length > 0) {
            console.log('[rebalancing page] Trades loaded from URL:', orders.length);
            setEditedOrders(orders);
            setAutoMode('auto');
          } else {
            console.log('[rebalancing page] URL trades parsed but all filtered out');
          }
        }
      } catch (e) {
        console.log('[rebalancing page] Failed to parse URL trades:', e);
      }
    }

    // Load session data from DB if present
    if (sid && !sessionId) {
      console.log('[rebalancing page] Fetching session from API:', sid);
      setSessionId(sid);
      setSessionLoading(true);
      setFromAi(true);
      fetch(`/api/strategies/rebalancing/session?id=${sid}`)
        .then(r => {
          console.log('[rebalancing page] Session API response status:', r.status);
          return r.ok ? r.json() : null;
        })
        .then(data => {
          if (data?.trades?.length) {
            console.log('[rebalancing page] Session trades loaded:', data.trades.length);
            // Pre-fill edited orders from session trades
            const orders = data.trades.map((t: any) => ({
              symbol: t.symbol,
              name: t.symbol,
              action: t.action === 'trim' || t.action === 'sell' ? 'SELL' as const : 'BUY' as const,
              shares: t.shares || 0,
              estimatedValue: t.estimatedValue || t.dollarAmount || 0,
              currentPrice: (t.shares || t.dollarAmount) > 0
                ? (t.estimatedValue || t.dollarAmount || 0) / (t.shares || 1)
                : 0,
              orderType: 'market' as const,
              isAiSuggested: true,
              currentPct: t.currentPct,
              targetPct: t.targetPct,
              type: t.type || 'stock',
              reason: t.reason || '',
            }));
            setEditedOrders(orders);
            setAutoMode('auto');

            // Build targets map from session trades so the allocation table shows AI-suggested targets
            const targetsFromSession: Record<string, number> = {};
            data.trades.forEach((t: any) => {
              if (t.targetPct != null) {
                targetsFromSession[t.symbol] = t.targetPct;
              }
            });
            // Also include current portfolio positions in targets for sell trades
            // (they keep their targetPct from session, or currentPct if no explicit target)
            setTargets(targetsFromSession);
            setTargetsSaved(false);
            setSessionLoading(false);

            // Clear fresh param from URL after loading
            if (params?.get('fresh') === 'true') {
              router.replace(`/strategies/setup/rebalancing?session=${sid}`);
            }
          } else {
            console.log('[rebalancing page] Session not found or no trades');
            // Session not found — clear the stale session ID
            setSessionId(null);
          }
          setSessionLoading(false);
        })
        .catch((e) => {
          console.log('[rebalancing page] Session fetch error:', e);
          setSessionId(null);
          setSessionLoading(false);
        });
      // Don't return early — let portfolio loading continue in parallel
    }

    // Skip normal init if waiting for session
    if (sessionLoading) return;

    // Fresh mode: skip saved targets, use session-only data
    if (freshMode) {
      console.log('[rebalancing page] Skipping saved targets (fresh mode)');
      return;
    }

    // Load saved target allocations if available
    apiGet('/api/strategies/rebalancing/saved')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.saved?.targetAllocations?.length) {
          const saved = data.saved;
          const alloc: Record<string, number> = {};
          saved.targetAllocations.forEach((t: any) => {
            alloc[t.symbol] = t.targetPercent;
          });
          setTargets(alloc);
          setAlertOnDrift(saved.alertEnabled || false);
          setDriftThreshold(saved.driftThreshold || 5);
          setTargetsSaved(true);
          return;
        }
        // No saved targets and no session — leave targets empty
        // (user should use AI-suggested plans or set targets manually)
      })
      .catch(() => {
        // No saved targets — leave targets empty
      });
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
    if (value === '') {
      // Completely remove the key so input goes blank
      setTargets(prev => {
        const next = { ...prev };
        delete next[symbol];
        return next;
      });
      setTargetsSaved(false);
      return;
    }
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setTargetsSaved(false);
    setTargets(prev => ({ ...prev, [symbol]: Math.min(100, Math.max(0, num)) }));
  };

  const handleAddAsset = (symbol: string) => {
    if (!symbol || targetSelected(symbol)) return;
    setTargets(prev => ({ ...prev, [symbol.toUpperCase()]: 0 }));
    setTargetsSaved(false);
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
    setTargetsSaved(false);
  };

  const handleSaveTargets = async () => {
    setSavingTargets(true);
    try {
      const targetAllocations = Object.entries(targets).map(([symbol, targetPercent]) => ({
        symbol,
        targetPercent: Math.round(targetPercent * 100) / 100,
      }));
      const res = await await apiPost('/api/strategies/rebalancing/save', {
          targetAllocations,
          driftThreshold,
          alertEnabled: alertOnDrift,
        });
      if (res.ok) {
        setTargetsSaved(true);
        setToast('✓ Allocation saved');
      } else {
        const err = await res.json();
        setToast(err.error || 'Save failed');
      }
    } catch {
      setToast('Network error');
    } finally {
      setSavingTargets(false);
    }
  };

  const handleQuickFill = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    const filled = preset.fill(symbolList);
    setTargets(filled);
    setTargetsSaved(false);
  };

  // Sync edited orders when trades change
  useEffect(() => {
    if (trades.length > 0) {
      setEditedOrders(prev => {
        // Keep existing edits if same trades, otherwise reset
        const prevMap = new Map(prev.map(o => [`${o.symbol}-${o.action}`, o]));
        return trades.map(t => {
          const key = `${t.symbol}-${t.action}`;
          const existing = prevMap.get(key);
          return existing ? { ...existing, estimatedValue: t.estimatedValue, shares: existing.shares || t.shares } : { ...t, orderType: 'market' };
        });
      });
    } else {
      setEditedOrders([]);
    }
  }, [trades]);

  // Load saved queue on mount
  useEffect(() => {
    apiGet('/api/strategies/rebalancing/saved-queue')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.saved?.orders?.length) {
          setEditedOrders(data.saved.orders.map((o: any) => ({
            symbol: o.symbol,
            name: o.name,
            action: o.action,
            shares: o.shares,
            estimatedValue: o.estimatedValue,
            currentPrice: o.currentPrice || 0,
            orderType: o.orderType || 'market',
            limitPrice: o.limitPrice || undefined,
          })));
          setQueueSaved(true);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-prepare helpers
  const buyOrders = editedOrders.filter(o => o.action === 'BUY');
  const sellOrders = editedOrders.filter(o => o.action === 'SELL');
  // Sort sells first, then buys — for display
  const sortedOrders = [...sellOrders, ...buyOrders];
  const totalBuys = buyOrders.reduce((s, o) => s + o.estimatedValue, 0);
  const totalSells = sellOrders.reduce((s, o) => s + o.estimatedValue, 0);
  const netCashImpact = totalBuys - totalSells;

  const updateOrder = (idx: number, updates: Partial<typeof editedOrders[0]>) => {
    setEditedOrders(prev => prev.map((o, i) => i === idx ? { ...o, ...updates } : o));
  };

  const handleSaveQueue = async () => {
    setQueueLoading(true);
    try {
      const res = await await apiPost('/api/strategies/rebalancing/save-queue', {
          orders: editedOrders,
          summary: { totalBuys, totalSells, netCashImpact, orderCount: editedOrders.length },
        });
      if (res.ok) {
        setQueueSaved(true);
        setToast('✓ Queue saved');
      } else {
        const err = await res.json();
        setToast(err.error || 'Save failed');
      }
    } catch {
      setToast('Network error');
    } finally {
      setQueueLoading(false);
    }
  };

  const executeQueue = async () => {
    setConfirmOpen(false);
    setSubmitting(true);

    // Read-only connections can't place orders — defensive guard (button is
    // already hidden in the confirm modal, but never execute on view-only).
    if (isReadOnly) {
      setSubmitting(false);
      setToast('Read-only account — rebalancing orders can\'t be placed');
      return;
    }

    // Demo mode: simulate order placement
    if (!isConnected) {
      const total = editedOrders.length;
      for (let i = 0; i < total; i++) {
        setExecProgress(`Placing order ${i + 1} of ${total}...`);
        await new Promise(r => setTimeout(r, 500));
      }
      setExecProgress('');
      setToast(`✓ ${total} orders simulated (demo mode)`);
      setSubmitting(false);
      setTimeout(() => returnToApp(router), 1500);
      return;
    }

    // Live: call execute API
    try {
      const total = editedOrders.length;
      setExecProgress(`Placing order 1 of ${total}...`);
      const res = await await apiPost('/api/strategies/rebalancing/execute', {
          trades: editedOrders.map(o => ({
            symbol: o.symbol,
            action: o.action === 'BUY' ? 'buy' : 'sell',
            shares: o.shares,
            estimatedValue: o.estimatedValue,
          })),
          targetAllocations: targets,
          alertOnDrift,
          driftThreshold,
        });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setExecProgress('');
        setToast(data?.error || 'Execution failed');
        return;
      }
      const placed = data?.ordersPlaced ?? total;
      const failedErrors = data?.errors;
      if (failedErrors && failedErrors.length > 0) {
        setExecProgress('');
        console.error('[rebalance] partial execution errors:', failedErrors);
        setToast(`⚠️ ${placed} of ${total} orders placed — ${failedErrors.length} failed`);
        return; // stay on page so failed legs can be retried
      }
      for (let i = 1; i <= total; i++) {
        setExecProgress(`Order ${i} of ${total} confirmed ✅`);
        await new Promise(r => setTimeout(r, 300));
      }
      setExecProgress('');
      setToast(`✓ ${placed} orders placed`);
      setTimeout(() => returnToApp(router), 1500);
    } catch {
      setExecProgress('');
      setToast('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (autoMode === 'auto' && editedOrders.length > 0) {
      setConfirmOpen(true);
    } else {
      setConfirmOpen(true);
    }
  };

  const executeRebalance = async () => {
    setConfirmOpen(false);
    setSubmitting(true);

    // Read-only connections can't place orders — defensive guard.
    if (isReadOnly) {
      setSubmitting(false);
      setToast('Read-only account — rebalancing orders can\'t be placed');
      return;
    }

    // Demo mode: simulate
    if (!isConnected) {
      await new Promise(r => setTimeout(r, 800));
      setToast(`✓ ${trades.length} orders simulated (demo mode)`);
      setSubmitting(false);
      setTimeout(() => returnToApp(router), 1500);
      return;
    }

    // Live: call execute API
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
      const res = await await apiPost('/api/strategies/rebalancing/execute', body);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setToast(data?.error || 'Rebalance failed');
        return;
      }
      const placed = data?.ordersPlaced ?? trades.length;
      const failedErrors = data?.errors;
      if (failedErrors && failedErrors.length > 0) {
        console.error('[rebalance] partial execution errors:', failedErrors);
        setToast(`⚠️ ${placed} of ${trades.length} orders placed — ${failedErrors.length} failed`);
        return; // stay on page so failed legs can be retried
      }
      setToast(`✓ ${placed} orders placed`);
      setTimeout(() => returnToApp(router), 1500);
    } catch {
      setToast('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Excel export (plan download) ────────────────────────
  // Available in BOTH access modes: a read-only (view-only) connection can't
  // place orders from Vantage, so downloading the plan is the only way to act
  // on it. Execute stays the gated action; download never is.
  const [downloading, setDownloading] = useState(false);
  const [exportAccount, setExportAccount] = useState<{
    name: string;
    broker: string;
    environment: 'demo' | 'paper' | 'live';
    tradingEnabled: boolean;
  } | null>(null);
  // The account list includes LIVE balances, so it can take several seconds. Keep
  // the in-flight promise so the export can WAIT for identity instead of silently
  // labelling a real account's plan "Demo Portfolio".
  const accountMetaRef = useRef<Promise<typeof exportAccount> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Read the active account id ONCE, synchronously, before the request — so a
    // later write can't change which account this plan belongs to.
    let stored = '';
    try { stored = localStorage.getItem('vantage:activeAccount') || ''; } catch { /* ignore */ }
    const stripped = stored.startsWith('snaptrade:') ? stored.slice('snaptrade:'.length) : stored;
    const p = apiGet('/api/accounts')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const list: any[] = Array.isArray(data?.accounts) ? data.accounts : [];
        if (list.length === 0) return null;
        const match =
          (stored ? list.find(a => a.id === stored) : null) ||
          list.find(a => a.id === `snaptrade:${stripped}`) ||
          list.find(a => a.connectionId && a.connectionId === stripped) ||
          (stripped && stripped !== 'demo' ? list.find(a => !a.isDemo) : null) ||
          list.find(a => a.isDemo) ||
          list[0];
        return {
          name: match?.name || (match?.isDemo ? 'Demo Portfolio' : 'Portfolio'),
          broker: match?.broker || match?.brokerageSlug || '',
          environment: (match?.environment || (match?.isDemo ? 'demo' : 'live')) as 'demo' | 'paper' | 'live',
          tradingEnabled: match?.tradingEnabled !== false,
        };
      })
      .catch(() => null) as Promise<typeof exportAccount>;
    accountMetaRef.current = p;
    p.then(m => { if (!cancelled && m) setExportAccount(m); });
    return () => { cancelled = true; };
  }, []);

  const downloadPlan = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // The account list carries live balances and can resolve slowly; waiting a
      // few seconds beats shipping a workbook labelled "Demo Portfolio" for a
      // real connected account.
      let meta = exportAccount;
      if (!meta && accountMetaRef.current) {
        meta = await Promise.race([
          accountMetaRef.current,
          new Promise<null>(r => setTimeout(() => r(null), 8000)),
        ]).catch(() => null);
      }
      const metaReadOnly = isReadOnly || (meta ? meta.tradingEnabled === false : false);

      const source: Array<Trade & { orderType?: string; limitPrice?: number }> =
        autoMode === 'auto' && editedOrders.length > 0 ? editedOrders : trades;
      const orders = source.map(o => ({
        symbol: o.symbol,
        name: o.name ?? null,
        action: o.action, // 'BUY' | 'SELL'
        shares: o.shares,
        price: o.currentPrice ?? 0,
        estimatedValue: o.estimatedValue,
        orderType: o.orderType || 'market',
        limitPrice: typeof o.limitPrice === 'number' ? o.limitPrice : null,
      }));

      const res = await apiPost('/api/strategies/rebalancing/export', {
        accountName: meta?.name || (isConnected ? 'Connected account' : 'Demo Portfolio'),
        broker: meta?.broker || null,
        environment: meta?.environment || (isConnected ? null : 'demo'),
        access: metaReadOnly ? 'read-only' : 'trading',
        isDemo: meta ? meta.environment === 'demo' : !isConnected,
        styleName: getStyleContent(investorStyle).shortLabel,
        totalValue,
        cash: typeof account?.cash === 'number' ? account.cash : null,
        buyingPower: typeof account?.buyingPower === 'number' ? account.buyingPower : null,
        driftThreshold,
        driftAlertEnabled: alertOnDrift,
        positions: positions.map(p => ({
          symbol: p.symbol,
          name: p.name ?? null,
          qty: p.qty,
          price: p.currentPrice ?? 0,
          marketValue: p.marketValue ?? 0,
        })),
        targets,
        orders,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setToast(err?.error || 'Download failed');
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] || 'vantage-rebalance-plan.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setToast('✓ Plan downloaded (.xlsx)');
    } catch {
      setToast('Network error');
    } finally {
      setDownloading(false);
    }
  };

  // Execute is the ONLY gated action: read-only connections can't place orders.
  // Belt-and-braces — the account list's tradingEnabled flag also counts, so the
  // gate is correct even while the (slow, live-balance) status call is in flight.
  const effectiveReadOnly = isReadOnly || (exportAccount ? exportAccount.tradingEnabled === false : false);
  const executeBlocked = submitting || effectiveReadOnly;
  const executeLabel = effectiveReadOnly ? 'Read-only — cannot execute' : 'Execute Rebalance';
  const executeHint = effectiveReadOnly ? 'Read-only account — orders cannot be placed' : undefined;

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="strategy-page" style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--v-canvas)', color: 'var(--v-text-primary)', padding: '16px 16px 300px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, animation: 'dcaToastIn 0.25s ease-out' }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: 'var(--v-text-primary)', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 8, padding: '8px 18px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</span>
        </div>
      )}

      {/* Confirmation Modal — Order Summary */}
      {confirmOpen && (
        <div onClick={() => setConfirmOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 16, padding: 24, maxWidth: 400, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            {autoMode === 'auto' && editedOrders.length > 0 ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--v-text-primary)', marginBottom: 4 }}>Execute Rebalance</div>
                <div style={{ fontSize: 11, color: 'var(--v-text-secondary)', marginBottom: 16 }}>
                  {isReadOnly ? 'Read-only account — orders can\'t be placed' : isConnected ? 'Orders will be placed with your connected brokerage' : 'Demo mode — orders simulated'}
                </div>

                {/* Order summary table */}
                <div style={{ marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--v-card)' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', padding: '8px 10px', background: 'var(--v-canvas)', fontSize: 10, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase' }}>
                    <span style={{ flex: 0.5 }}>Action</span>
                    <span style={{ flex: 0.7 }}>Symbol</span>
                    <span style={{ flex: 0.6, textAlign: 'right' }}>Qty</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Price</span>
                    <span style={{ flex: 0.8, textAlign: 'right' }}>Amount</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Type</span>
                  </div>
                  {/* Rows */}
                  {editedOrders.map((o, i) => (
                    <div key={i} style={{ display: 'flex', padding: '8px 10px', fontSize: 12, color: 'var(--v-text-secondary)', background: i % 2 === 0 ? 'var(--v-card)' : 'var(--v-card)', alignItems: 'center' }}>
                      <span style={{ flex: 0.5, fontWeight: 700, color: o.action === 'BUY' ? 'var(--v-gain)' : 'var(--v-loss)' }}>
                        {o.action === 'BUY' ? 'Buy' : 'Sell'}
                      </span>
                      <span style={{ flex: 0.7, fontWeight: 700 }}>{o.symbol}</span>
                      <span style={{ flex: 0.6, textAlign: 'right' }}>{o.shares}</span>
                      <span style={{ flex: 0.7, textAlign: 'right', color: 'var(--v-text-muted)' }}>
                        ${o.currentPrice > 0 ? o.currentPrice.toFixed(2) : (o.shares > 0 ? (o.estimatedValue / o.shares).toFixed(2) : '—')}
                      </span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 600 }}>
                        ${o.estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span style={{ flex: 0.7, textAlign: 'right' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--v-accent-label)', background: 'var(--v-accent-dim)', padding: '2px 6px', borderRadius: 3 }}>
                          {o.orderType === 'market' ? 'Market' : o.orderType === 'limit' ? 'Limit' : 'Stop'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--v-accent-dim)', borderRadius: 8, marginBottom: 16, fontSize: 11, color: 'var(--v-text-muted)' }}>
                  <span>{editedOrders.length} orders</span>
                  <span>
                    <span style={{ color: netCashImpact > 0 ? 'var(--v-loss)' : 'var(--v-gain)', fontWeight: 600 }}>
                      Net: {netCashImpact > 0 ? '+' : ''}${netCashImpact.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </span>
                </div>

                {execProgress && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--v-accent-dim)', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--v-accent-label)', textAlign: 'center' }}>
                    {execProgress}
                  </div>
                )}
                {isReadOnly ? (
                  <div style={{ padding: '12px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 10, fontSize: 12, color: 'var(--v-warn)', textAlign: 'center', lineHeight: 1.5 }}>
                    ⚠️ Read-only account — rebalancing orders can't be placed. Review or download this plan, then execute it on a trading-enabled account.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--v-text-faint)', background: 'none', color: 'var(--v-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                    <button onClick={executeQueue} disabled={submitting} style={{ flex: 1.5, padding: 10, borderRadius: 8, border: 'none', background: submitting ? 'var(--v-disabled-bg)' : 'linear-gradient(135deg, var(--v-accent), var(--v-accent))', color: submitting ? 'var(--v-disabled-text)' : 'var(--v-accent-text)', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                      {submitting ? 'Placing Orders...' : 'Execute Rebalance'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--v-text-primary)', marginBottom: 4 }}>Execute Rebalance</div>
                <div style={{ fontSize: 11, color: 'var(--v-text-secondary)', marginBottom: 16 }}>
                  {isReadOnly ? 'Read-only account — orders can\'t be placed' : isConnected ? 'Orders will be placed with your connected brokerage' : 'Demo mode — orders simulated'}
                </div>
                <div style={{ marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--v-card)' }}>
                  <div style={{ display: 'flex', padding: '8px 10px', background: 'var(--v-canvas)', fontSize: 10, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase' }}>
                    <span style={{ flex: 0.5 }}>Action</span>
                    <span style={{ flex: 0.7 }}>Symbol</span>
                    <span style={{ flex: 0.6, textAlign: 'right' }}>Qty</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Price</span>
                    <span style={{ flex: 0.8, textAlign: 'right' }}>Amount</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Type</span>
                  </div>
                  {trades.map((t, i) => (
                    <div key={i} style={{ display: 'flex', padding: '8px 10px', fontSize: 12, color: 'var(--v-text-secondary)', background: i % 2 === 0 ? 'var(--v-card)' : 'var(--v-card)', alignItems: 'center' }}>
                      <span style={{ flex: 0.5, fontWeight: 700, color: t.action === 'BUY' ? 'var(--v-gain)' : 'var(--v-loss)' }}>
                        {t.action === 'BUY' ? 'Buy' : 'Sell'}
                      </span>
                      <span style={{ flex: 0.7, fontWeight: 700 }}>{t.symbol}</span>
                      <span style={{ flex: 0.6, textAlign: 'right' }}>{t.shares}</span>
                      <span style={{ flex: 0.7, textAlign: 'right', color: 'var(--v-text-muted)' }}>
                        ${t.currentPrice > 0 ? t.currentPrice.toFixed(2) : '—'}
                      </span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 600 }}>
                        ${t.estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span style={{ flex: 0.7, textAlign: 'right' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--v-accent-label)', background: 'var(--v-accent-dim)', padding: '2px 6px', borderRadius: 3 }}>Market</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--v-accent-dim)', borderRadius: 8, marginBottom: 16, fontSize: 11, color: 'var(--v-text-muted)' }}>
                  <span>{trades.length} trades · ${totalTradeValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {isReadOnly ? (
                  <div style={{ padding: '12px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 10, fontSize: 12, color: 'var(--v-warn)', textAlign: 'center', lineHeight: 1.5 }}>
                    ⚠️ Read-only account — rebalancing orders can't be placed. Review or download this plan, then execute it on a trading-enabled account.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--v-text-faint)', background: 'none', color: 'var(--v-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                    <button onClick={executeRebalance} disabled={submitting} style={{ flex: 1.5, padding: 10, borderRadius: 8, border: 'none', background: submitting ? 'var(--v-disabled-bg)' : 'linear-gradient(135deg, var(--v-accent), var(--v-accent))', color: submitting ? 'var(--v-disabled-text)' : 'var(--v-accent-text)', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                      {submitting ? 'Placing Orders...' : 'Execute Rebalance'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => { setChatOpen(true); returnToApp(router); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--v-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button onClick={() => router.push('/strategies')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--v-accent-label)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            View strategies →
          </button>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--v-text-primary)', margin: '0 0 6px' }}>Portfolio Rebalancing</h1>
        <p style={{ fontSize: 13, color: 'var(--v-text-muted)', margin: 0 }}>Restore your target allocation</p>
        {fromAi && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--v-accent-dim)', border: '1px solid var(--v-accent-dim)', borderRadius: 8, fontSize: 12, color: 'var(--v-accent-label)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>💡</span>
            <span>{isFresh ? 'AI Suggested Plan — review before executing' : sessionId ? 'Populated from AI Advisor' : 'Opened from AI Advisor'}</span>
          </div>
        )}
        {isReadOnly && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 8, fontSize: 12, color: 'var(--v-warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⚠️</span>
            <span>Read-only account — build and review a rebalance plan, but orders can't be placed.</span>
          </div>
        )}
      </div>

      {/* ─── Section 1: Current Portfolio ───────────── */}
      <Section icon={<Activity size={12} />} label="Current Portfolio">
        {!dataReady ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: 'var(--v-text-muted)', fontSize: 13 }}>
            {loadError ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ color: 'var(--v-loss)' }}>{loadError}</span>
                <button
                  onClick={() => {
                    setDataLoading(true);
                    setLoadError('');
                    // Force re-trigger the useEffect by temporarily clearing storeAccount ref
                    window.location.reload();
                  }}
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 600,
                    background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 6,
                    color: 'var(--v-text-muted)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  ↻ Retry
                </button>
              </div>
            ) : (
              <>
                <div style={{ width: 16, height: 16, border: '2px solid var(--v-card-border)', borderTopColor: 'var(--v-accent)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                Loading portfolio data...
              </>
            )}
          </div>
        ) : totalValue <= 0 || positions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--v-text-muted)', padding: '8px 0', lineHeight: 1.6 }}>
            {!isConnected ? (
              <>
                You&apos;re viewing a simulated portfolio. Connect your broker to unlock AI analysis of your real holdings.
              </>
            ) : (
              'No positions found in your connected account.'
            )}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--v-text-primary)', marginBottom: 12 }}>
              Portfolio: ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.6fr 0.5fr', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 8px', borderBottom: '1px solid var(--v-card)' }}>
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
              const driftColor = drift > 5 ? 'var(--v-loss)' : drift < -5 ? 'var(--v-gain)' : 'var(--v-text-muted)';
              return (
                <div key={pos.symbol} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.6fr 0.5fr', gap: 4, alignItems: 'center', padding: '8px', borderBottom: '1px solid var(--v-card)', fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: 'var(--v-text-primary)' }}>{pos.symbol}</span>
                  <span style={{ textAlign: 'right', color: 'var(--v-text-secondary)' }}>${pos.marketValue.toLocaleString()}</span>
                  <span style={{ textAlign: 'right', color: 'var(--v-text-muted)' }}>{currentPct.toFixed(1)}%</span>
                  <span style={{ textAlign: 'right', color: 'var(--v-accent-label)', fontWeight: 600 }}>{targetPct.toFixed(1)}%</span>
                  <span style={{ textAlign: 'right', color: driftColor, fontWeight: 600 }}>
                    {drift > 0 ? '+' : ''}{drift.toFixed(1)}%
                  </span>
                </div>
              );
            })}
            {/* Added assets not in portfolio */}
            {Object.keys(targets).filter(s => !positionMap[s]).map(sym => (
              <div key={sym} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.6fr 0.5fr', gap: 4, alignItems: 'center', padding: '8px', borderBottom: '1px solid var(--v-card)', fontSize: 12, opacity: 0.6 }}>
                <span style={{ fontWeight: 700, color: 'var(--v-text-primary)' }}>{sym}</span>
                <span style={{ textAlign: 'right', color: 'var(--v-text-secondary)' }}>$0.00</span>
                <span style={{ textAlign: 'right', color: 'var(--v-text-secondary)' }}>0.0%</span>
                <span style={{ textAlign: 'right', color: 'var(--v-accent-label)', fontWeight: 600 }}>{targets[sym].toFixed(1)}%</span>
                <span style={{ textAlign: 'right', color: 'var(--v-gain)', fontWeight: 600 }}>-{targets[sym].toFixed(1)}%</span>
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
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--v-text-primary)', minWidth: 56 }}>{sym}</span>
              <input
                id={`target-${sym}`}
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={targets[sym] !== undefined ? targets[sym].toString() : ''}
                onChange={e => handleTargetChange(sym, e.target.value)}
                style={{ width: 60, padding: '6px 8px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 6, color: 'var(--v-text-primary)', fontSize: 13, fontWeight: 600, textAlign: 'center', fontFamily: 'inherit' }}
              />
              <span style={{ fontSize: 12, color: 'var(--v-text-secondary)' }}>%</span>
              {positionMap[sym] && (
                <span style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>
                  (currently {((positionMap[sym].marketValue / totalValue) * 100).toFixed(1)}%)
                </span>
              )}
              {!positionMap[sym] && (
                <button onClick={() => removeTarget(sym)} style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10, fontWeight: 600, background: 'none', border: '1px solid var(--v-text-faint)', borderRadius: 4, color: 'var(--v-text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>
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
            <button onClick={() => { setShowAddAsset(false); setAddingSymbol(''); }} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'none', border: '1px solid var(--v-text-faint)', borderRadius: 6, color: 'var(--v-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕
            </button>
          </div>
        ) : (
          <button onClick={() => setShowAddAsset(true)} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: 'none', border: '1px dashed var(--v-card-border)', borderRadius: 8, color: 'var(--v-text-secondary)', cursor: 'pointer', marginBottom: 12, fontFamily: 'inherit' }}>
            + Add Asset
          </button>
        )}

        {/* Save Allocation button */}
        <button
          onClick={handleSaveTargets}
          disabled={savingTargets || !isBalanced || Object.keys(targets).length === 0}
          style={{
            width: '100%', padding: '12px 16px',
            background: targetsSaved
              ? 'var(--v-gain)'
              : savingTargets
                ? 'var(--v-text-faint)'
                : 'linear-gradient(135deg, var(--v-accent), var(--v-accent))',
            border: targetsSaved ? '1px solid var(--v-gain)' : 'none',
            borderRadius: 10,
            color: targetsSaved ? 'var(--v-canvas)' : 'var(--v-canvas)',
            fontSize: 14, fontWeight: 700,
            cursor: savingTargets ? 'wait' : !isBalanced || Object.keys(targets).length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', marginBottom: 8,
            opacity: !isBalanced || Object.keys(targets).length === 0 ? 0.4 : 1,
            boxShadow: targetsSaved ? 'none' : '0 2px 12px var(--v-accent-dim)',
          }}
        >
          {savingTargets ? 'Saving...' : targetsSaved ? '✓ Allocation Saved' : '💾 Save Allocation'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--v-card)', border: `1px solid ${isBalanced ? 'var(--v-gain)' : 'var(--v-loss)'}`, borderRadius: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--v-text-muted)' }}>Total Allocation</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: isBalanced ? 'var(--v-gain)' : 'var(--v-loss)' }}>
            {totalTarget.toFixed(1)}%
          </span>
        </div>

        {/* Quick Presets */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Quick Presets</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              onClick={() => handleQuickFill(key)}
              style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 9999, color: 'var(--v-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
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
            <div style={{ fontSize: 12, color: 'var(--v-text-secondary)', padding: '8px 0' }}>
              Portfolio is balanced — no trades needed.
            </div>
          ) : (
            <>
              {trades.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--v-canvas)', border: '1px solid var(--v-card)', borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: t.action === 'BUY' ? 'var(--v-gain-dim)' : 'var(--v-loss-dim)', color: t.action === 'BUY' ? 'var(--v-gain)' : 'var(--v-loss)' }}>
                      {t.action}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--v-text-primary)' }}>{t.symbol}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--v-text-secondary)' }}>{t.shares} shares</div>
                    <div style={{ fontSize: 11, color: 'var(--v-text-secondary)' }}>~${t.estimatedValue.toFixed(2)}</div>
                  </div>
                </div>
              ))}

              {/* Summary */}
              <div style={{ padding: '10px 12px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--v-text-muted)', marginBottom: 4 }}>
                  <span>Total trades</span>
                  <span style={{ fontWeight: 600, color: 'var(--v-text-primary)' }}>{trades.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--v-text-muted)' }}>
                  <span>Est. total value</span>
                  <span style={{ fontWeight: 600, color: 'var(--v-text-primary)' }}>${totalTradeValue.toFixed(2)}</span>
                </div>
              </div>

              {/* Warnings */}
              {trades.some(t => t.action === 'SELL') && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 8, fontSize: 11, color: 'var(--v-warn)', display: 'flex', alignItems: 'flex-start', gap: 6, fontWeight: 500 }}>
                  <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  Selling may trigger capital gains taxes
                </div>
              )}
              {hasOnlyMinorDrift && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--v-rule)', border: '1px solid var(--v-rule)', borderRadius: 8, fontSize: 11, color: 'var(--v-text-muted)', display: 'flex', alignItems: 'flex-start', gap: 6, fontWeight: 500 }}>
                  <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  Minor drift — rebalancing may not be worth transaction costs
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {/* ─── Section 3.5: Auto-Prepare Orders ──────── */}
      {isBalanced && hasAnyTrade && (
        <Section icon={<span style={{ fontSize: 14 }}>🤖</span>} label="Auto-Prepare Orders">
          <p style={{ fontSize: 12, color: 'var(--v-text-muted)', margin: '0 0 14px' }}>
            Would you like Vantage to prepare all rebalancing orders for you?
          </p>

          {/* Option A & B cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <button
              onClick={() => setAutoMode('auto')}
              style={{
                padding: 14,
                background: autoMode === 'auto' ? 'var(--v-accent-dim)' : 'var(--v-card)',
                border: `1px solid ${autoMode === 'auto' ? 'var(--v-accent)' : 'var(--v-card-border)'}`,
                borderRadius: 10,
                textAlign: 'left' as const,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: autoMode === 'auto' ? 'var(--v-accent)' : 'var(--v-text-primary)', marginBottom: 4 }}>
                Prepare All Orders for Me
              </div>
              <div style={{ fontSize: 11, color: 'var(--v-text-secondary)', lineHeight: 1.5 }}>
                All buy and sell orders will be queued and ready to execute in one tap. You review before anything executes.
              </div>
            </button>

            <button
              onClick={() => setAutoMode('manual')}
              style={{
                padding: 14,
                background: autoMode === 'manual' ? 'var(--v-accent-dim)' : 'var(--v-card)',
                border: `1px solid ${autoMode === 'manual' ? 'var(--v-accent)' : 'var(--v-card-border)'}`,
                borderRadius: 10,
                textAlign: 'left' as const,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: autoMode === 'manual' ? 'var(--v-accent)' : 'var(--v-text-primary)', marginBottom: 4 }}>
                I&apos;ll Place Orders Manually
              </div>
              <div style={{ fontSize: 11, color: 'var(--v-text-secondary)', lineHeight: 1.5 }}>
                Orders will be shown as suggestions. You place each one individually in the Trade tab.
              </div>
            </button>
          </div>

          {/* — Option A: Order Queue — */}
          {autoMode === 'auto' && editedOrders.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-accent-label)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Order Queue
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {editedOrders.map((order, i) => {
                  const isEditing = editingOrderIdx === i;
                  return (
                    <div key={`${order.symbol}-${order.action}-${i}`} style={{ padding: '10px 12px', background: 'var(--v-canvas)', border: `1px solid ${isEditing ? 'var(--v-accent)' : 'var(--v-card)'}`, borderRadius: 8 }}>
                      {/* Order row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: order.action === 'BUY' ? 'var(--v-gain-dim)' : 'var(--v-loss-dim)', color: order.action === 'BUY' ? 'var(--v-gain)' : 'var(--v-loss)' }}>
                            {order.action}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--v-text-primary)' }}>{order.symbol}</span>
                          {(order as any).isAiSuggested && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--v-accent-label)', background: 'var(--v-accent-dim)', padding: '2px 6px', borderRadius: 3 }}>AI Suggested</span>
                          )}
                          {(order as any).type && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--v-text-secondary)', background: 'rgba(100,116,139,0.12)', padding: '2px 6px', borderRadius: 3 }}>{(order as any).type === 'etf' ? 'ETF' : 'Stock'}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--v-accent-label)', background: 'var(--v-accent-dim)', padding: '2px 8px', borderRadius: 4 }}>
                            {order.orderType === 'limit' ? `Limit $${(order.limitPrice || 0).toFixed(2)}` : order.orderType === 'stop' ? 'Stop' : 'Market'}
                          </span>
                          <button
                            onClick={() => setEditingOrderIdx(isEditing ? null : i)}
                            style={{ padding: '3px 10px', fontSize: 10, fontWeight: 600, background: 'none', border: '1px solid var(--v-card-border)', borderRadius: 4, color: 'var(--v-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            {isEditing ? 'Done' : 'Edit'}
                          </button>
                        </div>
                      </div>

                      {/* Detail row: shares, value, percentages */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--v-text-muted)', marginTop: 4, paddingLeft: 4 }}>
                        <span>{order.shares} shares · ~${order.estimatedValue.toFixed(2)}</span>
                        {(order as any).currentPct != null && (order as any).targetPct != null && (
                          <span>
                            <span style={{ color: 'var(--v-text-secondary)' }}>{(order as any).currentPct.toFixed(1)}%</span>
                            <span style={{ margin: '0 4px', color: 'var(--v-text-muted)' }}>→</span>
                            <span style={{ color: 'var(--v-accent-label)', fontWeight: 600 }}>{(order as any).targetPct.toFixed(1)}%</span>
                          </span>
                        )}
                      </div>

                      {/* Reason subtitle */}
                      {(order as any).reason && (
                        <div style={{ fontSize: 10, color: 'var(--v-text-secondary)', lineHeight: 1.4, marginTop: 3, paddingLeft: 4, fontStyle: 'italic' }}>
                          {(order as any).reason}
                        </div>
                      )}

                      {/* Inline editor */}
                      {isEditing && (
                        <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--v-card)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--v-text-muted)', minWidth: 56 }}>Type</span>
                            <select
                              value={order.orderType}
                              onChange={e => updateOrder(i, { orderType: e.target.value })}
                              style={{ padding: '4px 8px', background: 'var(--v-canvas)', border: '1px solid var(--v-card-border)', borderRadius: 4, color: 'var(--v-text-primary)', fontSize: 12, fontFamily: 'inherit' }}
                            >
                              <option value="market">Market</option>
                              <option value="limit">Limit</option>
                              <option value="stop">Stop</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--v-text-muted)', minWidth: 56 }}>Shares</span>
                            <input
                              type="number"
                              min={0.01}
                              step={0.01}
                              value={order.shares}
                              onChange={e => {
                                const shares = parseFloat(e.target.value) || 0;
                                updateOrder(i, { shares, estimatedValue: shares * order.currentPrice });
                              }}
                              style={{ width: 80, padding: '4px 8px', background: 'var(--v-canvas)', border: '1px solid var(--v-card-border)', borderRadius: 4, color: 'var(--v-text-primary)', fontSize: 12, fontFamily: 'inherit' }}
                            />
                          </div>
                          {(order.orderType === 'limit' || order.orderType === 'stop') && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--v-text-muted)', minWidth: 56 }}>
                                {order.orderType === 'limit' ? 'Limit $' : 'Stop $'}
                              </span>
                              <input
                                type="number"
                                min={0.01}
                                step={0.01}
                                value={order.limitPrice || order.currentPrice || ''}
                                onChange={e => updateOrder(i, { limitPrice: parseFloat(e.target.value) || undefined })}
                                placeholder={String(order.currentPrice)}
                                style={{ width: 80, padding: '4px 8px', background: 'var(--v-canvas)', border: '1px solid var(--v-card-border)', borderRadius: 4, color: 'var(--v-text-primary)', fontSize: 12, fontFamily: 'inherit' }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Queue Summary */}
              <div style={{ padding: '12px 14px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 10, marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--v-text-muted)' }}>
                  <span>Total Buys</span>
                  <span style={{ fontWeight: 600, color: 'var(--v-gain)' }}>{buyOrders.length} orders · ${totalBuys.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--v-text-muted)' }}>
                  <span>Total Sells</span>
                  <span style={{ fontWeight: 600, color: 'var(--v-loss)' }}>{sellOrders.length} orders · ${totalSells.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingTop: 6, borderTop: '1px solid var(--v-card-border)' }}>
                  <span style={{ color: 'var(--v-text-muted)' }}>Net Cash Impact</span>
                  <span style={{ fontWeight: 700, color: netCashImpact > 0 ? 'var(--v-loss)' : 'var(--v-gain)' }}>
                    {netCashImpact > 0 ? '+' : ''}{netCashImpact.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Queue action buttons */}
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button
                  onClick={handleSaveQueue}
                  disabled={queueLoading || queueSaved}
                  style={{
                    flex: 1, padding: '10px',
                    background: queueSaved ? 'var(--v-gain)' : 'none',
                    border: '1px solid var(--v-card-border)',
                    borderRadius: 8,
                    color: queueSaved ? 'var(--v-accent-text)' : 'var(--v-text-muted)',
                    fontSize: 12, fontWeight: 600,
                    cursor: queueSaved ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {queueLoading ? 'Saving...' : queueSaved ? '✓ Queue Saved' : '💾 Save Queue for Later'}
                </button>
              </div>
            </>
          )}

          {/* — Option B: Manual trade buttons — */}
          {autoMode === 'manual' && trades.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Place Individually
              </div>
              {trades.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', marginBottom: 6, background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: t.action === 'BUY' ? 'var(--v-gain-dim)' : 'var(--v-loss-dim)', color: t.action === 'BUY' ? 'var(--v-gain)' : 'var(--v-loss)' }}>
                      {t.action}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--v-text-primary)' }}>{t.symbol}</span>
                    <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>{t.shares} shares</span>
                  </div>
                  <button
                    onClick={() => router.push(`/?tab=trade&symbol=${t.symbol}`)}
                    style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, background: 'var(--v-accent-label)', border: 'none', borderRadius: 8, color: 'var(--v-accent-text)', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Trade →
                  </button>
                </div>
              ))}
            </>
          )}
        </Section>
      )}

      {/* ─── Section 4: Rebalance Triggers ──────────── */}
      <Section icon={<AlertTriangle size={12} />} label="Rebalance Triggers">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--v-text-secondary)' }}>Alert me when drift exceeds</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={1}
              max={25}
              value={driftThreshold}
              onChange={e => setDriftThreshold(Math.max(1, Math.min(25, parseInt(e.target.value) || 5)))}
              disabled={!alertOnDrift}
              style={{ width: 40, padding: '4px 6px', background: alertOnDrift ? 'var(--v-card)' : 'var(--v-canvas)', border: '1px solid var(--v-card-border)', borderRadius: 4, color: alertOnDrift ? 'var(--v-text-primary)' : 'var(--v-text-faint)', fontSize: 13, fontWeight: 600, textAlign: 'center', fontFamily: 'inherit' }}
            />
            <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>%</span>
            <button
              onClick={() => setAlertOnDrift(!alertOnDrift)}
              style={{
                padding: '4px 2px',
                width: 44,
                borderRadius: 9999,
                border: 'none',
                background: alertOnDrift ? 'var(--v-accent)' : 'var(--v-card-border)',
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
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'var(--v-canvas)', padding: '12px 16px 84px', borderTop: '1px solid var(--v-card-border)', boxShadow: '0 -8px 20px rgba(0,0,0,0.06)' }}>
        {/* Demo mode warning */}
        {!isConnected && (
          <div style={{ fontSize: 10, color: 'var(--v-warn)', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Demo mode — orders will be simulated
          </div>
        )}
        {/* Read-only warning */}
        {isReadOnly && (
          <div style={{ fontSize: 10, color: 'var(--v-warn)', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Read-only account — orders can't be placed
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Primary action row — Execute (disabled on read-only connections) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {sessionId ? (
            <>
              <button
                onClick={handleSubmit}
                data-testid="rebalance-execute"
                disabled={executeBlocked}
                title={executeHint}
                style={{
                  flex: 1, padding: 14, borderRadius: 10, border: 'none',
                  background: !executeBlocked ? 'linear-gradient(135deg, var(--v-accent), var(--v-accent))' : 'var(--v-disabled-bg)',
                  color: !executeBlocked ? 'var(--v-accent-text)' : 'var(--v-disabled-text)',
                  fontSize: 15, fontWeight: 700,
                  cursor: submitting ? 'wait' : executeBlocked ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.2s ease',
                }}
              >
                {submitting ? 'Executing...' : executeLabel}
              </button>
              <button
                onClick={() => {
                  setSessionId(null);
                  setFromAi(false);
                  setEditedOrders([]);
                  setAutoMode('auto');
                }}
                style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 10, color: 'var(--v-text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                Edit Allocations
              </button>
            </>
          ) : autoMode === 'auto' && editedOrders.length > 0 ? (
            <button
              onClick={handleSubmit}
              data-testid="rebalance-execute"
              disabled={executeBlocked}
              title={executeHint}
              style={{
                flex: 1, padding: 14, borderRadius: 10, border: 'none',
                background: !executeBlocked ? 'linear-gradient(135deg, var(--v-accent), var(--v-accent))' : 'var(--v-disabled-bg)',
                color: !executeBlocked ? 'var(--v-accent-text)' : 'var(--v-disabled-text)',
                fontSize: 15, fontWeight: 700,
                cursor: submitting ? 'wait' : executeBlocked ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s ease',
              }}
            >
              {submitting ? 'Executing...' : executeLabel}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!isBalanced || !hasAnyTrade || executeBlocked}
              data-testid="rebalance-execute"
              title={executeHint}
              style={{
                flex: 1, padding: 14, borderRadius: 10, border: 'none',
                background: isBalanced && hasAnyTrade && !executeBlocked ? 'linear-gradient(135deg, var(--v-accent), var(--v-accent))' : 'var(--v-disabled-bg)',
                color: isBalanced && hasAnyTrade && !executeBlocked ? 'var(--v-accent-text)' : 'var(--v-disabled-text)',
                fontSize: 15, fontWeight: 700,
                cursor: submitting ? 'wait' : isBalanced && hasAnyTrade && !executeBlocked ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', transition: 'all 0.2s ease',
              }}
            >
              {submitting ? 'Executing...' : executeLabel}
            </button>
          )}
          </div>
          {/* Secondary row — the plan download is available in BOTH access modes
              (read-only accounts get the plan, they just can't execute it). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={downloadPlan}
            disabled={downloading}
            data-testid="rebalance-download-xlsx"
            title="Download this plan as Excel (.xlsx)"
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '12px 14px', fontSize: 13, fontWeight: 700,
              background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 10,
              color: downloading ? 'var(--v-text-muted)' : 'var(--v-accent-label)',
              cursor: downloading ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            <Download size={15} strokeWidth={2.2} aria-hidden />
            {downloading ? 'Preparing…' : 'Download .xlsx'}
          </button>
          <button onClick={() => returnToApp(router)} data-testid="rebalance-cancel" style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: 'var(--v-text-secondary)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Cancel
          </button>
          </div>
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
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-accent-label)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}
