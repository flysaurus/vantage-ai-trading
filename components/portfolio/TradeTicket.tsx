// ─── Trade Ticket Modal ─────────────────────────────────────
// Used for "Buy More" and "Sell" from position detail cards.
// Supports Market and Limit order types.
// Delegates execution to PortfolioContext.executeTrade().
// Does NOT contain trading logic — DemoBroker handles that.

'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getMarketStatus } from '@/lib/market-hours';
import { useAccounts } from '@/context/AccountContext';
import { X } from 'lucide-react';

export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

export const TIF_LABELS: Record<TimeInForce, { label: string; desc: string }> = {
  day:  { label: 'Day',   desc: 'Expires at market close if not filled' },
  gtc:  { label: 'GTC',   desc: 'Good-til-cancelled — stays open until filled or cancelled' },
  ioc:  { label: 'IOC',   desc: 'Immediate-or-cancel — fill any part now, cancel the rest' },
  fok:  { label: 'FOK',   desc: 'Fill-or-kill — all shares must fill immediately or cancel' },
};

interface TradeTicketProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  side: 'BUY' | 'SELL';
  currentPrice: number;
  sharesHeld: number;
  availableCash: number;
  /** Pre-populated share count (e.g. from AI chat "buy 10 shares") */
  initialShares?: number;
  /** Pre-populated dollar amount (e.g. from AI chat "buy $120") */
  initialAmount?: number;
  /** 'manual' = Portfolio "Buy More" (full order controls). 'ai' = AI Advisor (dollar-first, market only). */
  variant?: 'manual' | 'ai';
  /** Whether the broker supports fractional shares for this symbol */
  supportsFractional?: boolean;
  onConfirm: (params: {
    shares: number;
    type: 'market' | 'limit' | 'stop' | 'stop_limit';
    limitPrice?: number;
    stopPrice?: number;
    timeInForce?: TimeInForce;
  }) => Promise<void>;
}

