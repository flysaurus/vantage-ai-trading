'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import CompassIcon from '@/components/CompassIcon';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import { getMarketStatus } from '@/lib/market-hours';

// ── 5-step flow: curated → custom_theme → budget → generating → review ──
// Plus order_ticket after review for curated baskets
type Step = 'curated' | 'custom_theme' | 'budget' | 'generating' | 'review' | 'basket_review' | 'basket_confirm' | 'success';

interface BasketStock {
  symbol: string;
  name: string;
  allocation: number;
  rationale: string;
  shares?: number;
  price?: number;
  dollarAmount?: number;
  performance?: { '3m': number; ytd: number; '1y': number };
}

interface BasketData {
  theme: string;
  rationale: string;
  stocks: BasketStock[];
}

interface CuratedBasket {
  id: string;
  theme: string;
  emoji: string;
  name: string;
  thesis: string;
  risk_note: string;
  stocks: BasketStock[];
  performance: { '3m': number; ytd: number; '1y': number; best_timeframe: string };
  created_at: string;
}

interface ReviewStock {
  symbol: string;
  name: string;
  allocation: number;
  price: number;
  shares: number;
  dollarAmount: number;
  rationale: string;
  isCustomAdded?: boolean;
}

interface BasketResult {
  basketName: string;
  basketEmoji: string;
  stocks: Array<{ symbol: string; shares: number; price: number; totalCost: number }>;
  totalSpent: number;
  cashRemaining: number;
  executed: number;
  failed: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBasketGenerated: (msg: string, data: any) => void;
}

