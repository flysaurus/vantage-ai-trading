'use client';

import { useState, useMemo } from 'react';
import { useLivePortfolio } from '@/context/PortfolioContext';
import SellModal from '@/components/portfolio/SellModal';

// ─── Types ─────────────────────────────────────────────

interface BasketPositionData {
  symbol: string;
  name?: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  allocationPct: number;
  marketValue?: number;
  totalPnL?: number;
  totalPnLPct?: number;
  status?: string;
  sector?: string;
  /** Computed live weight from current market values (not stale localStorage) */
  liveAllocationPct?: number;
}

interface BasketActionPanelProps {
  basketId: string;
  basketName: string;
  basketEmoji: string;
  positions: BasketPositionData[];
  totalCost: number;
  marketValue: number;
  totalPnL: number;
  totalPnLPct: number;
  /** Where the panel is mounted — adjusts visual padding */
  context?: 'portfolio' | 'invest';
}

// ─── Helpers ─────────────────────────────────────────

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

// ─── Component ───────────────────────────────────────

export default function BasketActionPanel({
  basketId,
  basketName,
  basketEmoji,
  positions,
  totalCost,
  marketValue,
  totalPnL,
  totalPnLPct,
  context = 'portfolio',
}: BasketActionPanelProps) {
  const { account, executeTrade, executeBasketTrade, sellBasketPositions, loadBaskets } = useLivePortfolio();

  const plColor = totalPnL >= 0 ? '#10b981' : '#ef4444';
  const plSign = totalPnL >= 0 ? '+' : '';

  // ── State ──
  const [showBuyWholeInput, setShowBuyWholeInput] = useState(false);
  const [buyWholeAmount, setBuyWholeAmount] = useState('');
  const [buyWholeSubmitting, setBuyWholeSubmitting] = useState(false);

  const [buySingleSymbol, setBuySingleSymbol] = useState<string | null>(null);
  const [buySingleAmount, setBuySingleAmount] = useState('');
  const [buySingleSubmitting, setBuySingleSubmitting] = useState(false);

  const [sellPositions, setSellPositions] = useState<
    Array<{ symbol: string; qty: number; currentPrice: number }> | null
  >(null);
  const [sellSingleSymbol, setSellSingleSymbol] = useState<string | null>(null);

  // ── Derived ──
  const activePositions = useMemo(
    () => positions.filter(p => (p.status || 'active') === 'active'),
    [positions],
  );

  const hasActivePositions = activePositions.length > 0;

  // Current allocation % from live market values (NOT stale localStorage)
  const totalMarketValue = useMemo(() => {
    return activePositions.reduce((sum, p) => sum + (p.marketValue || p.currentPrice * p.shares || 0), 0);
  }, [activePositions]);

  const positionsWithLiveWeights = useMemo(() => {
    if (totalMarketValue <= 0) return activePositions;
    return activePositions.map(p => ({
      ...p,
      liveAllocationPct: ((p.marketValue || p.currentPrice * p.shares || 0) / totalMarketValue) * 100,
    }));
  }, [activePositions, totalMarketValue]);

  const availableCash = account?.cash ?? 0;

  // ── Handlers ──

  // Buy More — Whole Basket (proportional top-up at LIVE weights)
  const handleBuyWhole = async () => {
    const amount = parseFloat(buyWholeAmount);
    if (!amount || amount <= 0 || amount > 9999999) return;
    if (!hasActivePositions) return;

    // Cash validation — reject entire order if insufficient
    if (amount > availableCash) {
      // Visual feedback: flash the input red (will rely on inline message)
      return;
    }

    setBuyWholeSubmitting(true);
    const executedSymbols: string[] = [];
    try {
      for (const pos of positionsWithLiveWeights) {
        const posBudget = amount * ((pos.liveAllocationPct || 0) / 100);
        const price = pos.currentPrice || pos.avgCost;
        if (price <= 0 || posBudget <= 1) continue; // skip trivial amounts
        const shares = Math.round((posBudget / price) * 10000) / 10000;
        if (shares <= 0) continue;

        const result = await executeTrade(
          pos.symbol, 'BUY', shares, price,
          undefined, undefined, undefined, undefined,
          basketId, basketName, basketEmoji,
        );
        if (!result.success) {
          // Abort — already-executed positions will remain (no rollback)
          // but user sees a clear error and remaining positions are skipped
          throw new Error(result.error || `Failed to buy ${pos.symbol}`);
        }
        executedSymbols.push(pos.symbol);
      }
      await loadBaskets();
    } catch (e: any) {
      // Individual trade errors already surface via executeTrade's toast.
      // If we got a partial fill, the toast from executeTrade already fired
      // for each successful trade. The failed trade also fired its own error toast.
    }
    setBuyWholeSubmitting(false);
    setBuyWholeAmount('');
    setShowBuyWholeInput(false);
  };

  // Buy More — Single Stock
  const handleBuySingle = async (symbol: string) => {
    const amount = parseFloat(buySingleAmount);
    if (!amount || amount <= 0 || amount > 9999999) return;
    if (amount > availableCash) return;

    const pos = activePositions.find(p => p.symbol === symbol);
    if (!pos) return;

    setBuySingleSubmitting(true);
    try {
      const price = pos.currentPrice || pos.avgCost;
      const shares = Math.round((amount / price) * 10000) / 10000;
      if (shares > 0) {
        const result = await executeTrade(symbol, 'BUY', shares, price, undefined, undefined, undefined, undefined, basketId, basketName, basketEmoji);
        if (!result.success) {
          // Error already surfaced via executeTrade toast
          setBuySingleSubmitting(false);
          setBuySingleAmount('');
          setBuySingleSymbol(null);
          return;
        }
        await loadBaskets();
      }
    } catch { /* errors surfaced via toast */ }
    setBuySingleSubmitting(false);
    setBuySingleAmount('');
    setBuySingleSymbol(null);
  };

  // Sell — Single Stock (open SellModal)
  const handleSellSingle = (symbol: string) => {
    const pos = activePositions.find(p => p.symbol === symbol);
    if (!pos) return;
    setSellSingleSymbol(symbol);
    setSellPositions([
      { symbol: pos.symbol, qty: pos.shares, currentPrice: pos.currentPrice },
    ]);
  };

  // Sell — Whole Basket (open SellModal with proportional %)
  const handleSellWhole = () => {
    setSellSingleSymbol(null);
    setSellPositions(
      activePositions.map(p => ({
        symbol: p.symbol,
        qty: p.shares,
        currentPrice: p.currentPrice,
      })),
    );
  };

  // Sell confirmation
  const handleSellConfirm = async (percentSold?: number) => {
    if (!sellPositions || sellPositions.length === 0) {
      setSellPositions(null);
      return;
    }

    const symbolsToSell = sellPositions.map(p => p.symbol);
    const sellPct = (percentSold ?? 100) / 100;

    try {
      if (sellPct < 1 && sellPositions.length > 1) {
        // Proportional sell
        const sharesMap: Record<string, number> = {};
        sellPositions.forEach(p => {
          sharesMap[p.symbol] = Math.round(p.qty * sellPct * 10000) / 10000;
        });
        await sellBasketPositions(basketId, symbolsToSell, sharesMap);
      } else {
        await sellBasketPositions(basketId, symbolsToSell);
      }
    } catch { /* errors surfaced via toast */ }

    setSellPositions(null);
    setSellSingleSymbol(null);
    // Refresh baskets after sell updates localStorage
    setTimeout(() => loadBaskets(), 200);
  };

  // ── Render ──

  return (
    <div style={{
      borderTop: '1px solid rgba(255,255,255,0.06)',
      background: context === 'invest' ? 'transparent' : 'transparent',
    }}>
      {/* ─── Composition List ─── */}
      {activePositions.length > 0 && (
        <div style={{ padding: '8px 0' }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 10,
            padding: '4px 16px 8px',
          }}>
            <div>
              <div className="section-label" style={{ fontSize: 9, marginBottom: 2 }}>
                INVESTED
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff' }}>
                ${totalCost.toLocaleString('en-US', DOLLAR_FMT)}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 9, marginBottom: 2 }}>
                MARKET VALUE
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff' }}>
                ${marketValue.toLocaleString('en-US', DOLLAR_FMT)}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 9, marginBottom: 2 }}>
                TOTAL P&L
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: plColor }}>
                {plSign}${Math.abs(totalPnL).toLocaleString('en-US', DOLLAR_FMT)}
              </div>
            </div>
          </div>

          {/* Position rows */}
          <div style={{ padding: '0 16px' }}>
            {positionsWithLiveWeights.map((pos, i, arr) => {
              const posPl = pos.totalPnL || 0;
              const posPlClr = posPl >= 0 ? '#10b981' : '#ef4444';
              const posPlSgn = posPl >= 0 ? '+' : '';
              const mv = pos.marketValue || (pos.currentPrice * pos.shares);
              const isBuyingSingle = buySingleSymbol === pos.symbol;
              const weight = pos.liveAllocationPct || 0;

              return (
                <div key={pos.symbol}>
                  {/* Position row with inline action buttons */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}>
                    {/* Left: symbol info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 13 }}>
                          {pos.symbol}
                        </span>
                        {weight > 0 && (
                          <span style={{
                            color: '#64748b',
                            fontSize: 9,
                            fontWeight: 600,
                            background: 'rgba(100,116,139,0.15)',
                            padding: '1px 5px',
                            borderRadius: 4,
                          }}>
                            {weight.toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 1 }}>
                        {pos.shares.toFixed(4)}sh · avg ${pos.avgCost.toFixed(2)}
                      </div>
                    </div>

                    {/* Right: value + P&L + action buttons */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexShrink: 0,
                      marginLeft: 8,
                    }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 500 }}>
                          ${mv.toLocaleString('en-US', DOLLAR_FMT)}
                        </div>
                        <div style={{ color: posPlClr, fontSize: 10, fontWeight: 500 }}>
                          {posPlSgn}${Math.abs(posPl).toLocaleString('en-US', DOLLAR_FMT)}
                        </div>
                      </div>

                      {/* Buy More button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isBuyingSingle) {
                            setBuySingleSymbol(null);
                            setBuySingleAmount('');
                          } else {
                            setBuySingleSymbol(pos.symbol);
                            setBuySingleAmount('');
                            // Close buy-whole if open
                            setShowBuyWholeInput(false);
                            setBuyWholeAmount('');
                          }
                        }}
                        style={{
                          background: isBuyingSingle
                            ? 'rgba(16,185,129,0.15)'
                            : 'transparent',
                          border: isBuyingSingle
                            ? '1px solid rgba(16,185,129,0.3)'
                            : '1px solid rgba(16,185,129,0.15)',
                          borderRadius: 6,
                          color: isBuyingSingle ? '#10b981' : '#10b981',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '3px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        {isBuyingSingle ? '×' : '+Buy'}
                      </button>

                      {/* Sell button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSellSingle(pos.symbol);
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid rgba(239,68,68,0.15)',
                          borderRadius: 6,
                          color: '#ef4444',
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '3px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        -Sell
                      </button>
                    </div>
                  </div>

                  {/* Inline buy-single budget input */}
                  {isBuyingSingle && (
                    <div style={{
                      padding: '8px 0',
                      borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="number"
                          placeholder="$ amount"
                          value={buySingleAmount}
                          onChange={e => setBuySingleAmount(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleBuySingle(pos.symbol);
                          }}
                          autoFocus
                          style={{
                            flex: 1,
                            background: '#0f172a',
                            border: '1px solid rgba(16,185,129,0.2)',
                            borderRadius: 8,
                            padding: '8px 12px',
                            color: '#ffffff',
                            fontSize: 13,
                            outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => handleBuySingle(pos.symbol)}
                          disabled={buySingleSubmitting || !buySingleAmount || !!(buySingleAmount && parseFloat(buySingleAmount) > availableCash)}
                          style={{
                            padding: '8px 16px',
                            borderRadius: 8,
                            background: buySingleAmount
                              ? '#10b981'
                              : 'rgba(16,185,129,0.2)',
                            border: 'none',
                            color: buySingleAmount ? '#ffffff' : 'rgba(255,255,255,0.4)',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: buySingleAmount ? 'pointer' : 'default',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {buySingleSubmitting ? '…' : 'Buy'}
                        </button>
                      </div>
                      <div style={{
                        color: '#94a3b8',
                        fontSize: 10,
                        marginTop: 4,
                      }}>
                        {parseFloat(buySingleAmount || '0').toFixed(0) === '0'
                          ? ''
                          : (() => {
                              const amt = parseFloat(buySingleAmount || '0');
                              if (amt > availableCash) return <span style={{ color: '#ef4444' }}>⚠️ Not enough cash — have ${availableCash.toLocaleString('en-US', DOLLAR_FMT)}</span>;
                              return `~${(amt / (pos.currentPrice || 1)).toFixed(4)} shares @ $${pos.currentPrice.toFixed(2)}`;
                            })()
                        }
                        {!buySingleAmount && 'Buy more shares — increases this stock\'s weight in the basket'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Whole Basket Actions ─── */}
      {hasActivePositions && (
        <div style={{ padding: '10px 16px 12px' }}>
          {/* Buy Whole — toggle and input */}
          {showBuyWholeInput && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  placeholder="$ total budget"
                  value={buyWholeAmount}
                  onChange={e => setBuyWholeAmount(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleBuyWhole();
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    background: '#0f172a',
                    border: '1px solid rgba(16,185,129,0.2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    color: '#ffffff',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleBuyWhole}
                  disabled={buyWholeSubmitting || !buyWholeAmount || !!(buyWholeAmount && parseFloat(buyWholeAmount) > availableCash)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: buyWholeAmount
                      ? '#10b981'
                      : 'rgba(16,185,129,0.2)',
                    border: 'none',
                    color: buyWholeAmount ? '#ffffff' : 'rgba(255,255,255,0.4)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: buyWholeAmount ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {buyWholeSubmitting ? '…' : 'Buy All'}
                </button>
              </div>
              {/* Cash validation warning */}
              {buyWholeAmount && parseFloat(buyWholeAmount) > availableCash && (
                <div style={{
                  marginTop: 6,
                  color: '#ef4444',
                  fontSize: 10,
                  fontWeight: 600,
                  background: 'rgba(239,68,68,0.08)',
                  padding: '6px 8px',
                  borderRadius: 6,
                }}>
                  Not enough cash — have ${availableCash.toLocaleString('en-US', DOLLAR_FMT)}, need ${parseFloat(buyWholeAmount).toLocaleString('en-US', DOLLAR_FMT)}
                </div>
              )}

              {/* Proportional breakdown preview */}
              {buyWholeAmount && (() => {
                const amt = parseFloat(buyWholeAmount);
                if (!amt || amt <= 0) return null;
                // Don't show preview if cash insufficient
                if (amt > availableCash) return null;
                return (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ color: '#64748b', fontSize: 10, marginBottom: 4 }}>
                      Proportional split at current weights:
                    </div>
                    {positionsWithLiveWeights.map(pos => {
                      const allocation = pos.liveAllocationPct || 0;
                      const posBudget = amt * (allocation / 100);
                      const shares = Math.round((posBudget / (pos.currentPrice || pos.avgCost)) * 10000) / 10000;
                      return (
                        <div key={pos.symbol} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 10,
                          color: '#94a3b8',
                          padding: '1px 0',
                        }}>
                          <span>{pos.symbol} ({allocation.toFixed(0)}%)</span>
                          <span>
                            ${posBudget.toFixed(2)} · {shares.toFixed(4)}sh
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {!buyWholeAmount && (
                <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 4 }}>
                  New $ splits across holdings at current allocation %
                </div>
              )}
            </div>
          )}

          {/* Action buttons row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                setShowBuyWholeInput(!showBuyWholeInput);
                setBuyWholeAmount('');
                // Close per-stock buy if open
                setBuySingleSymbol(null);
                setBuySingleAmount('');
              }}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: 8,
                background: showBuyWholeInput
                  ? 'rgba(16,185,129,0.10)'
                  : 'rgba(16,185,129,0.06)',
                border: showBuyWholeInput
                  ? '1px solid rgba(16,185,129,0.25)'
                  : '1px solid rgba(16,185,129,0.12)',
                color: '#10b981',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {showBuyWholeInput ? 'Cancel' : 'Buy More'}
            </button>
            <button
              onClick={handleSellWhole}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: 8,
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.12)',
                color: '#ef4444',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sell
            </button>
          </div>
        </div>
      )}

      {/* ─── Empty state ─── */}
      {!hasActivePositions && (
        <div style={{
          padding: '16px',
          color: '#94a3b8',
          fontSize: 13,
          textAlign: 'center',
        }}>
          All positions in this basket have been sold
        </div>
      )}

      {/* ─── Sell Modal ─── */}
      {sellPositions && (
        <SellModal
          positions={sellPositions}
          showPercentOption={sellPositions.length > 1}
          onClose={() => {
            setSellPositions(null);
            setSellSingleSymbol(null);
          }}
          onConfirm={(percentSold?: number) => {
            handleSellConfirm(percentSold);
          }}
        />
      )}
    </div>
  );
}
