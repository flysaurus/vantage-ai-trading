'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingUp, AlertTriangle, Activity, Layers } from 'lucide-react';
import { usePortfolioStore, useTabStore } from '@/store';
import { useAuth } from '@/components/providers/AuthProvider';
import { getDemoSymbols, getDemoAccount, DEMO_PORTFOLIOS } from '@/lib/demo-data';
import type { AccountSummary } from '@/types';
import { SymbolSearch } from '@/components/trade/SymbolSearch';

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
  const { setTab } = useTabStore();
  const investorStyle = (user?.investorStyle || 'buffett') as import('@/types').InvestorStyle;

  // Read account from global Zustand store (populated by usePortfolio elsewhere)
  const storeAccount = usePortfolioStore(s => s.account) as (AccountSummary & { sectorAllocations?: any[] }) | null;
  const [account, setAccount] = useState<(AccountSummary & { sectorAllocations?: any[] }) | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // ── Load portfolio data (demo or broker) ──
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Check broker status (fire and forget — doesn't block)
      fetch('/api/broker/status')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (!cancelled && data?.isConnected) setIsConnected(true); })
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
          const res = await fetch('/api/market/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols }),
          });
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
    fetch('/api/strategies/rebalancing/saved')
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
        // Fallback: init from current positions
        if (positions.length && Object.keys(targets).length === 0) {
          const init: Record<string, number> = {};
          positions.forEach(p => {
            const pct = p.portfolioPercent ?? ((p.marketValue / totalValue) * 100);
            init[p.symbol] = Math.round(pct * 100) / 100;
          });
          setTargets(init);
        }
      })
      .catch(() => {
        // Fallback on error
        if (positions.length && Object.keys(targets).length === 0) {
          const init: Record<string, number> = {};
          positions.forEach(p => {
            const pct = p.portfolioPercent ?? ((p.marketValue / totalValue) * 100);
            init[p.symbol] = Math.round(pct * 100) / 100;
          });
          setTargets(init);
        }
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
      const res = await fetch('/api/strategies/rebalancing/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetAllocations,
          driftThreshold,
          alertEnabled: alertOnDrift,
        }),
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
    fetch('/api/strategies/rebalancing/saved-queue')
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
      const res = await fetch('/api/strategies/rebalancing/save-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders: editedOrders,
          summary: { totalBuys, totalSells, netCashImpact, orderCount: editedOrders.length },
        }),
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
      setTimeout(() => router.back(), 1500);
      return;
    }

    // Live: call execute API
    try {
      const total = editedOrders.length;
      setExecProgress(`Placing order 1 of ${total}...`);
      const res = await fetch('/api/strategies/rebalancing/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trades: editedOrders.map(o => ({
            symbol: o.symbol,
            action: o.action === 'BUY' ? 'buy' : 'sell',
            shares: o.shares,
            estimatedValue: o.estimatedValue,
          })),
          targetAllocations: targets,
          alertOnDrift,
          driftThreshold,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setExecProgress('');
        setToast(err.error || 'Execution failed');
        setSubmitting(false);
        return;
      }
      for (let i = 1; i <= total; i++) {
        setExecProgress(`Order ${i} of ${total} confirmed ✅`);
        await new Promise(r => setTimeout(r, 300));
      }
      setExecProgress('');
      setToast(`✓ ${total} orders placed`);
      setTimeout(() => router.back(), 1500);
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

    // Demo mode: simulate
    if (!isConnected) {
      await new Promise(r => setTimeout(r, 800));
      setToast(`✓ ${trades.length} orders simulated (demo mode)`);
      setSubmitting(false);
      setTimeout(() => router.back(), 1500);
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
      const res = await fetch('/api/strategies/rebalancing/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        setToast(err.error || 'Rebalance failed');
        setSubmitting(false);
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
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#0f172a', color: '#f1f5f9', padding: '16px 16px 300px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, animation: 'dcaToastIn 0.25s ease-out' }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#f1f5f9', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 18px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</span>
        </div>
      )}

      {/* Confirmation Modal — Order Summary */}
      {confirmOpen && (
        <div onClick={() => setConfirmOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24, maxWidth: 400, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            {autoMode === 'auto' && editedOrders.length > 0 ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Execute Rebalance</div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 16 }}>
                  {isConnected ? 'Orders will be placed via Alpaca' : 'Demo mode — orders simulated'}
                </div>

                {/* Order summary table */}
                <div style={{ marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: '1px solid #1e293b' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', padding: '8px 10px', background: '#0f172a', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    <span style={{ flex: 0.5 }}>Action</span>
                    <span style={{ flex: 0.7 }}>Symbol</span>
                    <span style={{ flex: 0.6, textAlign: 'right' }}>Qty</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Price</span>
                    <span style={{ flex: 0.8, textAlign: 'right' }}>Amount</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Type</span>
                  </div>
                  {/* Rows */}
                  {editedOrders.map((o, i) => (
                    <div key={i} style={{ display: 'flex', padding: '8px 10px', fontSize: 12, color: '#cbd5e1', background: i % 2 === 0 ? '#1e293b' : '#162032', alignItems: 'center' }}>
                      <span style={{ flex: 0.5, fontWeight: 700, color: o.action === 'BUY' ? '#4ade80' : '#f87171' }}>
                        {o.action === 'BUY' ? 'Buy' : 'Sell'}
                      </span>
                      <span style={{ flex: 0.7, fontWeight: 700 }}>{o.symbol}</span>
                      <span style={{ flex: 0.6, textAlign: 'right' }}>{o.shares}</span>
                      <span style={{ flex: 0.7, textAlign: 'right', color: '#94a3b8' }}>
                        ${o.currentPrice > 0 ? o.currentPrice.toFixed(2) : (o.shares > 0 ? (o.estimatedValue / o.shares).toFixed(2) : '—')}
                      </span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 600 }}>
                        ${o.estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span style={{ flex: 0.7, textAlign: 'right' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', padding: '2px 6px', borderRadius: 3 }}>
                          {o.orderType === 'market' ? 'Market' : o.orderType === 'limit' ? 'Limit' : 'Stop'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(6,182,212,0.06)', borderRadius: 8, marginBottom: 16, fontSize: 11, color: '#94a3b8' }}>
                  <span>{editedOrders.length} orders</span>
                  <span>
                    <span style={{ color: netCashImpact > 0 ? '#f87171' : '#4ade80', fontWeight: 600 }}>
                      Net: {netCashImpact > 0 ? '+' : ''}${netCashImpact.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </span>
                </div>

                {execProgress && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(6,182,212,0.1)', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#06b6d4', textAlign: 'center' }}>
                    {execProgress}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #475569', background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button onClick={executeQueue} disabled={submitting} style={{ flex: 1.5, padding: 10, borderRadius: 8, border: 'none', background: submitting ? '#334155' : 'linear-gradient(135deg, #06b6d4, #0d9488)', color: submitting ? '#64748b' : '#0f172a', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {submitting ? 'Placing Orders...' : 'Execute Rebalance'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Execute Rebalance</div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 16 }}>
                  {isConnected ? 'Orders will be placed via Alpaca' : 'Demo mode — orders simulated'}
                </div>
                <div style={{ marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: '1px solid #1e293b' }}>
                  <div style={{ display: 'flex', padding: '8px 10px', background: '#0f172a', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    <span style={{ flex: 0.5 }}>Action</span>
                    <span style={{ flex: 0.7 }}>Symbol</span>
                    <span style={{ flex: 0.6, textAlign: 'right' }}>Qty</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Price</span>
                    <span style={{ flex: 0.8, textAlign: 'right' }}>Amount</span>
                    <span style={{ flex: 0.7, textAlign: 'right' }}>Type</span>
                  </div>
                  {trades.map((t, i) => (
                    <div key={i} style={{ display: 'flex', padding: '8px 10px', fontSize: 12, color: '#cbd5e1', background: i % 2 === 0 ? '#1e293b' : '#162032', alignItems: 'center' }}>
                      <span style={{ flex: 0.5, fontWeight: 700, color: t.action === 'BUY' ? '#4ade80' : '#f87171' }}>
                        {t.action === 'BUY' ? 'Buy' : 'Sell'}
                      </span>
                      <span style={{ flex: 0.7, fontWeight: 700 }}>{t.symbol}</span>
                      <span style={{ flex: 0.6, textAlign: 'right' }}>{t.shares}</span>
                      <span style={{ flex: 0.7, textAlign: 'right', color: '#94a3b8' }}>
                        ${t.currentPrice > 0 ? t.currentPrice.toFixed(2) : '—'}
                      </span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 600 }}>
                        ${t.estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span style={{ flex: 0.7, textAlign: 'right' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', padding: '2px 6px', borderRadius: 3 }}>Market</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(6,182,212,0.06)', borderRadius: 8, marginBottom: 16, fontSize: 11, color: '#94a3b8' }}>
                  <span>{trades.length} trades · ${totalTradeValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #475569', background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button onClick={executeRebalance} disabled={submitting} style={{ flex: 1.5, padding: 10, borderRadius: 8, border: 'none', background: submitting ? '#334155' : 'linear-gradient(135deg, #06b6d4, #0d9488)', color: submitting ? '#64748b' : '#0f172a', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {submitting ? 'Placing Orders...' : 'Execute Rebalance'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => { setTab('ai'); router.push('/'); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button onClick={() => router.push('/strategies')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#06b6d4', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            View strategies →
          </button>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Portfolio Rebalancing</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Restore your target allocation</p>
        {fromAi && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 8, fontSize: 12, color: '#06b6d4', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>💡</span>
            <span>{isFresh ? 'AI Suggested Plan — review before executing' : sessionId ? 'Populated from AI Advisor' : 'Opened from AI Advisor'}</span>
          </div>
        )}
      </div>

      {/* ─── Section 1: Current Portfolio ───────────── */}
      <Section icon={<Activity size={12} />} label="Current Portfolio">
        {!dataReady ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>
            {loadError ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ color: '#f87171' }}>{loadError}</span>
                <button
                  onClick={() => {
                    setDataLoading(true);
                    setLoadError('');
                    // Force re-trigger the useEffect by temporarily clearing storeAccount ref
                    window.location.reload();
                  }}
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 600,
                    background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
                    color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  ↻ Retry
                </button>
              </div>
            ) : (
              <>
                <div style={{ width: 16, height: 16, border: '2px solid #334155', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                Loading portfolio data...
              </>
            )}
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
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={targets[sym] !== undefined ? targets[sym].toString() : ''}
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

        {/* Save Allocation button */}
        <button
          onClick={handleSaveTargets}
          disabled={savingTargets || !isBalanced || Object.keys(targets).length === 0}
          style={{
            width: '100%', padding: '12px 16px',
            background: targetsSaved
              ? '#22c55e'
              : savingTargets
                ? '#475569'
                : 'linear-gradient(135deg, #06b6d4, #0d9488)',
            border: targetsSaved ? '1px solid #22c55e' : 'none',
            borderRadius: 10,
            color: targetsSaved ? '#0f172a' : '#0f172a',
            fontSize: 14, fontWeight: 700,
            cursor: savingTargets ? 'wait' : !isBalanced || Object.keys(targets).length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', marginBottom: 8,
            opacity: !isBalanced || Object.keys(targets).length === 0 ? 0.4 : 1,
            boxShadow: targetsSaved ? 'none' : '0 2px 12px rgba(6,182,212,0.25)',
          }}
        >
          {savingTargets ? 'Saving...' : targetsSaved ? '✓ Allocation Saved' : '💾 Save Allocation'}
        </button>
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

      {/* ─── Section 3.5: Auto-Prepare Orders ──────── */}
      {isBalanced && hasAnyTrade && (
        <Section icon={<span style={{ fontSize: 14 }}>🤖</span>} label="Auto-Prepare Orders">
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px' }}>
            Would you like Vantage to prepare all rebalancing orders for you?
          </p>

          {/* Option A & B cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <button
              onClick={() => setAutoMode('auto')}
              style={{
                padding: 14,
                background: autoMode === 'auto' ? 'rgba(6,182,212,0.06)' : '#1e293b',
                border: `1px solid ${autoMode === 'auto' ? '#06b6d4' : '#334155'}`,
                borderRadius: 10,
                textAlign: 'left' as const,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: autoMode === 'auto' ? '#06b6d4' : '#f1f5f9', marginBottom: 4 }}>
                Prepare All Orders for Me
              </div>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                All buy and sell orders will be queued and ready to execute in one tap. You review before anything executes.
              </div>
            </button>

            <button
              onClick={() => setAutoMode('manual')}
              style={{
                padding: 14,
                background: autoMode === 'manual' ? 'rgba(6,182,212,0.06)' : '#1e293b',
                border: `1px solid ${autoMode === 'manual' ? '#06b6d4' : '#334155'}`,
                borderRadius: 10,
                textAlign: 'left' as const,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: autoMode === 'manual' ? '#06b6d4' : '#f1f5f9', marginBottom: 4 }}>
                I&apos;ll Place Orders Manually
              </div>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                Orders will be shown as suggestions. You place each one individually in the Trade tab.
              </div>
            </button>
          </div>

          {/* — Option A: Order Queue — */}
          {autoMode === 'auto' && editedOrders.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Order Queue
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {editedOrders.map((order, i) => {
                  const isEditing = editingOrderIdx === i;
                  return (
                    <div key={`${order.symbol}-${order.action}-${i}`} style={{ padding: '10px 12px', background: '#0f172a', border: `1px solid ${isEditing ? '#06b6d4' : '#1e293b'}`, borderRadius: 8 }}>
                      {/* Order row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: order.action === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: order.action === 'BUY' ? '#4ade80' : '#f87171' }}>
                            {order.action}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{order.symbol}</span>
                          {(order as any).isAiSuggested && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: '#06b6d4', background: 'rgba(6,182,212,0.12)', padding: '2px 6px', borderRadius: 3 }}>AI Suggested</span>
                          )}
                          {(order as any).type && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: '#64748b', background: 'rgba(100,116,139,0.12)', padding: '2px 6px', borderRadius: 3 }}>{(order as any).type === 'etf' ? 'ETF' : 'Stock'}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                            {order.orderType === 'limit' ? `Limit $${(order.limitPrice || 0).toFixed(2)}` : order.orderType === 'stop' ? 'Stop' : 'Market'}
                          </span>
                          <button
                            onClick={() => setEditingOrderIdx(isEditing ? null : i)}
                            style={{ padding: '3px 10px', fontSize: 10, fontWeight: 600, background: 'none', border: '1px solid #334155', borderRadius: 4, color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            {isEditing ? 'Done' : 'Edit'}
                          </button>
                        </div>
                      </div>

                      {/* Detail row: shares, value, percentages */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#94a3b8', marginTop: 4, paddingLeft: 4 }}>
                        <span>{order.shares} shares · ~${order.estimatedValue.toFixed(2)}</span>
                        {(order as any).currentPct != null && (order as any).targetPct != null && (
                          <span>
                            <span style={{ color: '#64748b' }}>{(order as any).currentPct.toFixed(1)}%</span>
                            <span style={{ margin: '0 4px', color: '#475569' }}>→</span>
                            <span style={{ color: '#06b6d4', fontWeight: 600 }}>{(order as any).targetPct.toFixed(1)}%</span>
                          </span>
                        )}
                      </div>

                      {/* Reason subtitle */}
                      {(order as any).reason && (
                        <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, marginTop: 3, paddingLeft: 4, fontStyle: 'italic' }}>
                          {(order as any).reason}
                        </div>
                      )}

                      {/* Inline editor */}
                      {isEditing && (
                        <div style={{ marginTop: 10, padding: '10px 12px', background: '#1e293b', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', minWidth: 56 }}>Type</span>
                            <select
                              value={order.orderType}
                              onChange={e => updateOrder(i, { orderType: e.target.value })}
                              style={{ padding: '4px 8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit' }}
                            >
                              <option value="market">Market</option>
                              <option value="limit">Limit</option>
                              <option value="stop">Stop</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', minWidth: 56 }}>Shares</span>
                            <input
                              type="number"
                              min={0.01}
                              step={0.01}
                              value={order.shares}
                              onChange={e => {
                                const shares = parseFloat(e.target.value) || 0;
                                updateOrder(i, { shares, estimatedValue: shares * order.currentPrice });
                              }}
                              style={{ width: 80, padding: '4px 8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit' }}
                            />
                          </div>
                          {(order.orderType === 'limit' || order.orderType === 'stop') && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', minWidth: 56 }}>
                                {order.orderType === 'limit' ? 'Limit $' : 'Stop $'}
                              </span>
                              <input
                                type="number"
                                min={0.01}
                                step={0.01}
                                value={order.limitPrice || order.currentPrice || ''}
                                onChange={e => updateOrder(i, { limitPrice: parseFloat(e.target.value) || undefined })}
                                placeholder={String(order.currentPrice)}
                                style={{ width: 80, padding: '4px 8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit' }}
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
              <div style={{ padding: '12px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>
                  <span>Total Buys</span>
                  <span style={{ fontWeight: 600, color: '#4ade80' }}>{buyOrders.length} orders · ${totalBuys.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>
                  <span>Total Sells</span>
                  <span style={{ fontWeight: 600, color: '#f87171' }}>{sellOrders.length} orders · ${totalSells.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingTop: 6, borderTop: '1px solid #334155' }}>
                  <span style={{ color: '#94a3b8' }}>Net Cash Impact</span>
                  <span style={{ fontWeight: 700, color: netCashImpact > 0 ? '#f87171' : '#4ade80' }}>
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
                    background: queueSaved ? '#22c55e' : 'none',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    color: queueSaved ? '#0f172a' : '#94a3b8',
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
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Place Individually
              </div>
              {trades.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', marginBottom: 6, background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: t.action === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: t.action === 'BUY' ? '#4ade80' : '#f87171' }}>
                      {t.action}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{t.symbol}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{t.shares} shares</span>
                  </div>
                  <button
                    onClick={() => router.push(`/?tab=trade&symbol=${t.symbol}`)}
                    style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, background: 'linear-gradient(135deg, #06b6d4, #0d9488)', border: 'none', borderRadius: 8, color: '#0f172a', cursor: 'pointer', fontFamily: 'inherit' }}
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
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'linear-gradient(to top, #0f172a 80%, rgba(15,23,42,0.95))', padding: '12px 16px 84px', borderTop: '1px solid #1e293b' }}>
        {/* Demo mode warning */}
        {!isConnected && (
          <div style={{ fontSize: 10, color: '#fbbf24', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Demo mode — orders will be simulated
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {sessionId ? (
            <>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  flex: 1, padding: 14, borderRadius: 10, border: 'none',
                  background: !submitting ? 'linear-gradient(135deg, #06b6d4, #0d9488)' : '#334155',
                  color: !submitting ? '#0f172a' : '#64748b',
                  fontSize: 15, fontWeight: 700,
                  cursor: !submitting ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', transition: 'all 0.2s ease',
                }}
              >
                {submitting ? 'Executing...' : 'Execute Rebalance'}
              </button>
              <button
                onClick={() => {
                  setSessionId(null);
                  setFromAi(false);
                  setEditedOrders([]);
                  setAutoMode('auto');
                }}
                style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                Edit Allocations
              </button>
            </>
          ) : autoMode === 'auto' && editedOrders.length > 0 ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                flex: 1, padding: 14, borderRadius: 10, border: 'none',
                background: !submitting ? 'linear-gradient(135deg, #06b6d4, #0d9488)' : '#334155',
                color: !submitting ? '#0f172a' : '#64748b',
                fontSize: 15, fontWeight: 700,
                cursor: !submitting ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', transition: 'all 0.2s ease',
              }}
            >
              {submitting ? 'Executing...' : 'Execute Rebalance'}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!isBalanced || !hasAnyTrade || submitting}
              style={{
                flex: 1, padding: 14, borderRadius: 10, border: 'none',
                background: isBalanced && hasAnyTrade && !submitting ? 'linear-gradient(135deg, #06b6d4, #0d9488)' : '#334155',
                color: isBalanced && hasAnyTrade && !submitting ? '#0f172a' : '#64748b',
                fontSize: 15, fontWeight: 700,
                cursor: isBalanced && hasAnyTrade && !submitting ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', transition: 'all 0.2s ease',
              }}
            >
              {submitting ? 'Executing...' : 'Execute Rebalance'}
            </button>
          )}
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