export default function BuildBasketModal({ isOpen, onClose, onBasketGenerated }: Props) {
  const { user } = useAuth();
  const { account, executeBasketTrade } = useLivePortfolio();

  // ── Helper: derive fractional shares from dollar amount and price (4 decimal places) ──
  const calcShares = (dollarAmount: number, price: number) => {
    if (!price || price <= 0) return 0;
    return Math.round((dollarAmount / price) * 10000) / 10000;
  };
  const cashBalance = account?.cash || 0;

  // ── Step state ──
  const [step, setStep] = useState<Step>('curated');
  const [previousStep, setPreviousStep] = useState<Step | null>(null);

  // ── Curated baskets state ──
  const [curatedBaskets, setCuratedBaskets] = useState<CuratedBasket[]>([]);
  const [curatedLoading, setCuratedLoading] = useState(true);
  const [curatedError, setCuratedError] = useState<string | null>(null);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [nextRefresh, setNextRefresh] = useState<string | null>(null);
  const [changelogExpanded, setChangelogExpanded] = useState(false);
  const [selectedCurated, setSelectedCurated] = useState<CuratedBasket | null>(null);
  const [expandedPreview, setExpandedPreview] = useState<string | null>(null);
  const [basketTimeframes, setBasketTimeframes] = useState<Record<string, string>>({});

  // ── Custom basket state ──
  const [customName, setCustomName] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [budget, setBudget] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [basketData, setBasketData] = useState<BasketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeFlash, setRemoveFlash] = useState(false);
  const [addStockSymbol, setAddStockSymbol] = useState('');
  const [stockSearchResults, setStockSearchResults] = useState<any[]>([]);
  const [stockSearchLoading, setStockSearchLoading] = useState(false);
  const [showAddStock, setShowAddStock] = useState(false);
  const [isAddingStock, setIsAddingStock] = useState(false);

  // ── Order ticket state ──
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{ success: boolean; executed: number; failed: number; totalSpent: number; error?: string } | null>(null);
  const [basketResult, setBasketResult] = useState<BasketResult | null>(null);

  // ── Basket Review state ──
  const [reviewStocks, setReviewStocks] = useState<ReviewStock[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);
  const [addSymbolInput, setAddSymbolInput] = useState('');
  const [reviewSearchResults, setReviewSearchResults] = useState<any[]>([]);
  const [reviewSearchLoading, setReviewSearchLoading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [budgetWarning, setBudgetWarning] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [canProceed, setCanProceed] = useState(true);
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // ── Fetch curated baskets on open ──
  useEffect(() => {
    if (!isOpen) return;
    setCuratedLoading(true);
    setCuratedError(null);
    fetch('/api/baskets')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        const baskets = (data.baskets || []).map((b: any) => ({
          ...b,
          stocks: typeof b.stocks === 'string' ? JSON.parse(b.stocks || '[]') : (b.stocks || []),
          performance: typeof b.performance === 'string' ? JSON.parse(b.performance || '{}') : (b.performance || {}),
        }));
        setCuratedBaskets(baskets);
        setChangelog(data.changelog || null);
        setLastUpdated(data.lastUpdated || null);
        setNextRefresh(data.nextRefresh || null);
      })
      .catch(err => setCuratedError(err.message))
      .finally(() => setCuratedLoading(false));
  }, [isOpen]);

  // ── Reset state on close ──
  useEffect(() => {
    if (!isOpen) {
      setStep('curated');
      setPreviousStep(null);
      setSelectedCurated(null);
      setExpandedPreview(null);
      setCustomName('');
      setBudget('');
      setBasketData(null);
      setError(null);
      setAddStockSymbol('');
      setShowAddStock(false);
    }
  }, [isOpen]);

  // ── Auto-complete: addStockSymbol (review step) ──
  useEffect(() => {
    if (!addStockSymbol || addStockSymbol.trim().length < 1) {
      setStockSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setStockSearchLoading(true);
      try {
        const res = await fetch(`/api/finnhub/search?q=${encodeURIComponent(addStockSymbol.trim())}`);
        const data = await res.json();
        const filtered = (data.result || [])
          .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'ETF')
          .slice(0, 8);
        setStockSearchResults(filtered);
      } catch { setStockSearchResults([]); }
      finally { setStockSearchLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [addStockSymbol]);

  // ── Auto-complete: addSymbolInput (basket_review step) ──
  useEffect(() => {
    if (!addSymbolInput || addSymbolInput.trim().length < 1) {
      setReviewSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setReviewSearchLoading(true);
      try {
        const res = await fetch(`/api/finnhub/search?q=${encodeURIComponent(addSymbolInput.trim())}`);
        const data = await res.json();
        const filtered = (data.result || [])
          .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'ETF')
          .slice(0, 8);
        setReviewSearchResults(filtered);
      } catch { setReviewSearchResults([]); }
      finally { setReviewSearchLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [addSymbolInput]);

  // ── Stock management hooks (above early return per TDZ rules) ──
  const removeStock = useCallback((symbol: string) => {
    if (!basketData || basketData.stocks.length <= 2) return;
    const bNum = parseInt(budget) || 10000;
    const remaining = basketData.stocks.filter(s => s.symbol !== symbol);
    const totalAlloc = remaining.reduce((sum, s) => sum + s.allocation, 0);
    const updated = remaining.map(s => {
      const newAlloc = +(s.allocation * (100 / totalAlloc)).toFixed(1);
      const dollarAmount = (newAlloc / 100) * bNum;
      const shares = s.price && s.price > 0 ? calcShares(dollarAmount, s.price): 0;
      return { ...s, allocation: newAlloc, dollarAmount, shares };
    });
    const newTotal = updated.reduce((sum, s) => sum + s.allocation, 0);
    if (newTotal !== 100) {
      updated[0].allocation = +(updated[0].allocation + (100 - newTotal)).toFixed(1);
      updated[0].dollarAmount = (updated[0].allocation / 100) * bNum;
      updated[0].shares = updated[0].price && updated[0].price > 0
        ? calcShares(updated[0].dollarAmount, updated[0].price) : 0;
    }
    setBasketData({ ...basketData, stocks: updated });
    setRemoveFlash(true);
    setTimeout(() => setRemoveFlash(false), 1500);
  }, [basketData, budget]);

  const addStock = useCallback(async (symbol: string) => {
    if (!basketData || !symbol.trim() || basketData.stocks.length >= 8) return;
    const s = symbol.trim().toUpperCase();
    if (basketData.stocks.find(st => st.symbol === s)) return;
    setIsAddingStock(true);
    try {
      const qRes = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(s)}`);
      const qData = await qRes.json();
      const price = qData?.c || 0;
      if (price <= 0) { setError(`Could not fetch price for ${s}`); return; }
      const bNum = parseInt(budget) || 10000;
      const newCount = basketData.stocks.length + 1;
      const allocPer = +(100 / newCount).toFixed(1);
      const updated = basketData.stocks.map(st => {
        const dollarAmount = (allocPer / 100) * bNum;
        const shares = st.price && st.price > 0 ? calcShares(dollarAmount, st.price): 0;
        return { ...st, allocation: allocPer, dollarAmount, shares };
      });
      const newDollar = (allocPer / 100) * bNum;
      updated.push({
        symbol: s, name: s, allocation: allocPer,
        rationale: 'Manually added', price, dollarAmount: newDollar,
        shares: calcShares(newDollar, price),
      });
      const total = updated.reduce((sum, st) => sum + st.allocation, 0);
      if (total !== 100) {
        updated[0].allocation = +(updated[0].allocation + (100 - total)).toFixed(1);
        updated[0].dollarAmount = (updated[0].allocation / 100) * bNum;
        updated[0].shares = updated[0].price && updated[0].price > 0
          ? calcShares(updated[0].dollarAmount, updated[0].price!) : 0;
      }
      setBasketData({ ...basketData, stocks: updated });
      setAddStockSymbol(''); setShowAddStock(false);
    } catch (err: any) { setError(err?.message || `Failed to add ${s}`); }
    finally { setIsAddingStock(false); }
  }, [basketData, budget]);

  // ── Basket Review: fetch live prices ──
  useEffect(() => {
    if (step === 'basket_review' && selectedCurated && budget) fetchReviewPrices();
  }, [step]);

  async function fetchReviewPrices() {
    if (!selectedCurated) return;
    setLoadingPrices(true);
    setPriceError(false);
    const bNum = parseInt(budget) || 0;
    const effectiveBudget = bNum * 0.95;

    try {
      const results = await Promise.allSettled(
        selectedCurated.stocks.map(stock =>
          fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(stock.symbol)}`).then(r => r.json())
        )
      );

      const enriched: ReviewStock[] = selectedCurated.stocks.map((stock, i) => {
        const result = results[i];
        const price = result.status === 'fulfilled' ? (result.value.c || stock.price || 0) : (stock.price || 0);
        const dollarAmount = (stock.allocation / 100) * effectiveBudget;
        const shares = price > 0 ? calcShares(dollarAmount, price): 0;
        return {
          ...stock,
          price: Math.round(price * 100) / 100,
          dollarAmount: Math.round(dollarAmount * 100) / 100,
          shares: Math.round(shares * 1000000) / 1000000,
        };
      });

      setReviewStocks(enriched);
    } catch {
      setPriceError(true);
    } finally {
      setLoadingPrices(false);
    }
  }

  function onRemoveStock(symbol: string) {
    if (reviewStocks.length <= 2) return;
    const bNum = parseInt(budget) || 0;
    const effectiveBudget = bNum * 0.95;
    const remaining = reviewStocks.filter(s => s.symbol !== symbol);
    const totalAlloc = remaining.reduce((sum, s) => sum + s.allocation, 0);
    const updated = remaining.map(s => {
      const newAlloc = +(s.allocation * (100 / totalAlloc)).toFixed(1);
      const dollarAmount = Math.round(newAlloc / 100 * effectiveBudget * 100) / 100;
      const shares = s.price > 0 ? calcShares(dollarAmount, s.price): 0;
      return { ...s, allocation: newAlloc, dollarAmount, shares };
    });
    const sum = updated.reduce((s, r) => s + r.allocation, 0);
    if (sum !== 100 && updated.length > 0) {
      updated[0].allocation = +(updated[0].allocation + (100 - sum)).toFixed(1);
      updated[0].dollarAmount = Math.round(updated[0].allocation / 100 * effectiveBudget * 100) / 100;
      updated[0].shares = updated[0].price > 0 ? calcShares(updated[0].dollarAmount, updated[0].price) : 0;
    }
    setReviewStocks(updated);
  }

  async function handleAddStock(symbol: string) {
    if (!symbol.trim() || reviewStocks.length >= 10) return;
    const s = symbol.trim().toUpperCase();
    if (reviewStocks.find(st => st.symbol === s)) return;
    try {
      const qRes = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(s)}`);
      const qData = await qRes.json();
      const price = qData?.c || 0;
      if (price <= 0) { setError(`Could not fetch price for ${s}`); return; }
      const bNum = parseInt(budget) || 0;
      const effectiveBudget = bNum * 0.95;
      const newCount = reviewStocks.length + 1;
      const allocPer = +(100 / newCount).toFixed(1);
      const updated = reviewStocks.map(st => {
        const dollarAmount = Math.round(allocPer / 100 * effectiveBudget * 100) / 100;
        const shares = st.price > 0 ? calcShares(dollarAmount, st.price): 0;
        return { ...st, allocation: allocPer, dollarAmount, shares };
      });
      const newDollar = Math.round(allocPer / 100 * effectiveBudget * 100) / 100;
      updated.push({
        symbol: s, name: s, allocation: allocPer,
        rationale: 'Manually added', price,
        dollarAmount: newDollar, shares: calcShares(newDollar, price),
        isCustomAdded: true,
      });
      const total = updated.reduce((sum, st) => sum + st.allocation, 0);
      if (total !== 100) {
        updated[0].allocation = +(updated[0].allocation + (100 - total)).toFixed(1);
        updated[0].dollarAmount = Math.round(updated[0].allocation / 100 * effectiveBudget * 100) / 100;
        updated[0].shares = updated[0].price > 0 ? calcShares(updated[0].dollarAmount, updated[0].price) : 0;
      }
      setReviewStocks(updated);
      setAddSymbolInput(''); setShowAddInput(false);
    } catch (err: any) { setError(err?.message || `Failed to add ${s}`); }
  }

  // ── Build execution plan from selected curated basket (legacy, kept for safety) ──
  // (must be above early return per React hooks rules)
  const executionPlan = useMemo(() => {
    if (!selectedCurated || !budget) return null;
    const bNum = parseInt(budget) || 0;
    const effectiveBudget = bNum * 0.95;
    return selectedCurated.stocks.map(stock => {
      const dollarAmount = (stock.allocation / 100) * effectiveBudget;
      const price = stock.price || 0;
      const shares = price > 0 ? calcShares(dollarAmount, price): 0;
      return {
        symbol: stock.symbol,
        name: stock.name,
        allocationPct: stock.allocation,
        price,
        shares: Math.round(shares * 10000) / 10000,
        totalCost: Math.round(dollarAmount * 100) / 100,
      };
    }).filter(p => p.shares > 0);
  }, [selectedCurated, budget]);

  const orderEstTotal = executionPlan?.reduce((sum, p) => sum + p.totalCost, 0) || 0;
  const orderEstBuffer = (parseInt(budget) || 0) - orderEstTotal;

  // ── Scroll trap: prevent background scroll when modal is open ──
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalWidth = document.body.style.width;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.width = originalWidth;
    };
  }, [isOpen]);

  // ── Basket review budget validation (must be above early return) ──
  useEffect(() => {
    if (step === 'basket_review') {
      doValidateBudget();
    }
  }, [reviewStocks, budget, step]);

  if (!isOpen) return null;

  const budgetNum = parseInt(budget) || 10000;
  const displayTheme = selectedCurated ? selectedCurated.name : (customName.trim() || 'Custom');

  // ── Navigate back ──
  const goBack = () => {
    if (step === 'custom_theme') setStep('curated');
    else if (step === 'budget') setStep(selectedCurated ? 'curated' : 'custom_theme');
    else if (step === 'basket_confirm') setStep('basket_review');
    else if (step === 'basket_review') setStep('budget');
    else if (step === 'review') setStep('budget');
  };

  // ── Generate custom basket ──
  async function generateBasket() {
    setIsGenerating(true); setError(null); setStep('generating');
    try {
      const res = await fetch('/api/basket/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: displayTheme, budget: budgetNum,
          investorStyle: user?.investorStyle || 'Lynch',
          riskTolerance: user?.riskTolerance || 'Moderate',
        }),
      });
      if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || 'Failed to generate'); }
      const data: BasketData = await res.json();
      const stocksWithPrices = await Promise.all(data.stocks.map(async (stock) => {
        try {
          const qRes = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(stock.symbol)}`);
          const qData = await qRes.json();
          const price = qData?.c || 0;
          const dollarAmount = (stock.allocation / 100) * budgetNum;
          const shares = price > 0 ? calcShares(dollarAmount, price): 0;
          return { ...stock, price, dollarAmount, shares };
        } catch { return { ...stock, price: 0, dollarAmount: 0, shares: 0 }; }
      }));
      const valid = stocksWithPrices.filter(s => s.price > 0);
      const invalidAlloc = stocksWithPrices.filter(s => s.price <= 0).reduce((sum, s) => sum + s.allocation, 0);
      if (valid.length > 0 && invalidAlloc > 0) {
        const redistPer = invalidAlloc / valid.length;
        valid.forEach(s => {
          s.allocation = +(s.allocation + redistPer).toFixed(1);
          s.dollarAmount = (s.allocation / 100) * budgetNum;
          s.shares = calcShares(s.dollarAmount, s.price!);
        });
        const totalAlloc = valid.reduce((sum, s) => sum + s.allocation, 0);
        if (totalAlloc !== 100) {
          const diff = 100 - totalAlloc;
          valid[0].allocation = +(valid[0].allocation + diff).toFixed(1);
          valid[0].dollarAmount = (valid[0].allocation / 100) * budgetNum;
          valid[0].shares = calcShares(valid[0].dollarAmount, valid[0].price!);
        }
      }
      setBasketData({ ...data, stocks: valid });
      setStep('review');
    } catch (err: any) {
      setError(err?.message || 'Failed to generate basket');
      setStep('review');
    } finally { setIsGenerating(false); }
  }

  // ── Invest from curated basket ──
  function investCurated(basket: CuratedBasket) {
    setSelectedCurated(basket);
    setStep('budget');
  }

  // ── Add curated basket directly to portfolio ──
  async function addCuratedToPortfolio() {
    if (!selectedCurated) return;
    const msg = `Add ${selectedCurated.name} basket (${selectedCurated.stocks.length} stocks, $${budgetNum.toLocaleString()}) to my portfolio`;
    onClose();
    onBasketGenerated(msg, selectedCurated);
  }

  function addToPortfolio() {
    if (!basketData) return;
    const msg = `Add ${basketData.theme} basket (${basketData.stocks.length} stocks, $${budgetNum.toLocaleString()}) to my portfolio`;
    onClose();
    onBasketGenerated(msg, basketData);
  }

  // ── Performance helpers ──
  const getDisplayPerf = (basket: CuratedBasket): { value: number; label: string } => {
    const tf = basketTimeframes[basket.id] || basket.performance?.best_timeframe || '1y';
    const val = (basket.performance as any)?.[tf] || 0;
    return { value: val, label: tf };
  };
  const cycleTimeframe = (basketId: string) => {
    setBasketTimeframes(prev => {
      const order = ['3m', 'ytd', '1y'];
      const current = prev[basketId] || '1y';
      const next = order[(order.indexOf(current) + 1) % 3];
      return { ...prev, [basketId]: next };
    });
  };

  const formatLastUpdated = (iso: string | null): string => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatNextRefresh = (iso: string | null): string => {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // ── StepHeader component ──
  const StepHeader = ({
    title, onBack, onClose, backLabel = '← Back',
  }: { title: string; onBack: () => void; onClose: () => void; backLabel?: string }) => {
    const isFirstStep = step === 'curated';
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        {isFirstStep ? (
          <div style={{ width: '70px' }} />
        ) : (
          <button onClick={onBack} style={{
            color: '#22d3ee', background: 'none', border: 'none',
            fontSize: '14px', cursor: 'pointer', padding: '4px', minWidth: '70px', textAlign: 'left',
          }}>{backLabel}</button>
        )}
        <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '15px' }}>{title}</span>
        <button onClick={onClose} style={{
          color: '#94a3b8', background: 'none', border: 'none',
          fontSize: '22px', cursor: 'pointer', lineHeight: 1, minWidth: '70px', textAlign: 'right',
        }}>×</button>
      </div>
    );
  };

  const stepHeader = (() => {
    switch (step) {
      case 'curated': return <StepHeader title="Build Basket" onBack={goBack} onClose={onClose} backLabel="← Back" />;
      case 'custom_theme': return <StepHeader title="Custom Basket" onBack={goBack} onClose={onClose} backLabel="← Back" />;
      case 'budget': return <StepHeader title="Set Budget" onBack={() => selectedCurated ? setStep('curated') : setStep('custom_theme')} onClose={onClose} backLabel={selectedCurated ? '← Baskets' : '← Back'} />;
      case 'generating': return <StepHeader title="Generating..." onBack={goBack} onClose={onClose} backLabel="← Back" />;
      case 'review': return <StepHeader title="Review Order" onBack={goBack} onClose={onClose} backLabel="← Back" />;
      case 'basket_review': return <StepHeader title="Review Order" onBack={() => setStep('budget')} onClose={onClose} backLabel="← Budget" />;
      case 'basket_confirm': return <StepHeader title="Confirm Order" onBack={() => setStep('basket_review')} onClose={onClose} backLabel="← Review" />;
      case 'success': return null;
      default: return null;
    }
  })();

  // ────────────────────────────────────────────────────────────
  // STEP 0: CURATED BASKETS
  // ────────────────────────────────────────────────────────────
  const curatedStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {/* Subtitle row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            AI-curated · Updated {formatLastUpdated(lastUpdated)}
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Next refresh {formatNextRefresh(nextRefresh)}
          </span>
        </div>

        {/* Changelog toggle */}
        {changelog && (
          <div style={{ marginBottom: '12px' }}>
            <button
              onClick={() => setChangelogExpanded(!changelogExpanded)}
              style={{
                background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)',
                borderRadius: '8px', padding: '8px 12px', width: '100%',
                color: '#64748b', fontSize: '12px', cursor: 'pointer',
                textAlign: 'left', display: 'flex', justifyContent: 'space-between',
              }}
            >
              <span>📝 What changed ↓</span>
              <span style={{ color: '#22d3ee' }}>{changelogExpanded ? '▲' : '▼'}</span>
            </button>
            {changelogExpanded && (
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
                padding: '10px 12px', marginTop: '4px', fontSize: '11px', color: '#64748b',
                lineHeight: '1.5', fontStyle: 'italic',
              }}>{changelog}</div>
            )}
          </div>
        )}

        {/* Loading state */}
        {curatedLoading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '48px 0', gap: '12px',
          }}>
            <CompassIcon size={48} color="#22d3ee" animated={true} />
            <p style={{ fontSize: '13px', color: '#64748b' }}>Loading curated baskets...</p>
          </div>
        )}

        {/* Error state */}
        {curatedError && !curatedLoading && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p style={{ fontSize: '13px', color: '#ef4444', marginBottom: '8px' }}>
              Could not load baskets: {curatedError}
            </p>
            <button onClick={() => setStep('custom_theme')} style={{
              background: '#22d3ee', border: 'none', borderRadius: '8px',
              color: '#000', fontSize: '12px', fontWeight: '600', padding: '8px 16px', cursor: 'pointer',
            }}>Build Custom Instead</button>
          </div>
        )}

        {/* Empty state (no baskets yet) */}
        {!curatedLoading && !curatedError && curatedBaskets.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '48px 0', gap: '12px',
          }}>
            <CompassIcon size={48} color="#22d3ee" animated={true} />
            <p style={{ fontSize: '14px', color: '#ffffff', fontWeight: '600' }}>
              No baskets yet
            </p>
            <p style={{ fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
              AI-curated baskets are generated weekly.<br />
              Build a custom basket instead.
            </p>
            <button onClick={() => setStep('custom_theme')} style={{
              background: '#22d3ee', border: 'none', borderRadius: '8px',
              color: '#000', fontSize: '13px', fontWeight: '600', padding: '10px 20px', cursor: 'pointer', marginTop: '8px',
            }}>✏️ Build Custom Basket</button>
          </div>
        )}

        {/* Basket cards */}
        {!curatedLoading && curatedBaskets.map((basket) => {
          const perf = getDisplayPerf(basket);
          const isPositive = perf.value >= 0;
          const isExpanded = expandedPreview === basket.id;

          return (
            <div key={basket.id} style={{
              background: '#1a2235', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px', padding: '16px', marginBottom: '12px',
            }}>
              {/* Header row: emoji + name + perf badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>{basket.emoji}</span>
                  <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '14px' }}>{basket.name}</span>
                </div>
                {/* Performance badge */}
                <div onClick={() => cycleTimeframe(basket.id)} style={{ textAlign: 'right', cursor: 'pointer' }}>
                  <span style={{
                    fontSize: '14px', fontWeight: '700',
                    color: isPositive ? '#34d399' : '#f87171',
                  }}>
                    {isPositive ? '+' : ''}{perf.value.toFixed(1)}%
                  </span>
                  <span style={{
                    display: 'block', fontSize: '10px',
                    color: '#6b7280', textTransform: 'uppercase',
                  }}>
                    {perf.label.toUpperCase()} · tap to cycle
                  </span>
                </div>
              </div>

              {/* Thesis */}
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 8px 0', lineHeight: '1.4' }}>
                {basket.thesis}
              </p>

              {/* Ticker pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {(basket.stocks || []).slice(0, 8).map((s: any) => (
                  <span key={s.symbol} style={{
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '20px', padding: '2px 8px', fontSize: '11px', color: '#cbd5e1',
                  }}>{s.symbol}</span>
                ))}
              </div>

              {/* Risk note */}
              <p style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic', margin: '0 0 10px 0' }}>
                ⚠️ {basket.risk_note}
              </p>

              {/* Expanded preview */}
              {isExpanded && (
                <div style={{
                  borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px', marginBottom: '10px',
                }}>
                  {(basket.stocks || []).map((s: any, i: number) => (
                    <div key={s.symbol}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', padding: '6px 0',
                      }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#ffffff' }}>
                            {s.symbol}
                          </span>
                          <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '6px' }}>
                            {s.name}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#22d3ee' }}>{s.allocation}%</span>
                          {s.performance && (
                            <span style={{
                              fontSize: '10px', fontWeight: '600',
                              color: (s.performance['1y'] || 0) >= 0 ? '#34d399' : '#f87171',
                            }}>
                              {(s.performance['1y'] || 0) >= 0 ? '+' : ''}{(s.performance['1y'] || 0).toFixed(1)}% 1Y
                            </span>
                          )}
                        </div>
                      </div>
                      {s.rationale && (
                        <p style={{ fontSize: '10px', color: '#64748b', margin: '0 0 4px 0', lineHeight: '1.3' }}>
                          {s.rationale}
                        </p>
                      )}
                      {i < (basket.stocks || []).length - 1 && (
                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setExpandedPreview(isExpanded ? null : basket.id)}
                  style={{
                    flex: 1, background: 'transparent',
                    border: '1px solid #22d3ee', borderRadius: '8px',
                    padding: '8px 0', color: '#22d3ee', fontSize: '12px',
                    fontWeight: '500', cursor: 'pointer',
                  }}
                >
                  {isExpanded ? 'Collapse' : 'Preview'}
                </button>
                <button
                  onClick={() => investCurated(basket)}
                  style={{
                    flex: 1, background: '#22d3ee', border: 'none',
                    borderRadius: '8px', padding: '8px 0', color: '#000000',
                    fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                  }}
                >
                  Invest →
                </button>
              </div>
            </div>
          );
        })}

        {/* Build custom divider */}
        {!curatedLoading && (
          <div style={{ padding: '16px 0', textAlign: 'center' }}>
            <span style={{ color: '#64748b', fontSize: '12px' }}>─── or ───</span>
            <br />
            <button onClick={() => setStep('custom_theme')} style={{
              marginTop: '12px', width: '100%', background: 'transparent',
              border: '1px dashed #22d3ee', borderRadius: '10px',
              padding: '14px 0', color: '#22d3ee', fontSize: '14px',
              fontWeight: '500', cursor: 'pointer',
            }}>
              ✏️ Build Custom Basket
            </button>
          </div>
        )}
      </div>
    </>
  );

  // ────────────────────────────────────────────────────────────
  // STEP 1: CUSTOM THEME (single input)
  // ────────────────────────────────────────────────────────────
  const customThemeStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', paddingBottom: '200px' }}>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
          Describe the basket you want
        </p>
        <textarea
          value={customName}
          onChange={e => setCustomName(e.target.value)}
          placeholder="e.g. Regional banks, lithium miners, or European healthcare..."
          autoFocus
          rows={3}
          style={{
            width: '100%', background: '#1a2235', border: '1px solid rgba(34,211,238,0.2)',
            borderRadius: '10px', padding: '12px', color: '#ffffff', fontSize: '14px',
            outline: 'none', boxSizing: 'border-box', resize: 'none',
            fontFamily: 'inherit',
          }}
        />
        {/* Inspirations */}
        <p style={{ fontSize: '11px', color: '#64748b', marginTop: '16px', marginBottom: '8px' }}>
          Need inspiration? Try:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {['Robotics & automation', 'Crypto mining stocks', 'Space economy', 'Water infrastructure'].map(tag => (
            <button key={tag} onClick={() => { setCustomName(tag); }} style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px', padding: '6px 12px', fontSize: '11px', color: '#94a3b8',
              cursor: 'pointer',
            }}>{tag}</button>
          ))}
        </div>
      </div>

      {/* Fixed bottom buttons */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        background: '#0a0f1e',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 16px',
        paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 90px), 100px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <button
          onClick={() => setStep('budget')}
          disabled={!customName.trim()}
          style={{
            width: '100%',
            padding: '16px',
            background: customName.trim() ? '#22d3ee' : 'rgba(34,211,238,0.2)',
            color: customName.trim() ? '#0a0f1e' : '#6b7280',
            border: 'none',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: customName.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Generate Basket →
        </button>
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '14px',
            background: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontSize: '14px',
            color: '#6b7280',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </>
  );

  // ────────────────────────────────────────────────────────────
  // STEP 2: BUDGET
  // ────────────────────────────────────────────────────────────
  const budgetStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))' }}>
        {selectedCurated && (
          <div style={{
            background: '#1a2235', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px',
          }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Basket: </span>
            <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: '600' }}>{selectedCurated.emoji} {selectedCurated.name}</span>
          </div>
        )}
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
          How much do you want to invest?
        </p>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '24px', padding: '8px 0', borderBottom: '1px solid #22d3ee',
        }}>
          <span style={{ fontSize: '28px', color: '#64748b', fontWeight: '300', marginRight: '4px' }}>$</span>
          <input type="number" value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder="0" inputMode="numeric" autoFocus
            style={{
              background: 'transparent', border: 'none', color: '#ffffff',
              fontSize: '28px', fontWeight: '700', width: '120px',
              textAlign: 'center', outline: 'none',
            }}
          />
        </div>

        {/* Quick selects */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '24px' }}>
          {[1000, 5000, 10000, 25000].map(amt => (
            <button key={amt} onClick={() => setBudget(String(amt))} style={{
              background: budget === String(amt) ? 'rgba(34,211,238,0.1)' : 'transparent',
              border: budget === String(amt) ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.2)',
              borderRadius: '20px', padding: '8px 16px', color: budget === String(amt) ? '#22d3ee' : '#94a3b8',
              fontSize: '13px', cursor: 'pointer',
            }}>${amt.toLocaleString()}</button>
          ))}
        </div>
      </div>

      {/* Fixed bottom buttons */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        background: '#0a0f1e',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 16px',
        paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 90px), 100px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <button
          onClick={() => selectedCurated ? setStep('basket_review') : generateBasket()}
          disabled={!budget || parseInt(budget) <= 0}
          style={{
            width: '100%',
            padding: '16px',
            background: budget && parseInt(budget) > 0 ? '#22d3ee' : 'rgba(34,211,238,0.2)',
            color: budget && parseInt(budget) > 0 ? '#0a0f1e' : '#6b7280',
            border: 'none',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: budget && parseInt(budget) > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          {selectedCurated ? 'Review Order →' : 'Generate Basket →'}
        </button>
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '14px',
            background: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontSize: '14px',
            color: '#6b7280',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </>
  );

  // ────────────────────────────────────────────────────────────
  // STEP 3: GENERATING
  // ────────────────────────────────────────────────────────────
  const generatingStep = (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '32px', gap: '16px',
    }}>
      <CompassIcon size={64} color="#22d3ee" animated={true} />
      <p style={{ fontSize: '16px', fontWeight: '600', color: '#ffffff', textAlign: 'center' }}>
        Vantage AI is building your basket...
      </p>
      <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>
        Selecting top stocks for {displayTheme}
      </p>
    </div>
  );

  // ────────────────────────────────────────────────────────────
  // STEP 4: REVIEW (with stock management)
  // ────────────────────────────────────────────────────────────
  const reviewStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {error ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p style={{ fontSize: '14px', color: '#ef4444', marginBottom: '12px' }}>{error}</p>
            <button onClick={generateBasket} style={{
              background: '#22d3ee', border: 'none', borderRadius: '10px',
              color: '#000', fontSize: '14px', fontWeight: '600', padding: '12px 24px', cursor: 'pointer',
            }}>Try Again</button>
          </div>
        ) : basketData ? (
          <>
            {/* Header */}
            <p style={{ fontSize: '14px', fontWeight: '600', color: '#ffffff', marginBottom: '4px' }}>
              {basketData.theme} Basket · ${budgetNum.toLocaleString()}
            </p>
            <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.5', marginBottom: '16px' }}>
              {basketData.rationale}
            </p>

            {removeFlash && (
              <p style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', marginBottom: '8px' }}>
                Allocation adjusted
              </p>
            )}

            {/* Stock rows */}
            {basketData.stocks.map((stock, i) => (
              <div key={stock.symbol}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 0' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <div>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>{stock.symbol}</span>
                        <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px' }}>{stock.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: '#22d3ee', fontWeight: '500' }}>{stock.allocation}%</span>
                        <span style={{ fontSize: '12px', color: '#ffffff', fontWeight: '500' }}>
                          ${(stock.dollarAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                        </span>
                        {basketData.stocks.length > 2 && (
                          <button onClick={() => removeStock(stock.symbol)} style={{
                            background: 'none', border: 'none', color: '#ef4444',
                            fontSize: '16px', cursor: 'pointer', padding: '0 4px', lineHeight: 1,
                          }}>×</button>
                        )}
                      </div>
                    </div>
                    <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                      {stock.shares} shares @ ${(stock.price || 0).toFixed(2)}
                    </p>
                    {stock.rationale && (
                      <p style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic', margin: '2px 0 0 0', lineHeight: '1.4' }}>
                        💡 {stock.rationale}
                      </p>
                    )}
                  </div>
                </div>
                {i < basketData.stocks.length - 1 && (
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                )}
              </div>
            ))}

            {/* Total */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '12px 0',
              marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)',
            }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>Total</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>
                ${basketData.stocks.reduce((sum, s) => sum + (s.dollarAmount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </span>
            </div>

            {/* Add Stock */}
            {!showAddStock ? (
              <button onClick={() => setShowAddStock(true)}
                disabled={basketData.stocks.length >= 8}
                style={{
                  width: '100%', padding: '12px', border: '1px dashed rgba(34,211,238,0.3)',
                  borderRadius: '8px', color: basketData.stocks.length >= 8 ? '#4b5563' : '#22d3ee',
                  background: 'none', cursor: basketData.stocks.length >= 8 ? 'not-allowed' : 'pointer',
                  fontSize: '13px', marginTop: '12px',
                }}
              >+ Add Stock</button>
            ) : (
              <div style={{ marginTop: '12px', position: 'relative' }}>
                <input type="text" value={addStockSymbol}
                  onChange={e => setAddStockSymbol(e.target.value)}
                  placeholder="Search symbol or company..."
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setShowAddStock(false); setAddStockSymbol(''); setStockSearchResults([]); }
                  }} autoFocus disabled={isAddingStock}
                  style={{
                    width: '100%', background: '#1a2235', border: '1px solid rgba(34,211,238,0.3)',
                    borderRadius: '8px', padding: '10px 12px', color: '#ffffff', fontSize: '13px',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {/* Auto-complete dropdown */}
                {stockSearchResults.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    marginTop: 4, background: '#1e293b', border: '1px solid #334155',
                    borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                    maxHeight: '200px', overflow: 'auto',
                  }}>
                    {stockSearchLoading && (
                      <div style={{ padding: '8px 12px', fontSize: '11px', color: '#64748b' }}>Searching…</div>
                    )}
                    {stockSearchResults.map((r: any, i: number) => (
                      <button
                        key={r.symbol}
                        onClick={() => {
                          addStock(r.symbol);
                          setAddStockSymbol('');
                          setStockSearchResults([]);
                        }}
                        style={{
                          width: '100%', display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', padding: '8px 12px',
                          background: 'transparent', border: 'none',
                          borderBottom: i < stockSearchResults.length - 1 ? '1px solid #33415550' : 'none',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9' }}>{r.symbol}</div>
                          {r.description && <div style={{ fontSize: '10px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>{r.description}</div>}
                        </div>
                        <span style={{ fontSize: '10px', color: '#64748b', flexShrink: 0, marginLeft: '8px' }}>{r.type}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={() => { setShowAddStock(false); setAddStockSymbol(''); setStockSearchResults([]); }} style={{
                    flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', padding: '8px 0', color: '#94a3b8', fontSize: '12px', cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              </div>
            )}
            {error && <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px' }}>{error}</p>}
          </>
        ) : (
          <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '24px 0' }}>
            No basket data available
          </p>
        )}
      </div>

      {/* Bottom buttons */}
      {basketData && !error && (
        <div style={{
          padding: '12px 20px calc(16px + env(safe-area-inset-bottom)) 20px',
          flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          <button onClick={addToPortfolio} style={{
            width: '100%', background: '#22d3ee', border: 'none', borderRadius: '10px',
            color: '#000', fontSize: '14px', fontWeight: '600', padding: '14px 0', cursor: 'pointer',
          }}>Add to Portfolio</button>
          <button onClick={generateBasket} style={{
            width: '100%', background: 'transparent', border: '1px solid #22d3ee',
            borderRadius: '10px', color: '#22d3ee', fontSize: '14px', fontWeight: '500',
            padding: '14px 0', cursor: 'pointer',
          }}>Regenerate</button>
        </div>
      )}
    </>
  );

  // ────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────
  // STEP: BASKET REVIEW (live prices + customize)
  // ────────────────────────────────────────────────────────────

  // ── Dollar amount editing & budget validation (unified) ──
  function updateDollarAmount(symbol: string, newAmount: number) {
    const bNum = parseInt(budget) || 0;
    if (!bNum) return;
    
    // Minimum = price of 1 share (at least 1 share price floor)
    const stockItem = reviewStocks.find(s => s.symbol === symbol);
    if (!stockItem) return;
    const minAmount = stockItem.price; // at least 1 share
    const clamped = Math.max(minAmount, newAmount);

    setReviewStocks(prev => {
      const updated = prev.map(s => {
        if (s.symbol !== symbol) return s;
        const dollarAmount = Math.round(clamped * 100) / 100;
        const estimatedShares = calcShares(dollarAmount, s.price);
        return {
          ...s,
          dollarAmount,
          estimatedShares,
          shares: estimatedShares, // sync shares for execution
          allocation: 0, // recomputed below
        };
      });

      // Recalculate allocation % based on dollar amounts
      const total = updated.reduce((sum, s) => sum + s.dollarAmount, 0);
      const withAlloc = updated.map(s => ({
        ...s,
        allocation: Math.round((s.dollarAmount / total) * 100),
      }));

      // Check total vs budget
      const effectiveBudget = bNum * 0.95;
      const hardLimit = bNum * 1.0;

      if (total > hardLimit) {
        setBudgetError(`Total $${total.toFixed(2)} exceeds budget $${bNum.toFixed(2)}`);
        setBudgetWarning(null);
        setCanProceed(false);
        return prev;
      }

      if (total > effectiveBudget) {
        setBudgetWarning(`Using buffer. Total: $${total.toFixed(2)} / $${bNum.toFixed(2)}`);
        setBudgetError(null);
        setCanProceed(true);
      } else {
        setBudgetWarning(null);
        setBudgetError(null);
        setCanProceed(true);
      }

      return withAlloc;
    });
  }

  // Validate on initial render when stocks load
  function doValidateBudget() {
    if (!budget) return;
    const bNum = parseInt(budget) || 0;
    const total = reviewStocks.reduce((sum, s) => sum + s.dollarAmount, 0);
    const effectiveBudget = bNum * 0.95;
    if (total > bNum) {
      setBudgetError(`Total $${total.toFixed(2)} exceeds budget $${bNum.toFixed(2)}`);
      setBudgetWarning(null);
      setCanProceed(false);
    } else if (total > effectiveBudget) {
      setBudgetWarning(`Using buffer. Total: $${total.toFixed(2)} / $${bNum.toFixed(2)}`);
      setBudgetError(null);
      setCanProceed(true);
    } else {
      setBudgetWarning(null);
      setBudgetError(null);
      setCanProceed(true);
    }
  }

  // Run validation when reviewStocks or budget changes
  // (moved above early return — see useEffect block before if (!isOpen) return null)

  // ── Confirm and execute basket order ──
  async function handleConfirmOrder() {
    if (!selectedCurated || reviewStocks.length === 0) return;
    setExecuting(true);
    setExecutionResult(null);
    const bNum = parseInt(budget) || 0;
    const result = await executeBasketTrade(
      selectedCurated.id,
      selectedCurated.name,
      selectedCurated.emoji,
      reviewStocks.map(s => ({ symbol: s.symbol, allocationPct: s.allocation, name: s.name })),
      bNum,
    );
    setExecutionResult(result);
    setExecuting(false);
    if (result.success) {
      const b = selectedCurated!;
      const market = getMarketStatus();
      setBasketResult({
        basketName: b.name,
        basketEmoji: b.emoji,
        stocks: reviewStocks.map(s => ({
          symbol: s.symbol,
          shares: s.shares,
          price: s.price,
          totalCost: s.dollarAmount,
        })),
        totalSpent: result.totalSpent,
        cashRemaining: cashBalance - result.totalSpent,
        executed: result.executed,
        failed: result.failed,
        status: result.status || 'FILLED',
        marketLabel: market.nextOpenLabel || '',
      } as any);
      setStep('success');
    }
  }

  const basketReviewStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '200px' }}>
        {/* Basket summary */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(34,211,238,0.04)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#ffffff', fontWeight: '600' }}>
              {selectedCurated?.emoji} {selectedCurated?.name}
            </span>
            <span style={{ color: '#22d3ee' }}>${(parseInt(budget) || 0).toLocaleString()} budget</span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '4px' }}>
            Effective: <span style={{ color: '#22d3ee' }}>${((parseInt(budget) || 0) * 0.95).toLocaleString(undefined, { minimumFractionDigits: 0 })}</span> · 5% buffer held (~${((parseInt(budget) || 0) * 0.05).toLocaleString(undefined, { minimumFractionDigits: 0 })})
          </div>
        </div>

        {/* Loading state */}
        {loadingPrices && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', padding: '48px 0' }}>
            <CompassIcon size={48} color="#22d3ee" animated={true} />
            <span style={{ color: '#94a3b8', fontSize: '13px' }}>Fetching live prices...</span>
          </div>
        )}

        {/* Stock list */}
        {!loadingPrices && (
          <>
            {/* Execution Plan header with Customize toggle */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              marginBottom: '4px',
            }}>
              <span style={{
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: '600',
                letterSpacing: '-0.01em',
              }}>
                Execution Plan
              </span>
              <button
                onClick={() => setIsEditMode(!isEditMode)}
                style={{
                  background: isEditMode
                    ? 'rgba(34,211,238,0.15)'
                    : 'rgba(255,255,255,0.06)',
                  border: isEditMode
                    ? '1px solid rgba(34,211,238,0.5)'
                    : '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '8px',
                  padding: '7px 16px',
                  color: isEditMode ? '#22d3ee' : '#e2e8f0',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {isEditMode ? '✓ Done' : '✏️ Customize'}
              </button>
            </div>

            {reviewStocks.map((stock, i) => (
              <div key={stock.symbol} style={{
                display: 'flex', alignItems: 'flex-start',
                padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', gap: '8px',
              }}>
                {/* Remove button — only in edit mode */}
                {isEditMode && (
                  <button
                    onClick={() => onRemoveStock(stock.symbol)}
                    disabled={reviewStocks.length <= 2}
                    style={{
                      color: reviewStocks.length <= 2 ? '#1f2937' : '#ef4444',
                      background: 'none', border: 'none', fontSize: '20px',
                      cursor: reviewStocks.length <= 2 ? 'not-allowed' : 'pointer',
                      flexShrink: 0, lineHeight: 1, width: '28px', textAlign: 'center',
                      marginTop: '2px',
                    }}
                  >×</button>
                )}

                {/* Stock info */}
                <div style={{ flex: 1 }}>
                  {/* Ticker + allocation */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div>
                      <span style={{ color: '#ffffff', fontWeight: '700', fontSize: '14px' }}>{stock.symbol}</span>
                      <span style={{ color: '#94a3b8', fontSize: '11px', marginLeft: '6px' }}>{stock.name}</span>
                      {stock.isCustomAdded && (
                        <span style={{ fontSize: '9px', color: '#22d3ee', marginLeft: '4px', background: 'rgba(34,211,238,0.1)', borderRadius: '4px', padding: '1px 5px' }}>CUSTOM</span>
                      )}
                    </div>
                    <span style={{ color: '#22d3ee', fontWeight: '600', fontSize: '13px' }}>{stock.allocation}%</span>
                  </div>

                  {/* Estimated shares — subtle, below ticker */}
                  <div style={{
                    color: '#94a3b8',
                    fontSize: '11px',
                    marginBottom: '8px',
                    fontStyle: 'italic',
                  }}>
                    Est. ~{(stock.dollarAmount / stock.price).toFixed(4)} shares @ ${stock.price.toFixed(2)}
                    {' '}
                    <span style={{ color: '#64748b' }}>· qty calculated at market price</span>
                  </div>

                  {/* Dollar amount controls */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    {/* Decrease $10 */}
                    <button
                      onClick={() => updateDollarAmount(stock.symbol, Math.max(stock.price, stock.dollarAmount - 10))}
                      style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.08)', border: 'none',
                        color: '#ffffff', fontSize: '18px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >−</button>

                    {/* Dollar input */}
                    {editingSymbol === stock.symbol ? (
                      <input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => {
                          const parsed = parseFloat(editValue);
                          if (!isNaN(parsed) && parsed >= stock.price) {
                            updateDollarAmount(stock.symbol, parsed);
                          }
                          setEditingSymbol(null);
                          setEditValue('');
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const parsed = parseFloat(editValue);
                            if (!isNaN(parsed) && parsed >= stock.price) {
                              updateDollarAmount(stock.symbol, parsed);
                            }
                            setEditingSymbol(null);
                            setEditValue('');
                          } else if (e.key === 'Escape') {
                            setEditingSymbol(null);
                            setEditValue('');
                          }
                        }}
                        style={{
                          flex: 1,
                          background: '#0a0f1e',
                          border: '1px solid #22d3ee',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          color: '#ffffff',
                          fontSize: '14px',
                          fontWeight: '600',
                          textAlign: 'center',
                          outline: 'none',
                          boxSizing: 'border-box',
                          MozAppearance: 'textfield',
                        } as React.CSSProperties}
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setEditingSymbol(stock.symbol);
                          setEditValue(stock.dollarAmount.toFixed(2));
                        }}
                        style={{
                          flex: 1,
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          color: '#ffffff',
                          fontSize: '14px',
                          fontWeight: '600',
                          textAlign: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        ${stock.dollarAmount.toFixed(2)}
                      </button>
                    )}

                    {/* Increase $10 */}
                    <button
                      onClick={() => updateDollarAmount(stock.symbol, stock.dollarAmount + 10)}
                      style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.08)', border: 'none',
                        color: '#ffffff', fontSize: '18px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >+</button>
                  </div>
                </div>
              </div>
            ))}

            {/* Add stock button — only in edit mode */}
            {isEditMode && reviewStocks.length < 10 && (
              <div style={{ padding: '8px 16px' }}>
                {showAddInput ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
                      <input autoFocus placeholder="Search symbol or company..." value={addSymbolInput}
                        onChange={e => setAddSymbolInput(e.target.value.toUpperCase())}
                        onKeyDown={e => {
                          if (e.key === 'Escape') { setShowAddInput(false); setAddSymbolInput(''); setReviewSearchResults([]); }
                        }}
                        style={{
                          flex: 1, background: '#0a0f1e', border: '1px solid rgba(34,211,238,0.3)',
                          borderRadius: '8px', padding: '8px 12px', color: '#ffffff', fontSize: '13px',
                        }}
                      />
                      <button onClick={() => { setShowAddInput(false); setAddSymbolInput(''); setReviewSearchResults([]); }} style={{
                        background: 'none', border: 'none', color: '#6b7280', fontSize: '20px',
                        cursor: 'pointer', flexShrink: 0,
                      }}>×</button>
                    </div>
                    {/* Auto-complete dropdown */}
                    {reviewSearchResults.length > 0 && (
                      <div style={{
                        background: '#1e293b', border: '1px solid #334155',
                        borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                        maxHeight: '200px', overflow: 'auto', zIndex: 50,
                      }}>
                        {reviewSearchLoading && (
                          <div style={{ padding: '8px 12px', fontSize: '11px', color: '#64748b' }}>Searching…</div>
                        )}
                        {reviewSearchResults.map((r: any, i: number) => (
                          <button
                            key={r.symbol}
                            onClick={() => {
                              handleAddStock(r.symbol);
                              setAddSymbolInput('');
                              setReviewSearchResults([]);
                            }}
                            style={{
                              width: '100%', display: 'flex', justifyContent: 'space-between',
                              alignItems: 'center', padding: '8px 12px',
                              background: 'transparent', border: 'none',
                              borderBottom: i < reviewSearchResults.length - 1 ? '1px solid #33415550' : 'none',
                              cursor: 'pointer', textAlign: 'left',
                            }}
                          >
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9' }}>{r.symbol}</div>
                              {r.description && <div style={{ fontSize: '10px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>{r.description}</div>}
                            </div>
                            <span style={{ fontSize: '10px', color: '#64748b', flexShrink: 0, marginLeft: '8px' }}>{r.type}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button onClick={() => setShowAddInput(true)} style={{
                    width: '100%', padding: '10px', background: 'none',
                    border: '1px dashed rgba(34,211,238,0.25)', borderRadius: '8px',
                    color: '#22d3ee', fontSize: '13px', cursor: 'pointer',
                  }}>+ Add Stock or ETF</button>
                )}
              </div>
            )}

            {/* Error */}
            {error && <p style={{ fontSize: '11px', color: '#ef4444', padding: '8px 16px' }}>{error}</p>}

            {/* ── Running Total + Estimated Total ── */}
            {(() => {
              const runningTotal = reviewStocks.reduce((sum, s) => sum + s.dollarAmount, 0);
              const bNum = parseInt(budget) || 0;
              const effBudget = bNum * 0.95;
              return (
                <>
                  <div style={{
                    margin: '12px 16px 0',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}>
                    {/* Running total row */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '14px 16px',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <div>
                        <div style={{
                          color: '#ffffff',
                          fontSize: '15px',
                          fontWeight: '600',
                        }}>
                          Running Total
                        </div>
                        <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>
                          Updates as you adjust amounts
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          color: runningTotal > bNum
                            ? '#ef4444'
                            : runningTotal > effBudget
                            ? '#f59e0b'
                            : '#10b981',
                          fontSize: '18px',
                          fontWeight: '700',
                        }}>
                          ${runningTotal.toFixed(2)}
                        </div>
                        <div style={{
                          color: '#64748b',
                          fontSize: '11px',
                          marginTop: '2px',
                        }}>
                          of ${effBudget.toFixed(2)} budget
                        </div>
                      </div>
                    </div>

                    {/* Estimated total row */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '14px 16px',
                    }}>
                      <div>
                        <div style={{
                          color: '#ffffff',
                          fontSize: '15px',
                          fontWeight: '600',
                        }}>
                          Estimated Total
                        </div>
                        <div style={{
                          color: '#64748b',
                          fontSize: '11px',
                          marginTop: '2px',
                          fontStyle: 'italic',
                        }}>
                          Actual cost calculated at execution
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          color: '#ffffff',
                          fontSize: '18px',
                          fontWeight: '700',
                        }}>
                          ~${runningTotal.toFixed(2)}
                        </div>
                        <div style={{
                          color: '#64748b',
                          fontSize: '11px',
                          marginTop: '2px',
                        }}>
                          ±slippage at fill
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Budget status bar */}
                  {runningTotal > bNum && (
                    <div style={{
                      margin: '8px 16px 0',
                      padding: '10px 14px',
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      borderRadius: '8px',
                      color: '#f87171',
                      fontSize: '12px',
                    }}>
                      ❌ Total exceeds budget of ${bNum.toFixed(2)}.
                      Reduce amounts to proceed.
                    </div>
                  )}

                  {runningTotal > effBudget && runningTotal <= bNum && (
                    <div style={{
                      margin: '8px 16px 0',
                      padding: '10px 14px',
                      background: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.2)',
                      borderRadius: '8px',
                      color: '#fbbf24',
                      fontSize: '12px',
                    }}>
                      ⚠️ Using price buffer.
                      Within acceptable range.
                    </div>
                  )}

                  {runningTotal <= effBudget && (
                    <div style={{
                      margin: '8px 16px 0',
                      padding: '10px 14px',
                      background: 'rgba(16,185,129,0.06)',
                      border: '1px solid rgba(16,185,129,0.15)',
                      borderRadius: '8px',
                      color: '#34d399',
                      fontSize: '12px',
                    }}>
                      ✓ Within budget ·
                      ${(effBudget - runningTotal).toFixed(2)}
                      remaining
                    </div>
                  )}
                </>
              );
            })()}

            {/* Warning */}
            <div style={{
              margin: '0 16px 12px', padding: '10px 12px',
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: '8px', color: '#f59e0b', fontSize: '11px', lineHeight: '1.5',
            }}>
              ⚠️ Market orders execute at live prices. Final amounts may vary slightly.
            </div>
          </>
        )}
      </div>

      {/* Fixed bottom buttons */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        background: '#0a0f1e',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 16px',
        paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 90px), 100px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <button
          onClick={() => setStep('basket_confirm')}
          disabled={!canProceed || reviewStocks.length < 2 || loadingPrices}
          style={{
            width: '100%', padding: '16px',
            background: canProceed && reviewStocks.length >= 2 ? '#22d3ee' : 'rgba(34,211,238,0.2)',
            color: canProceed && reviewStocks.length >= 2 ? '#0a0f1e' : '#6b7280',
            border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600',
            cursor: canProceed && reviewStocks.length >= 2 ? 'pointer' : 'not-allowed',
          }}
        >Review & Confirm →</button>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '14px',
            background: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontSize: '14px',
            color: '#6b7280',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </>
  );

  // ────────────────────────────────────────────────────────────
  // STEP: BASKET CONFIRM
  // ────────────────────────────────────────────────────────────

  const basketConfirmStep = (
    <>
      <div style={{ flex: 1, padding: '20px 16px', overflowY: 'auto', paddingBottom: '200px' }}>
        {executionResult ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{executionResult.success ? '✅' : '⚠️'}</div>
            <p style={{ fontSize: '16px', fontWeight: '600', color: '#ffffff', marginBottom: '8px' }}>
              {executionResult.success
                ? (executionResult.failed > 0 ? 'Partial Execution' : 'Order Complete!')
                : 'Order Failed'}
            </p>
            {executionResult.success && (
              <>
                <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
                  {executionResult.executed} positions filled · ${executionResult.totalSpent.toFixed(2)} spent
                </p>
                {executionResult.failed > 0 && (
                  <p style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '16px' }}>
                    {executionResult.failed} position{executionResult.failed > 1 ? 's' : ''} could not be filled
                  </p>
                )}
              </>
            )}
            {!executionResult.success && (
              <p style={{ fontSize: '13px', color: '#ef4444', marginBottom: '16px' }}>
                {executionResult.error || 'Unknown error'}
              </p>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }}>
              {executionResult.success && (
                <button onClick={() => onClose()} style={{
                  background: '#22d3ee', border: 'none', borderRadius: '10px',
                  color: '#000', fontSize: '14px', fontWeight: '600', padding: '12px 24px', cursor: 'pointer',
                }}>View Portfolio</button>
              )}
              {!executionResult.success && (
                <button onClick={handleConfirmOrder} style={{
                  background: '#22d3ee', border: 'none', borderRadius: '10px',
                  color: '#000', fontSize: '14px', fontWeight: '600', padding: '12px 24px', cursor: 'pointer',
                }}>Try Again</button>
              )}
            </div>
          </div>
        ) : selectedCurated ? (
          <>
            {/* Order summary card */}
            <div style={{
              background: '#1a2235', borderRadius: '16px', padding: '20px', marginBottom: '16px',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>{selectedCurated.emoji}</div>
              <div style={{ color: '#ffffff', fontWeight: '700', fontSize: '18px', marginBottom: '4px' }}>
                {selectedCurated.name}
              </div>
              <div style={{ color: '#6b7280', fontSize: '13px', marginBottom: '20px' }}>
                {reviewStocks.length} positions · Market order · Day
              </div>

              {[
                { label: 'Budget', value: `$${(parseInt(budget) || 0).toLocaleString()}`, color: '#ffffff' },
                { label: 'Effective (5% buffer)', value: `$${((parseInt(budget) || 0) * 0.95).toLocaleString(undefined, { minimumFractionDigits: 0 })}`, color: '#22d3ee' },
                { label: 'Est. buffer held', value: `~$${((parseInt(budget) || 0) * 0.05).toLocaleString(undefined, { minimumFractionDigits: 0 })}`, color: '#6b7280' },
                { label: 'Est. Total', value: `$${reviewStocks.reduce((s, r) => s + r.dollarAmount, 0).toFixed(2)}`, color: '#ffffff', bold: true },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#6b7280', fontSize: '13px' }}>{row.label}</span>
                  <span style={{ color: row.color, fontSize: '13px', fontWeight: row.bold ? '700' : '400' }}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Warning */}
            <div style={{
              padding: '10px 12px',
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: '8px', color: '#f59e0b', fontSize: '11px', lineHeight: '1.5',
              marginBottom: '12px',
            }}>
              ⚠️ Market orders execute at live prices. Final amounts may vary slightly.
            </div>
          </>
        ) : null}
      </div>

      {/* Both buttons — ALWAYS visible above nav */}
      {!executionResult && selectedCurated && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10000,
          background: '#0a0f1e',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          padding: '12px 16px',
          paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 90px), 100px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          <button onClick={handleConfirmOrder}
            disabled={executing || !parseInt(budget) || (parseInt(budget) || 0) > cashBalance}
            style={{
              width: '100%', padding: '16px',
              background: (executing || !parseInt(budget) || (parseInt(budget) || 0) > cashBalance) ? 'rgba(34,211,238,0.4)' : '#22d3ee',
              color: (executing || !parseInt(budget) || (parseInt(budget) || 0) > cashBalance) ? 'rgba(34,211,238,0.6)' : '#0a0f1e',
              border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600',
              cursor: (executing || !parseInt(budget) || (parseInt(budget) || 0) > cashBalance) ? 'not-allowed' : 'pointer',
            }}
          >{executing ? 'Executing...' : 'Confirm & Buy →'}</button>

          <button
            onClick={onClose}
            style={{
              width: '100%',
              padding: '14px',
              background: 'none',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '12px',
              fontSize: '15px',
              color: '#ef4444',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      background: '#0a0f1e',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {stepHeader}
      {step === 'curated' && curatedStep}
      {step === 'custom_theme' && customThemeStep}
      {step === 'budget' && budgetStep}
      {step === 'generating' && generatingStep}
      {step === 'review' && reviewStep}
      {step === 'basket_review' && basketReviewStep}
      {step === 'basket_confirm' && basketConfirmStep}
      {step === 'success' && basketResult && (
        <>
          {/* Scrollable content */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '32px 16px 200px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            {/* Success icon — ⏳ for pending, ✓ for filled */}
            {(basketResult as any).status === 'OPEN' ? (
              <div style={{
                fontSize: '48px',
                marginBottom: '16px',
              }}>
                ⏳
              </div>
            ) : (
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(16,185,129,0.15)',
                border: '2px solid rgba(16,185,129,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                color: '#10b981',
                marginBottom: '16px',
              }}>
                ✓
              </div>
            )}

            {/* Title */}
            <div style={{ color: '#ffffff', fontSize: '22px', fontWeight: '700', marginBottom: '4px' }}>
              {(basketResult as any).status === 'OPEN' ? 'Order Submitted' : 'Basket Purchased'}
            </div>
            
            {/* Subtitle */}
            {(basketResult as any).status === 'OPEN' ? (
              <div style={{ color: '#6b7280', fontSize: '13px', marginBottom: '24px', textAlign: 'center' }}>
                {(basketResult as any).marketLabel || 'Opens at market open'}<br />
                Cash reserved · Can cancel anytime
              </div>
            ) : (
              <div style={{ color: '#6b7280', fontSize: '13px', marginBottom: '24px' }}>
                {basketResult.executed} positions filled immediately
                {basketResult.failed > 0 && ` · ${basketResult.failed} failed`}
              </div>
            )}

            {/* Basket name card */}
            <div style={{
              background: '#1a2235',
              border: '1px solid rgba(34,211,238,0.2)',
              borderRadius: '16px',
              padding: '16px',
              width: '100%',
              marginBottom: '16px',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <span style={{ fontSize: '24px' }}>{basketResult.basketEmoji}</span>
                <span style={{ color: '#ffffff', fontWeight: '700', fontSize: '16px' }}>{basketResult.basketName}</span>
                {(basketResult as any).status === 'OPEN' && (
                  <span style={{
                    background: 'rgba(245,158,11,0.15)',
                    border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: '6px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    color: '#f59e0b',
                  }}>Pending</span>
                )}
              </div>

              {/* Stock list */}
              {basketResult.stocks.map(stock => (
                <div key={stock.symbol} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '10px',
                  marginBottom: '10px',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div>
                    <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '13px' }}>{stock.symbol}</span>
                    <span style={{ color: '#94a3b8', fontSize: '11px', marginLeft: '8px' }}>
                      {stock.shares.toFixed(4)}sh @ ${stock.price.toFixed(2)}
                    </span>
                  </div>
                  <span style={{ color: '#e2e8f0', fontSize: '12px' }}>
                    ${stock.totalCost.toFixed(2)}
                  </span>
                </div>
              ))}

              {/* Totals */}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
                <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                  {(basketResult as any).status === 'OPEN' ? 'Reserved' : 'Total spent'}
                </span>
                <span style={{ color: '#ffffff', fontWeight: '700', fontSize: '13px' }}>
                  ${basketResult.totalSpent.toFixed(2)}
                </span>
              </div>
              {(basketResult as any).status !== 'OPEN' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                  <span style={{ color: '#6b7280', fontSize: '12px' }}>Cash remaining</span>
                  <span style={{ color: '#22d3ee', fontSize: '12px' }}>
                    ${basketResult.cashRemaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>

            {/* Partial execution warning */}
            {basketResult.failed > 0 && (
              <div style={{
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.2)',
                borderRadius: '10px',
                padding: '10px 14px',
                width: '100%',
                color: '#f59e0b',
                fontSize: '12px',
                marginBottom: '16px',
              }}>
                ⚠️ {basketResult.failed} position{basketResult.failed > 1 ? 's' : ''} could not be filled. Prices may have moved.
              </div>
            )}
          </div>

          {/* Fixed bottom buttons */}
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 10000,
            background: '#0a0f1e',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '12px 16px',
            paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 90px), 100px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}>
            {(basketResult as any).status === 'OPEN' ? (
              <>
                {/* View Open Orders → */}
                <button
                  onClick={() => {
                    setBasketResult(null);
                    setStep('curated');
                    setSelectedCurated(null);
                    setBudget('');
                    setReviewStocks([]);
                    onClose();
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('vantage-navigate', {
                        detail: { tab: 'invest', subTab: 'open' },
                      }));
                    }, 100);
                  }}
                  style={{
                    width: '100%',
                    padding: '16px',
                    background: '#f59e0b',
                    color: '#0a0f1e',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '16px',
                    fontWeight: '700',
                    cursor: 'pointer',
                  }}
                >
                  View Open Orders →
                </button>
                {/* Done */}
                <button
                  onClick={() => {
                    setBasketResult(null);
                    setStep('curated');
                    setSelectedCurated(null);
                    setBudget('');
                    setReviewStocks([]);
                    onClose();
                  }}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: 'none',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '12px',
                    fontSize: '15px',
                    color: '#9ca3af',
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                {/* View in Portfolio → */}
                <button
                  onClick={() => {
                    setBasketResult(null);
                    setStep('curated');
                    setSelectedCurated(null);
                    setBudget('');
                    setReviewStocks([]);
                    onClose();
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('vantage-navigate', {
                        detail: { tab: 'portfolio', scrollTo: 'baskets' },
                      }));
                    }, 100);
                  }}
                  style={{
                    width: '100%',
                    padding: '16px',
                    background: '#22d3ee',
                    color: '#0a0f1e',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '16px',
                    fontWeight: '700',
                    cursor: 'pointer',
                  }}
                >
                  View in Portfolio →
                </button>
                {/* Done */}
                <button
                  onClick={() => {
                    setBasketResult(null);
                    setStep('curated');
                    setSelectedCurated(null);
                    setBudget('');
                    setReviewStocks([]);
                    onClose();
                  }}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: 'none',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '12px',
                    fontSize: '15px',
                    color: '#9ca3af',
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
