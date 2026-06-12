'use client';

import { useState, useEffect, useCallback } from 'react';
import CompassIcon from '@/components/CompassIcon';
import { useAuth } from '@/components/providers/AuthProvider';

// ── 5-step flow: curated → custom_theme → budget → generating → review ──
type Step = 'curated' | 'custom_theme' | 'budget' | 'generating' | 'review';

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

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBasketGenerated: (msg: string, data: any) => void;
}

export default function BuildBasketModal({ isOpen, onClose, onBasketGenerated }: Props) {
  const { user } = useAuth();

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
  const [perfTimeframe, setPerfTimeframe] = useState<string>('best');

  // ── Custom basket state ──
  const [customName, setCustomName] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [budget, setBudget] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [basketData, setBasketData] = useState<BasketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeFlash, setRemoveFlash] = useState(false);
  const [addStockSymbol, setAddStockSymbol] = useState('');
  const [showAddStock, setShowAddStock] = useState(false);
  const [isAddingStock, setIsAddingStock] = useState(false);

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

  // ── Stock management hooks (above early return per TDZ rules) ──
  const removeStock = useCallback((symbol: string) => {
    if (!basketData || basketData.stocks.length <= 2) return;
    const bNum = parseInt(budget) || 10000;
    const remaining = basketData.stocks.filter(s => s.symbol !== symbol);
    const totalAlloc = remaining.reduce((sum, s) => sum + s.allocation, 0);
    const updated = remaining.map(s => {
      const newAlloc = +(s.allocation * (100 / totalAlloc)).toFixed(1);
      const dollarAmount = (newAlloc / 100) * bNum;
      const shares = s.price && s.price > 0 ? +(dollarAmount / s.price).toFixed(2) : 0;
      return { ...s, allocation: newAlloc, dollarAmount, shares };
    });
    const newTotal = updated.reduce((sum, s) => sum + s.allocation, 0);
    if (newTotal !== 100) {
      updated[0].allocation = +(updated[0].allocation + (100 - newTotal)).toFixed(1);
      updated[0].dollarAmount = (updated[0].allocation / 100) * bNum;
      updated[0].shares = updated[0].price && updated[0].price > 0
        ? +(updated[0].dollarAmount / updated[0].price).toFixed(2) : 0;
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
        const shares = st.price && st.price > 0 ? +(dollarAmount / st.price).toFixed(2) : 0;
        return { ...st, allocation: allocPer, dollarAmount, shares };
      });
      const newDollar = (allocPer / 100) * bNum;
      updated.push({
        symbol: s, name: s, allocation: allocPer,
        rationale: 'Manually added', price, dollarAmount: newDollar,
        shares: +(newDollar / price).toFixed(2),
      });
      const total = updated.reduce((sum, st) => sum + st.allocation, 0);
      if (total !== 100) {
        updated[0].allocation = +(updated[0].allocation + (100 - total)).toFixed(1);
        updated[0].dollarAmount = (updated[0].allocation / 100) * bNum;
        updated[0].shares = updated[0].price && updated[0].price > 0
          ? +(updated[0].dollarAmount / updated[0].price!).toFixed(2) : 0;
      }
      setBasketData({ ...basketData, stocks: updated });
      setAddStockSymbol(''); setShowAddStock(false);
    } catch (err: any) { setError(err?.message || `Failed to add ${s}`); }
    finally { setIsAddingStock(false); }
  }, [basketData, budget]);

  if (!isOpen) return null;

  const budgetNum = parseInt(budget) || 10000;
  const displayTheme = selectedCurated ? selectedCurated.name : (customName.trim() || 'Custom');

  // ── Navigate back ──
  const goBack = () => {
    if (step === 'custom_theme') setStep('curated');
    else if (step === 'budget') setStep(selectedCurated ? 'curated' : 'custom_theme');
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
          const shares = price > 0 ? +(dollarAmount / price).toFixed(2) : 0;
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
          s.shares = +(s.dollarAmount / s.price!).toFixed(2);
        });
        const totalAlloc = valid.reduce((sum, s) => sum + s.allocation, 0);
        if (totalAlloc !== 100) {
          const diff = 100 - totalAlloc;
          valid[0].allocation = +(valid[0].allocation + diff).toFixed(1);
          valid[0].dollarAmount = (valid[0].allocation / 100) * budgetNum;
          valid[0].shares = +(valid[0].dollarAmount / valid[0].price!).toFixed(2);
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
  const getPerfValue = (basket: CuratedBasket): number => {
    if (perfTimeframe === 'best') {
      const key = basket.performance?.best_timeframe || '1y';
      return basket.performance?.[key as keyof typeof basket.performance] as number || 0;
    }
    return 0;
  };

  const getDisplayPerf = (basket: CuratedBasket): { value: number; label: string } => {
    const best = basket.performance?.best_timeframe || '1y';
    const perf = basket.performance || {};
    if (perfTimeframe === 'best') {
      return { value: (perf as any)[best] || 0, label: best.toUpperCase() };
    }
    return { value: 0, label: best.toUpperCase() };
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

  // ── Header (context-aware) ──
  const header = (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 20px', background: '#0a0f1e',
      borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
    }}>
      <button onClick={onClose} style={{
        color: '#6b7280', fontSize: '24px', background: 'none',
        border: 'none', cursor: 'pointer', padding: '0 8px', lineHeight: 1,
      }}>×</button>
      <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '16px' }}>
        Build Basket {step === 'curated' ? '' : (
          <span style={{ color: '#22d3ee', fontSize: '12px', fontWeight: '400' }}>
            {step === 'custom_theme' ? 'Custom →' : step === 'budget' ? 'Budget →' : step === 'generating' ? 'Generating →' : 'Review →'}
          </span>
        )}
      </span>
      {step !== 'curated' && step !== 'generating' ? (
        <button onClick={goBack} style={{
          color: '#22d3ee', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer',
        }}>← Back</button>
      ) : <div style={{ width: '40px' }} />}
    </div>
  );

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
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontSize: '14px', fontWeight: '700',
                    color: isPositive ? '#34d399' : '#f87171',
                  }}>
                    {isPositive ? '+' : ''}{perf.value.toFixed(1)}%
                  </span>
                  <span style={{
                    display: 'block', fontSize: '10px',
                    color: isPositive ? '#34d399' : '#f87171',
                    opacity: 0.7,
                  }}>{perf.label}</span>
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
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

      <div style={{ padding: '12px 20px calc(16px + env(safe-area-inset-bottom)) 20px', flexShrink: 0 }}>
        <button
          onClick={() => setStep('budget')}
          disabled={!customName.trim()}
          style={{
            width: '100%', background: customName.trim() ? '#22d3ee' : 'rgba(34,211,238,0.2)',
            border: 'none', borderRadius: '10px', color: customName.trim() ? '#000000' : 'rgba(34,211,238,0.4)',
            fontSize: '14px', fontWeight: '600', padding: '14px 0',
            cursor: customName.trim() ? 'pointer' : 'not-allowed',
          }}
        >Continue →</button>
      </div>
    </>
  );

  // ────────────────────────────────────────────────────────────
  // STEP 2: BUDGET
  // ────────────────────────────────────────────────────────────
  const budgetStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {selectedCurated && (
          <div style={{
            background: '#1a2235', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px',
          }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Basket: </span>
            <span style={{ fontSize: '12px', color: '#ffffff' }}>{selectedCurated.emoji} {selectedCurated.name}</span>
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

      <div style={{ padding: '12px 20px calc(16px + env(safe-area-inset-bottom)) 20px', flexShrink: 0 }}>
        <button
          onClick={() => selectedCurated ? addCuratedToPortfolio() : generateBasket()}
          disabled={!budget || parseInt(budget) <= 0}
          style={{
            width: '100%',
            background: budget && parseInt(budget) > 0 ? '#22d3ee' : 'rgba(34,211,238,0.2)',
            border: 'none', borderRadius: '10px',
            color: budget && parseInt(budget) > 0 ? '#000000' : 'rgba(34,211,238,0.4)',
            fontSize: '14px', fontWeight: '600', padding: '14px 0',
            cursor: budget && parseInt(budget) > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          {selectedCurated ? 'Add to Portfolio' : 'Generate Basket →'}
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
              <div style={{ marginTop: '12px' }}>
                <input type="text" value={addStockSymbol}
                  onChange={e => setAddStockSymbol(e.target.value)}
                  placeholder="Enter ticker (e.g. AAPL)"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && addStockSymbol.trim()) addStock(addStockSymbol);
                    else if (e.key === 'Escape') { setShowAddStock(false); setAddStockSymbol(''); }
                  }} autoFocus disabled={isAddingStock}
                  style={{
                    width: '100%', background: '#1a2235', border: '1px solid rgba(34,211,238,0.3)',
                    borderRadius: '8px', padding: '10px 12px', color: '#ffffff', fontSize: '13px',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={() => { setShowAddStock(false); setAddStockSymbol(''); }} style={{
                    flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', padding: '8px 0', color: '#94a3b8', fontSize: '12px', cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={() => addStockSymbol.trim() && addStock(addStockSymbol)}
                    disabled={!addStockSymbol.trim() || isAddingStock}
                    style={{
                      flex: 1, background: addStockSymbol.trim() && !isAddingStock ? '#22d3ee' : 'rgba(34,211,238,0.2)',
                      border: 'none', borderRadius: '6px', padding: '8px 0',
                      color: addStockSymbol.trim() && !isAddingStock ? '#000' : 'rgba(34,211,238,0.4)',
                      fontSize: '12px', fontWeight: '600',
                      cursor: addStockSymbol.trim() && !isAddingStock ? 'pointer' : 'not-allowed',
                    }}
                  >{isAddingStock ? 'Fetching...' : 'Add'}</button>
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

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0f1e',
      zIndex: 99999, display: 'flex', flexDirection: 'column',
    }}>
      {header}
      {step === 'curated' && curatedStep}
      {step === 'custom_theme' && customThemeStep}
      {step === 'budget' && budgetStep}
      {step === 'generating' && generatingStep}
      {step === 'review' && reviewStep}

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