export default function TradeTicket({
  isOpen, onClose, symbol, side, currentPrice,
  sharesHeld, availableCash, initialShares, initialAmount,
  variant = 'manual', supportsFractional = false, onConfirm,
}: TradeTicketProps) {
  const { activeAccount } = useAccounts();
  const isReadOnlyBroker = activeAccount && !activeAccount.isDemo && !activeAccount.tradingEnabled;
  console.log('[TradeTicket] render', { isOpen, symbol, side, currentPrice, availableCash, initialShares, initialAmount, variant, supportsFractional });
  
  const isAIVariant = variant === 'ai';
  
  // ── AI variant: always dollar-first, editable amount, derived shares ──
  // ── Manual variant: smart detection from initialAmount/initialShares ──
  const forceDollarMode = isAIVariant || !!(initialAmount && initialAmount > 0);
  const isLockedInput = !isAIVariant && (!!(initialAmount && initialAmount > 0) || !!(initialShares && initialShares > 0));
  
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop' | 'stop_limit'>('market');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('day');
  
  const [quantity, setQuantity] = useState<string>(() => {
    if (initialAmount && initialAmount > 0) return String(initialAmount);
    if (isAIVariant && initialShares && initialShares > 0) {
      return currentPrice > 0 ? String(Math.round(initialShares * currentPrice)) : String(initialShares);
    }
    return initialShares && initialShares > 0 ? String(initialShares) : '';
  });
  
  // ── Advanced order options (collapsed in AI variant) ──
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(true);
  const [nextOpenLabel, setNextOpenLabel] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    // Lock body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const ms = getMarketStatus();
    setMarketOpen(ms.isOpen);
    setNextOpenLabel(ms.nextOpenLabel);
    // Reset state
    setOrderType('market');
    setTimeInForce('day');
    setShowAdvanced(false);
    if (isAIVariant) {
      const amt = initialAmount && initialAmount > 0 ? String(initialAmount) : '';
      setQuantity(amt);
    } else {
      setQuantity(forceDollarMode ? String(initialAmount) : (initialShares && initialShares > 0 ? String(initialShares) : ''));
    }
    setLimitPrice('');
    setStopPrice('');
    setSubmitting(false);
    setConfirmed(false);
    setTradeError(null);
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const rawInput = parseFloat(quantity) || 0;
  const limit = parseFloat(limitPrice) || 0;
  const stop = parseFloat(stopPrice) || 0;
  const effectivePrice = (orderType === 'limit' || orderType === 'stop_limit') && limit > 0
    ? limit : currentPrice;
  
  // ── Share computation with fractional awareness ──
  const rawShares = forceDollarMode && effectivePrice > 0
    ? rawInput / effectivePrice
    : rawInput;
  // When fractional NOT supported, round to nearest whole share
  const qty = (!forceDollarMode || supportsFractional) ? rawShares : Math.round(rawShares);
  // True dollar amount (what will actually be spent)
  const dollarAmount = forceDollarMode ? qty * effectivePrice : rawInput * effectivePrice;
  const estimatedTotal = dollarAmount;
  
  // ── Fractional warning ──
  const fractionalGap = !supportsFractional && forceDollarMode && rawInput > 0 && effectivePrice > 0;
  const fractionalDiff = fractionalGap ? Math.abs(rawInput - estimatedTotal) : 0;
  const fractionalDiffPct = fractionalGap && rawInput > 0 ? (fractionalDiff / rawInput) * 100 : 0;
  const showLargeFractionalWarning = fractionalGap && fractionalDiffPct > 20;

  // Validation
  const isValidQty = qty > 0 && Number.isFinite(qty);
  const hasStop = orderType === 'stop' || orderType === 'stop_limit';
  const hasLimit = orderType === 'limit' || orderType === 'stop_limit';
  const isValidStopPrice = !hasStop || (stop > 0 && Number.isFinite(stop));
  const isValidLimitPrice = !hasLimit || (limit > 0 && Number.isFinite(limit));
  const pricesValid = isValidStopPrice && isValidLimitPrice;
  const canAfford = side === 'SELL' || (forceDollarMode ? estimatedTotal <= availableCash : estimatedTotal <= availableCash);
  const hasEnoughShares = side === 'BUY' || Math.floor(rawShares) <= sharesHeld;
  const canSubmit = isValidQty && pricesValid && canAfford && hasEnoughShares;
  const canClick = canSubmit && !submitting && !confirmed && !isReadOnlyBroker;

  const setMax = useCallback(() => {
    if (forceDollarMode || isAIVariant) {
      setQuantity(availableCash.toFixed(2));
    } else if (side === 'SELL') {
      setQuantity(sharesHeld.toString());
    } else {
      const max = Math.floor(availableCash / effectivePrice);
      setQuantity(max > 0 ? max.toString() : '');
    }
  }, [side, sharesHeld, availableCash, effectivePrice, forceDollarMode, isAIVariant]);

  const handleConfirm = useCallback(async () => {
    if (!canClick) return;
    setSubmitting(true);
    try {
      await onConfirm({
        shares: supportsFractional ? rawShares : qty,
        type: orderType,
        limitPrice: (orderType === 'limit' || orderType === 'stop_limit') && limit > 0 ? limit : undefined,
        stopPrice: (orderType === 'stop' || orderType === 'stop_limit') && stop > 0 ? stop : undefined,
        timeInForce,
      });
      // Success — confirmed state, then close
      setTradeError(null);
      setConfirmed(true);
      setSubmitting(false);
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      // Submission failed — reactivate button immediately and show error
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : 'Order submission failed';
      setTradeError(msg);
    }
  }, [canClick, qty, rawShares, supportsFractional, orderType, limit, stop, timeInForce, onConfirm, onClose]);

  if (!isOpen) return null;

  const sideColor = side === 'BUY' ? '#10b981' : '#ef4444';
  const sideLabel = side === 'BUY' ? 'Buy' : 'Sell';

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 420, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#0f172a',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '20px 20px 0 0',
      }} onClick={(e) => e.stopPropagation()}>
        
        {/* Scrollable body */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '24px 20px 0',
          WebkitOverflowScrolling: 'touch',
        }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `${sideColor}22`, border: `1px solid ${sideColor}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, color: sideColor,
            }}>
              {side === 'BUY' ? 'B' : 'S'}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                {sideLabel} {symbol}
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', fontFamily: 'var(--font-mono, monospace)' }}>
                ${currentPrice.toFixed(2)}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8,
            border: 'none', background: 'rgba(255,255,255,0.05)',
            color: '#94a3b8', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Order type — hidden in AI variant (Market only), except via Advanced */}
        {!isAIVariant && (
          <>
            <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>Order Type</div>
            <div style={{
              display: 'flex', background: 'rgba(255,255,255,0.04)',
              borderRadius: 10, padding: 3, marginBottom: 16,
            }}>
          {(['market', 'limit', 'stop', 'stop_limit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              style={{
                flex: 1, padding: '10px 0',
                border: 'none', borderRadius: 8,
                background: orderType === t ? 'rgba(34,211,238,0.15)' : 'transparent',
                color: orderType === t ? '#22d3ee' : '#94a3b8',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {t === 'market' ? 'Market' : t === 'limit' ? 'Limit' : t === 'stop' ? 'Stop' : 'StopLimit'}
            </button>
          ))}
        </div>
          </>
        )}

        {/* Time in Force — hidden in AI variant */}
        {!isAIVariant && (
          <>
        <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>Time in Force</div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px',
          marginBottom: 16,
        }}>
          {(Object.entries(TIF_LABELS) as [TimeInForce, { label: string; desc: string }][]) .map(([tif, { label, desc }]) => (
            <button
              key={tif}
              onClick={() => setTimeInForce(tif)}
              title={desc}
              style={{
                padding: '8px 4px',
                border: timeInForce === tif
                  ? '1px solid rgba(34,211,238,0.4)'
                  : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                background: timeInForce === tif
                  ? 'rgba(34,211,238,0.12)'
                  : 'rgba(255,255,255,0.02)',
                color: timeInForce === tif ? '#22d3ee' : 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
          </>
        )}

        {/* AI variant: Advanced order options disclosure */}
        {isAIVariant && (
          <div style={{ marginBottom: 14 }}>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                background: 'none', border: 'none',
                fontSize: 11, fontWeight: 600, color: '#64748b',
                cursor: 'pointer', padding: 0,
                display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              {showAdvanced ? '▾' : '▸'} Advanced order options
            </button>
            {showAdvanced && (
              <div style={{ marginTop: 10, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                {/* Order type */}
                <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>Order Type</div>
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, marginBottom: 10 }}>
                  {(['market', 'limit', 'stop', 'stop_limit'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setOrderType(t)}
                      style={{
                        flex: 1, padding: '8px 0',
                        border: 'none', borderRadius: 8,
                        background: orderType === t ? 'rgba(34,211,238,0.15)' : 'transparent',
                        color: orderType === t ? '#22d3ee' : '#94a3b8',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {t === 'market' ? 'Market' : t === 'limit' ? 'Limit' : t === 'stop' ? 'Stop' : 'StopLimit'}
                    </button>
                  ))}
                </div>
                {/* TIF */}
                <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>Time in Force</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  {(Object.entries(TIF_LABELS) as [TimeInForce, { label: string; desc: string }][]) .map(([tif, { label, desc }]) => (
                    <button
                      key={tif}
                      onClick={() => setTimeInForce(tif)}
                      title={desc}
                      style={{
                        padding: '6px 2px',
                        border: timeInForce === tif ? '1px solid rgba(34,211,238,0.4)' : '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 8,
                        background: timeInForce === tif ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.02)',
                        color: timeInForce === tif ? '#22d3ee' : 'rgba(255,255,255,0.5)',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quantity / Dollar Amount */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="section-label" style={{ fontSize: 10 }}>
            {isAIVariant ? 'Amount ($)' : (forceDollarMode ? 'Amount ($)' : 'Quantity')}
            {isAIVariant && <span style={{ fontSize: 9, color: '#22d3ee', marginLeft: 6, fontWeight: 500 }}>— from AI</span>}
            {!isAIVariant && isLockedInput && <span style={{ fontSize: 9, color: '#22d3ee', marginLeft: 6, fontWeight: 500 }}>— from AI</span>}
          </div>
          {(!isLockedInput || isAIVariant) && (
            <button onClick={setMax} style={{
              background: 'none', border: 'none',
              fontSize: 11, fontWeight: 700, color: '#22d3ee',
              cursor: 'pointer', padding: 0,
            }}>
              Max
            </button>
          )}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {forceDollarMode && (
          <span style={{
            position: 'absolute', left: 14,
            fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.4)',
            fontFamily: 'var(--font-mono, monospace)', pointerEvents: 'none',
            transform: 'translateY(-50%)', top: '50%',
          }}>$</span>
        )}
        <input
          type="number"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
          min="0"
          readOnly={!isAIVariant && isLockedInput}
          style={{
            width: '100%', padding: '12px 14px',
            background: (isAIVariant || isLockedInput) ? 'rgba(34,211,238,0.06)' : 'rgba(255,255,255,0.04)',
            border: (isAIVariant || isLockedInput) ? '1px solid rgba(34,211,238,0.2)' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, fontSize: 18, fontWeight: 600,
            color: isAIVariant ? '#ffffff' : (isLockedInput ? '#22d3ee' : '#ffffff'),
            fontFamily: 'var(--font-mono, monospace)',
            outline: 'none', marginBottom: 4,
            cursor: (!isAIVariant && isLockedInput) ? 'default' : 'text',
          }}
        />
        </div>
        <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 14 }}>
          {side === 'SELL'
            ? `${sharesHeld} shares held`
            : isAIVariant && rawInput > 0
              ? `≈ ${rawShares.toFixed(4)} shares at $${currentPrice.toFixed(2)} each`
              : forceDollarMode
                ? `≈ ${qty} shares at $${currentPrice.toFixed(2)} each`
                : `≈ $${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at market price`}
        </div>

        {/* ── Fractional warning for whole-share-only stocks ── */}
        {showLargeFractionalWarning && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: 10,
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>⚠️ Whole shares only</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: '1.5' }}>
              Fractional shares aren&apos;t available for {symbol}. The AI recommended ${rawInput.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}, but 1 share costs ${currentPrice.toFixed(2)} ({fractionalDiffPct.toFixed(0)}% more than suggested).
            </div>
          </div>
        )}
        {fractionalGap && !showLargeFractionalWarning && dollarAmount > rawInput && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(34,211,238,0.06)',
            border: '1px solid rgba(34,211,238,0.15)',
            borderRadius: 10,
            marginBottom: 14,
            fontSize: 11, color: '#22d3ee',
          }}>
            Adjusted to ${dollarAmount.toFixed(2)} for 1 whole share.
          </div>
        )}

        {/* Stop price */}
        {(orderType === 'stop' || orderType === 'stop_limit') && (
          <>
            <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>Stop Price</div>
            <input
              type="number"
              inputMode="decimal"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              placeholder={currentPrice.toFixed(2)}
              min="0"
              step="0.01"
              style={{
                width: '100%', padding: '12px 14px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, fontSize: 18, fontWeight: 600,
                color: '#ffffff', fontFamily: 'var(--font-mono, monospace)',
                outline: 'none', marginBottom: 14,
              }}
            />
          </>
        )}

        {/* Limit price (limit and stop-limit types) */}
        {(orderType === 'limit' || orderType === 'stop_limit') && (
          <>
            <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>
              {orderType === 'stop_limit' ? 'Limit Price' : 'Limit Price'}
            </div>
            <input
              type="number"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={currentPrice.toFixed(2)}
              min="0"
              step="0.01"
              style={{
                width: '100%', padding: '12px 14px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, fontSize: 18, fontWeight: 600,
                color: '#ffffff', fontFamily: 'var(--font-mono, monospace)',
                outline: 'none', marginBottom: 14,
              }}
            />
          </>
        )}

        {/* Divider */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: 14 }} />

        {/* Cost summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {orderType === 'limit' && limit > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: '#cbd5e1' }}>
                {side === 'BUY' ? 'Limit price' : 'Limit price'}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-mono, monospace)' }}>
                ${limit.toFixed(2)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>
              {side === 'BUY' ? 'Est. cost' : 'Est. proceeds'}
            </span>
            <span style={{
              fontSize: 14, fontWeight: 700,
              color: side === 'BUY' && estimatedTotal > availableCash ? '#ef4444' : '#ffffff',
              fontFamily: 'var(--font-mono, monospace)',
            }}>
              ${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          {side === 'BUY' && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: '#e2e8f0' }}>Available cash</span>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: estimatedTotal > availableCash ? '#ef4444' : '#cbd5e1',
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                ${availableCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>

        {/* Market status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', borderRadius: 8,
          background: marketOpen ? 'rgba(16,185,129,0.08)' : 'rgba(251,191,36,0.08)',
          marginBottom: 16,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: 3,
            background: marketOpen ? '#10b981' : '#fbbf24',
          }} />
          <span style={{ fontSize: 11, color: marketOpen ? '#10b981' : '#fbbf24', fontWeight: 600 }}>
            {marketOpen ? 'Market Open' : `Market Closed · ${nextOpenLabel}`}
          </span>
        </div>

        {/* Error hints */}
        {!isValidQty && quantity !== '' && (
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 10 }}>Enter a valid quantity</div>
        )}
        {!canAfford && (
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 10 }}>
            Insufficient funds — need ${estimatedTotal.toFixed(2)}, have ${availableCash.toFixed(2)}
          </div>
        )}
        {!hasEnoughShares && (
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 10 }}>
            Not enough shares — you hold {sharesHeld}
          </div>
        )}

        </div>{/* end scrollable body */}

        {/* Sticky footer */}
        <div style={{
          flexShrink: 0,
          padding: '12px 20px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: '#0f172a',
        }}>

        {/* Submission error */}
        {tradeError && (
          <div style={{
            marginBottom: '10px', padding: '10px 12px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '8px',
            color: '#fca5a5',
            fontSize: '12px', fontWeight: 500,
            lineHeight: 1.4,
          }}>
            ⚠️ {tradeError}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '14px 0',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12, color: '#cbd5e1',
            fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15,
            cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!canClick} style={{
            flex: 2, padding: '14px 0',
            background: confirmed ? 'rgba(16,185,129,0.08)' : (submitting ? 'rgba(16,185,129,0.15)' : canSubmit ? sideColor : 'rgba(255,255,255,0.06)'),
            border: confirmed ? '1px solid rgba(16,185,129,0.25)' : 'none',
            borderRadius: 12,
            color: confirmed ? '#10b981' : (submitting ? '#6ee7b7' : canSubmit ? '#ffffff' : '#64748b'),
            fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15,
            cursor: canClick ? 'pointer' : (confirmed || submitting ? 'default' : 'not-allowed'),
            opacity: canClick ? 1 : (confirmed ? 1 : submitting ? 0.85 : 0.5),
            transition: 'all 0.25s ease',
          }}>
            {confirmed
              ? '✓ Sent'
              : submitting
                ? 'Sending…'
                : isReadOnlyBroker
                  ? `🔒 Read-only — ${activeAccount?.broker || 'broker'} does not support trading`
                  : isAIVariant
                  ? `${sideLabel} $${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈${rawShares.toFixed(supportsFractional ? 4 : 0)} shares)`
                  : forceDollarMode
                    ? `${sideLabel} $${rawInput.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} (${qty || 0} shares)`
                    : `${sideLabel} ${qty || 0} shares`}
          </button>
        </div>

        </div>{/* end sticky footer */}
      </div>
    </div>
  , document.body);
}
