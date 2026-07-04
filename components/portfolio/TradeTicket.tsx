// ─── Trade Ticket Modal ─────────────────────────────────────
// Used for "Buy More" and "Sell" from position detail cards.
// Supports Market and Limit order types.
// Delegates execution to PortfolioContext.executeTrade().
// Does NOT contain trading logic — DemoBroker handles that.

'use client';

import { useState, useEffect, useCallback } from 'react';
import { getMarketStatus } from '@/lib/market-hours';
import { X } from 'lucide-react';

interface TradeTicketProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  side: 'BUY' | 'SELL';
  currentPrice: number;
  sharesHeld: number;
  availableCash: number;
  onConfirm: (params: {
    shares: number;
    type: 'market' | 'limit';
    limitPrice?: number;
  }) => Promise<void>;
}

export default function TradeTicket({
  isOpen, onClose, symbol, side, currentPrice,
  sharesHeld, availableCash, onConfirm,
}: TradeTicketProps) {
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [quantity, setQuantity] = useState<string>('');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
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
    setQuantity('');
    setLimitPrice('');
    setSubmitting(false);
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const qty = parseFloat(quantity) || 0;
  const limit = parseFloat(limitPrice) || 0;
  const effectivePrice = orderType === 'limit' && limit > 0 ? limit : currentPrice;
  const estimatedTotal = qty * effectivePrice;

  // Validation
  const isValidQty = qty > 0 && Number.isFinite(qty);
  const isValidLimit = orderType === 'market' || (limit > 0 && Number.isFinite(limit));
  const canAfford = side === 'SELL' || estimatedTotal <= availableCash;
  const hasEnoughShares = side === 'BUY' || qty <= sharesHeld;
  const canSubmit = isValidQty && isValidLimit && canAfford && hasEnoughShares && !submitting;

  const setMax = useCallback(() => {
    if (side === 'SELL') {
      setQuantity(sharesHeld.toString());
    } else {
      // Max affordable (round down to whole shares for stocks)
      const max = Math.floor(availableCash / effectivePrice);
      setQuantity(max > 0 ? max.toString() : '');
    }
  }, [side, sharesHeld, availableCash, effectivePrice]);

  const handleConfirm = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm({
        shares: qty,
        type: orderType,
        limitPrice: orderType === 'limit' ? limit : undefined,
      });
      onClose();
    } catch {
      setSubmitting(false);
    }
  }, [canSubmit, qty, orderType, limit, onConfirm, onClose]);

  if (!isOpen) return null;

  const sideColor = side === 'BUY' ? '#10b981' : '#ef4444';
  const sideLabel = side === 'BUY' ? 'Buy' : 'Sell';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 420, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
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

        {/* Order type toggle */}
        <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>Order Type</div>
        <div style={{
          display: 'flex', background: 'rgba(255,255,255,0.04)',
          borderRadius: 10, padding: 3, marginBottom: 16,
        }}>
          {(['market', 'limit'] as const).map((t) => (
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
              {t === 'market' ? 'Market' : 'Limit'}
            </button>
          ))}
        </div>

        {/* Quantity */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="section-label" style={{ fontSize: 10 }}>Quantity</div>
          <button onClick={setMax} style={{
            background: 'none', border: 'none',
            fontSize: 11, fontWeight: 700, color: '#22d3ee',
            cursor: 'pointer', padding: 0,
          }}>
            Max
          </button>
        </div>
        <input
          type="number"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
          min="0"
          style={{
            width: '100%', padding: '12px 14px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, fontSize: 18, fontWeight: 600,
            color: '#ffffff', fontFamily: 'var(--font-mono, monospace)',
            outline: 'none', marginBottom: 4,
          }}
        />
        <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 14 }}>
          {side === 'SELL'
            ? `${sharesHeld} shares held`
            : `≈ $${(qty * currentPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at market price`}
        </div>

        {/* Limit price */}
        {orderType === 'limit' && (
          <>
            <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>Limit Price</div>
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
          <button onClick={handleConfirm} disabled={!canSubmit} style={{
            flex: 2, padding: '14px 0',
            background: canSubmit ? sideColor : 'rgba(255,255,255,0.06)',
            border: 'none', borderRadius: 12,
            color: canSubmit ? '#ffffff' : '#64748b',
            fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.5,
          }}>
            {submitting ? 'Processing...' : `${sideLabel} ${qty || 0} shares`}
          </button>
        </div>

        </div>{/* end sticky footer */}
      </div>
    </div>
  );
}
