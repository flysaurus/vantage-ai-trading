'use client';

import { useState, useEffect, useCallback } from 'react';
import CompassIcon from '@/components/CompassIcon';
import { useAuth } from '@/components/providers/AuthProvider';

const THEMES = [
  { key: 'ai_tech', emoji: '🤖', name: 'AI & Tech' },
  { key: 'clean_energy', emoji: '🌱', name: 'Clean Energy' },
  { key: 'healthcare', emoji: '🏥', name: 'Healthcare' },
  { key: 'financials', emoji: '🏦', name: 'Financials' },
  { key: 'defense', emoji: '🛡️', name: 'Defense' },
  { key: 'consumer', emoji: '🛒', name: 'Consumer' },
  { key: 'infrastructure', emoji: '🏗️', name: 'Infrastructure' },
  { key: 'emerging', emoji: '🌍', name: 'Emerging Markets' },
  { key: 'custom', emoji: '✏️', name: 'Custom' },
];

type Step = 'theme' | 'budget' | 'generating' | 'review';

interface BasketStock {
  symbol: string;
  name: string;
  allocation: number;
  rationale: string;
  shares?: number;
  price?: number;
  dollarAmount?: number;
}

interface BasketData {
  theme: string;
  rationale: string;
  stocks: BasketStock[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBasketGenerated: (msg: string, data: any) => void;
}

export default function BuildBasketModal({ isOpen, onClose, onBasketGenerated }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('theme');
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [budget, setBudget] = useState('');
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [basketData, setBasketData] = useState<BasketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeFlash, setRemoveFlash] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setStep('theme');
      setSelectedTheme(null);
      setBudget('');
      setCustomName('');
      setCustomDesc('');
      setBasketData(null);
      setError(null);
      setAddStockSymbol('');
      setShowAddStock(false);
    }
  }, [isOpen]);

  // ── Remove stock from basket (must be above early return for hook ordering) ──
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
        ? +(updated[0].dollarAmount / updated[0].price).toFixed(2)
        : 0;
    }
    setBasketData({ ...basketData, stocks: updated });
    setRemoveFlash(true);
    setTimeout(() => setRemoveFlash(false), 1500);
  }, [basketData, budget]);

  if (!isOpen) return null;

  const themeData = THEMES.find(t => t.key === selectedTheme);
  const displayTheme = customName.trim() || themeData?.name || 'Custom';
  const budgetNum = parseInt(budget) || 10000;

  // ── API: Generate basket ──
  async function generateBasket() {
    if (!selectedTheme) return;
    setIsGenerating(true);
    setError(null);
    setStep('generating');

    try {
      const res = await fetch('/api/basket/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: displayTheme,
          budget: budgetNum,
          investorStyle: user?.investorStyle || 'Lynch',
          riskTolerance: user?.riskTolerance || 'Moderate',
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to generate');
      }

      const data: BasketData = await res.json();

      // Fetch live prices from Finnhub
      const stocksWithPrices = await Promise.all(
        data.stocks.map(async (stock) => {
          try {
            const qRes = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(stock.symbol)}`);
            const qData = await qRes.json();
            const price = qData?.c || 0;
            const dollarAmount = (stock.allocation / 100) * budgetNum;
            const shares = price > 0 ? +(dollarAmount / price).toFixed(2) : 0;
            return { ...stock, price, dollarAmount, shares };
          } catch {
            return { ...stock, price: 0, dollarAmount: 0, shares: 0 };
          }
        })
      );

      // Filter out stocks with no price, redistribute
      const valid = stocksWithPrices.filter(s => s.price > 0);
      const invalidAlloc = stocksWithPrices
        .filter(s => s.price <= 0)
        .reduce((sum, s) => sum + s.allocation, 0);

      if (valid.length > 0 && invalidAlloc > 0) {
        const redistPer = invalidAlloc / valid.length;
        valid.forEach(s => {
          s.allocation = +(s.allocation + redistPer).toFixed(1);
          s.dollarAmount = (s.allocation / 100) * budgetNum;
          s.shares = +(s.dollarAmount / s.price!).toFixed(2);
        });
        // Normalize to 100
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
      setStep('review'); // go to review so they see error state
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Add to portfolio ──
  async function addToPortfolio() {
    if (!basketData) return;
    const msg = `Add ${basketData.theme} basket (${basketData.stocks.length} stocks, $${budgetNum.toLocaleString()}) to my portfolio`;
    onClose();
    onBasketGenerated(msg, basketData);
  }

  // ── State for Add Stock input ──
  const [addStockSymbol, setAddStockSymbol] = useState('');
  const [showAddStock, setShowAddStock] = useState(false);
  const [isAddingStock, setIsAddingStock] = useState(false);

  // ── Add stock to existing basket ──
  const addStock = useCallback(async (symbol: string) => {
    if (!basketData || !symbol.trim() || basketData.stocks.length >= 8) return;
    const s = symbol.trim().toUpperCase();
    if (basketData.stocks.find(st => st.symbol === s)) return; // already in basket
    setIsAddingStock(true);
    try {
      const qRes = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(s)}`);
      const qData = await qRes.json();
      const price = qData?.c || 0;
      if (price <= 0) {
        setError(`Could not fetch price for ${s}`);
        return;
      }
      const bNum = parseInt(budget) || 10000;
      // Give new stock equal split, redistribute all
      const newCount = basketData.stocks.length + 1;
      const allocPer = +(100 / newCount).toFixed(1);
      const updated = basketData.stocks.map(st => {
        const dollarAmount = (allocPer / 100) * bNum;
        const shares = st.price && st.price > 0 ? +(dollarAmount / st.price).toFixed(2) : 0;
        return { ...st, allocation: allocPer, dollarAmount, shares };
      });
      const newDollar = (allocPer / 100) * bNum;
      const newShares = +(newDollar / price).toFixed(2);
      updated.push({
        symbol: s,
        name: s, // will be replaced by profile lookup below
        allocation: allocPer,
        rationale: 'Manually added',
        price,
        dollarAmount: newDollar,
        shares: newShares,
      });
      // Normalize to 100
      const total = updated.reduce((sum, st) => sum + st.allocation, 0);
      if (total !== 100) {
        updated[0].allocation = +(updated[0].allocation + (100 - total)).toFixed(1);
        updated[0].dollarAmount = (updated[0].allocation / 100) * bNum;
        updated[0].shares = updated[0].price && updated[0].price > 0
          ? +(updated[0].dollarAmount / updated[0].price!).toFixed(2) : 0;
      }
      setBasketData({ ...basketData, stocks: updated });
      setAddStockSymbol('');
      setShowAddStock(false);
    } catch (err: any) {
      setError(err?.message || `Failed to add ${s}`);
    } finally {
      setIsAddingStock(false);
    }
  }, [basketData, budget]);

  // ── Header ──
  const header = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 20px',
      background: '#0a0f1e',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      flexShrink: 0,
    }}>
      <button
        onClick={onClose}
        style={{
          color: '#6b7280',
          fontSize: '24px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 8px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
      <span style={{
        color: '#ffffff',
        fontWeight: '600',
        fontSize: '16px',
      }}>
        Build Basket
      </span>
      {step !== 'theme' && step !== 'generating' ? (
        <button
          onClick={() => {
            if (step === 'budget') setStep('theme');
            else if (step === 'review') setStep('budget');
          }}
          style={{
            color: '#22d3ee',
            fontSize: '14px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      ) : (
        <div style={{ width: '40px' }} />
      )}
    </div>
  );

  // ── Step 1: Theme Selection ──
  const themeStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
          What do you want to invest in?
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '10px',
        }}>
          {THEMES.map(theme => (
            <button
              key={theme.key}
              onClick={() => {
                setSelectedTheme(theme.key);
                if (theme.key === 'custom') {
                  setStep('budget');
                } else {
                  setStep('budget');
                }
              }}
              style={{
                background: selectedTheme === theme.key
                  ? 'rgba(34,211,238,0.08)'
                  : '#1a2235',
                border: selectedTheme === theme.key
                  ? '1px solid #22d3ee'
                  : '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px',
                padding: '12px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '24px' }}>{theme.emoji}</span>
              <span style={{ fontSize: '11px', color: '#e2e8f0', textAlign: 'center' }}>
                {theme.name}
              </span>
            </button>
          ))}
        </div>

        {selectedTheme === 'custom' && (
          <div style={{ marginTop: '12px' }}>
            <input
              type="text"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="Describe your basket theme..."
              autoFocus
              style={{
                width: '100%',
                background: '#1a2235',
                border: '1px solid #22d3ee',
                borderRadius: '10px',
                padding: '12px',
                color: '#ffffff',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* Continue button */}
      <div style={{
        padding: '12px 20px calc(16px + env(safe-area-inset-bottom)) 20px',
        flexShrink: 0,
      }}>
        <button
          onClick={() => {
            if (selectedTheme === 'custom') {
              setSelectedTheme(customName.trim() ? 'custom' : null);
            }
            setStep('budget');
          }}
          disabled={!selectedTheme || (selectedTheme === 'custom' && !customName.trim())}
          style={{
            width: '100%',
            background: selectedTheme && (selectedTheme !== 'custom' || customName.trim())
              ? '#22d3ee'
              : 'rgba(34,211,238,0.2)',
            border: 'none',
            borderRadius: '10px',
            color: selectedTheme && (selectedTheme !== 'custom' || customName.trim())
              ? '#000000'
              : 'rgba(34,211,238,0.4)',
            fontSize: '14px',
            fontWeight: '600',
            padding: '14px 0',
            cursor: selectedTheme && (selectedTheme !== 'custom' || customName.trim())
              ? 'pointer'
              : 'not-allowed',
          }}
        >
          Continue →
        </button>
      </div>
    </>
  );

  // ── Step 2: Budget ──
  const budgetStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
          How much do you want to invest?
        </p>

        {/* Large dollar input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
          padding: '8px 0',
          borderBottom: '1px solid #22d3ee',
        }}>
          <span style={{ fontSize: '28px', color: '#64748b', fontWeight: '300', marginRight: '4px' }}>
            $
          </span>
          <input
            type="number"
            value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            autoFocus
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: '28px',
              fontWeight: '700',
              width: '120px',
              textAlign: 'center',
              outline: 'none',
            }}
          />
        </div>

        {/* Quick-select pills */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          justifyContent: 'center',
          marginBottom: '24px',
        }}>
          {[1000, 5000, 10000, 25000].map(amt => (
            <button
              key={amt}
              onClick={() => setBudget(String(amt))}
              style={{
                background: budget === String(amt) ? 'rgba(34,211,238,0.1)' : 'transparent',
                border: budget === String(amt) ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.2)',
                borderRadius: '20px',
                padding: '8px 16px',
                color: budget === String(amt) ? '#22d3ee' : '#94a3b8',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              ${amt.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <div style={{
        padding: '12px 20px calc(16px + env(safe-area-inset-bottom)) 20px',
        flexShrink: 0,
      }}>
        <button
          onClick={generateBasket}
          disabled={!budget || parseInt(budget) <= 0}
          style={{
            width: '100%',
            background: budget && parseInt(budget) > 0 ? '#22d3ee' : 'rgba(34,211,238,0.2)',
            border: 'none',
            borderRadius: '10px',
            color: budget && parseInt(budget) > 0 ? '#000000' : 'rgba(34,211,238,0.4)',
            fontSize: '14px',
            fontWeight: '600',
            padding: '14px 0',
            cursor: budget && parseInt(budget) > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          Generate Basket →
        </button>
      </div>
    </>
  );

  // ── Step 3: AI Generating ──
  const generatingStep = (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px',
      gap: '16px',
    }}>
      <CompassIcon size={64} color="#22d3ee" animated={true} />
      <p style={{ fontSize: '16px', fontWeight: '600', color: '#ffffff', textAlign: 'center' }}>
        Vantage AI is building your basket...
      </p>
      <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center' }}>
        Selecting top stocks for {displayTheme}
      </p>
      <span style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: '#22d3ee',
        animation: 'pulse 1.2s ease-in-out infinite',
        marginTop: '8px',
      }} />
    </div>
  );

  // ── Step 4: Review Basket ──
  const reviewStep = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {error ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p style={{ fontSize: '14px', color: '#ef4444', marginBottom: '12px' }}>
              {error}
            </p>
            <button
              onClick={generateBasket}
              style={{
                background: '#22d3ee',
                border: 'none',
                borderRadius: '10px',
                color: '#000000',
                fontSize: '14px',
                fontWeight: '600',
                padding: '12px 24px',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        ) : basketData ? (
          <>
            {/* Header info */}
            <p style={{ fontSize: '14px', fontWeight: '600', color: '#ffffff', marginBottom: '4px' }}>
              {basketData.theme} Basket · ${budgetNum.toLocaleString()}
            </p>
            <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.5', marginBottom: '16px' }}>
              {basketData.rationale}
            </p>

            {/* Allocation adjusted flash */}
            {removeFlash && (
              <p style={{
                fontSize: '11px',
                color: '#94a3b8',
                textAlign: 'center',
                marginBottom: '8px',
                transition: 'opacity 0.3s',
              }}>
                Allocation adjusted
              </p>
            )}

            {/* Stock rows */}
            {basketData.stocks.map((stock, i) => (
              <div key={stock.symbol}>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Line 1: Ticker + Name + allocation */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      marginBottom: '2px',
                    }}>
                      <div>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>
                          {stock.symbol}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px' }}>
                          {stock.name}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: '#22d3ee', fontWeight: '500' }}>
                          {stock.allocation}%
                        </span>
                        <span style={{ fontSize: '12px', color: '#ffffff', fontWeight: '500' }}>
                          ${(stock.dollarAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                        {/* Remove button */}
                        {basketData.stocks.length > 2 && (
                          <button
                            onClick={() => removeStock(stock.symbol)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              fontSize: '16px',
                              cursor: 'pointer',
                              padding: '0 4px',
                              lineHeight: 1,
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Line 2: Shares + price */}
                    <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                      {stock.shares} shares @ ${(stock.price || 0).toFixed(2)}
                    </p>
                    {/* Line 3: Rationale */}
                    {stock.rationale && (
                      <p style={{
                        fontSize: '11px',
                        color: '#64748b',
                        fontStyle: 'italic',
                        margin: '2px 0 0 0',
                        lineHeight: '1.4',
                      }}>
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

            {/* Total row */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '12px 0',
              marginTop: '8px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>Total</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>
                ${basketData.stocks.reduce((sum, s) => sum + (s.dollarAmount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>

            {/* Add Stock section */}
            {!showAddStock ? (
              <button
                onClick={() => setShowAddStock(true)}
                disabled={basketData.stocks.length >= 8}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px dashed rgba(34,211,238,0.3)',
                  borderRadius: '8px',
                  color: basketData.stocks.length >= 8 ? '#4b5563' : '#22d3ee',
                  background: 'none',
                  cursor: basketData.stocks.length >= 8 ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  marginTop: '12px',
                }}
              >
                + Add Stock
              </button>
            ) : (
              <div style={{ marginTop: '12px' }}>
                <input
                  type="text"
                  value={addStockSymbol}
                  onChange={e => setAddStockSymbol(e.target.value)}
                  placeholder="Enter ticker (e.g. AAPL)"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && addStockSymbol.trim()) {
                      addStock(addStockSymbol);
                    } else if (e.key === 'Escape') {
                      setShowAddStock(false);
                      setAddStockSymbol('');
                    }
                  }}
                  autoFocus
                  disabled={isAddingStock}
                  style={{
                    width: '100%',
                    background: '#1a2235',
                    border: '1px solid rgba(34,211,238,0.3)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  marginTop: '8px',
                }}>
                  <button
                    onClick={() => {
                      setShowAddStock(false);
                      setAddStockSymbol('');
                    }}
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      padding: '8px 0',
                      color: '#94a3b8',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => addStockSymbol.trim() && addStock(addStockSymbol)}
                    disabled={!addStockSymbol.trim() || isAddingStock}
                    style={{
                      flex: 1,
                      background: addStockSymbol.trim() && !isAddingStock ? '#22d3ee' : 'rgba(34,211,238,0.2)',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 0',
                      color: addStockSymbol.trim() && !isAddingStock ? '#000000' : 'rgba(34,211,238,0.4)',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: addStockSymbol.trim() && !isAddingStock ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {isAddingStock ? 'Fetching...' : 'Add'}
                  </button>
                </div>
              </div>
            )}
            {error && (
              <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px' }}>{error}</p>
            )}
          </>
        ) : (
          <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '24px 0' }}>
            No basket data available
          </p>
        )}
      </div>

      {/* Bottom buttons */}
      <div style={{
        padding: '12px 20px calc(16px + env(safe-area-inset-bottom)) 20px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <button
          onClick={addToPortfolio}
          disabled={!basketData}
          style={{
            width: '100%',
            background: basketData ? '#22d3ee' : 'rgba(34,211,238,0.2)',
            border: 'none',
            borderRadius: '10px',
            color: basketData ? '#000000' : 'rgba(34,211,238,0.4)',
            fontSize: '14px',
            fontWeight: '600',
            padding: '14px 0',
            cursor: basketData ? 'pointer' : 'not-allowed',
          }}
        >
          Add to Portfolio
        </button>
        <button
          onClick={generateBasket}
          disabled={!selectedTheme}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid #22d3ee',
            borderRadius: '10px',
            color: '#22d3ee',
            fontSize: '14px',
            fontWeight: '500',
            padding: '14px 0',
            cursor: 'pointer',
          }}
        >
          Regenerate
        </button>
      </div>
    </>
  );

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#0a0f1e',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {header}

      {step === 'theme' && themeStep}
      {step === 'budget' && budgetStep}
      {step === 'generating' && generatingStep}
      {step === 'review' && reviewStep}

      {/* Pulse animation keyframe */}
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
