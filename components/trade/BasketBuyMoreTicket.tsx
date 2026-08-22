// ─── Basket Buy More Ticket ───────────────────────────────
// Phase 6 — Multi-ticker buy form for an existing basket.
// Perl `basket-design-final.html` section 05.
// Allows the user to enter share quantities for each ticker
// in a basket and submit a bulk buy order.

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getMarketStatus } from '@/lib/market-hours';

// ─── Types ───────────────────────────────────────────────

export interface BasketBuyMoreTicketProps {
  isOpen: boolean;
  onClose: () => void;
  basket: {
    id: string;
    name: string;
    emoji?: string;
    positions: Array<{
      symbol: string;
      qty: number;
      avgCost: number;
      currentPrice: number;
    }>;
  };
  onConfirm: (
    orders: Array<{ symbol: string; shares: number; estimatedCost: number }>
  ) => Promise<void>;
  availableCash: number;
}

// ─── Constants ────────────────────────────────────────────

const MONO = 'var(--mono-font, monospace)';
const CYAN = 'var(--cyan, #22d3ee)';
const CYAN_HEX = '#22d3ee';
const DIM = 'var(--dim, #aab4c7)';
const FAINT = 'var(--faint, #8794a8)';
const GAIN = 'var(--gain, #10b981)';
const LOSS = 'var(--loss, #ef4444)';
const BG_CARD = 'var(--bg-card, #1a2235)';
const BG_BTN = 'rgba(34,211,238,0.12)';

export default function BasketBuyMoreTicket({
  isOpen,
  onClose,
  basket,
  onConfirm,
  availableCash,
}: BasketBuyMoreTicketProps) {
  // Qty state: keyed by symbol → string (so "0" ≠ "")
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});
  const [marketIsOpen, setMarketIsOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const ms = getMarketStatus();
    setMarketIsOpen(ms.isOpen);
    // Reset quantities on open
    const init: Record<string, string> = {};
    for (const pos of basket.positions) {
      init[pos.symbol] = '';
    }
    setQtyMap(init);
    setSubmitting(false);
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, basket.positions]);

  // Derived totals
  const { rows, totalCost, selectedCount, totalPositions } = useMemo(() => {
    const posArr = basket.positions.filter(p => p.currentPrice > 0);
    let tc = 0;
    let sel = 0;
    const rows = posArr.map(pos => {
      const raw = qtyMap[pos.symbol] || '';
      const shares = parseFloat(raw) || 0;
      const cost = shares * pos.currentPrice;
      if (shares > 0) {
        tc += cost;
        sel++;
      }
      return { ...pos, inputQty: shares, inputStr: raw, estCost: cost };
    });
    return {
      rows,
      totalCost: tc,
      selectedCount: sel,
      totalPositions: posArr.length,
    };
  }, [basket.positions, qtyMap]);

  const setQty = (symbol: string, val: string) => {
    setQtyMap(prev => ({ ...prev, [symbol]: val }));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const orders = rows
      .filter(r => r.inputQty > 0)
      .map(r => ({
        symbol: r.symbol,
        shares: r.inputQty,
        estimatedCost: r.estCost,
      }));
    if (orders.length === 0) return;
    setSubmitting(true);
    try {
      await onConfirm(orders);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'var(--bg-overlay, rgba(10,15,30,0.95))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: BG_CARD,
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.06)',
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: DIM,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              padding: 0,
            }}
          >
            ← Basket
          </button>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>
            Buy More
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: DIM,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Basket Context Bar ── */}
        <div
          style={{
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>{basket.emoji || '🧺'}</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>
            {basket.name}
          </span>
          {marketIsOpen ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(16,185,129,0.12)',
                color: GAIN,
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: GAIN,
                  display: 'inline-block',
                }}
              />
              Market Open
            </span>
          ) : (
            <span style={{ color: 'var(--amber, #f0b73f)', fontSize: 10, fontWeight: 700 }}>
              Market Closed
            </span>
          )}
        </div>

        {/* ── Column Headers ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.15fr 0.85fr 0.75fr 0.95fr',
            gap: 6,
            padding: '8px 18px 4px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 600, color: FAINT, textTransform: 'uppercase' }}>
            Symbol
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: FAINT, textTransform: 'uppercase', textAlign: 'right' }}>
            Price
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: FAINT, textTransform: 'uppercase', textAlign: 'right' }}>
            Qty
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: FAINT, textTransform: 'uppercase', textAlign: 'right' }}>
            Est. cost
          </span>
        </div>

        {/* ── Ticker Rows (scrollable) ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 18px',
          }}
        >
          {rows.map((row, idx) => {
            const isActive = row.inputQty > 0;
            return (
              <div
                key={row.symbol}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.15fr 0.85fr 0.75fr 0.95fr',
                  gap: 6,
                  padding: '10px 0',
                  borderBottom:
                    idx < rows.length - 1
                      ? '1px solid rgba(255,255,255,0.04)'
                      : 'none',
                  alignItems: 'center',
                }}
              >
                {/* Symbol column */}
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: '#fff',
                    }}
                  >
                    {row.symbol}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: FAINT,
                      marginTop: 1,
                    }}
                  >
                    own {row.qty} sh
                  </div>
                </div>

                {/* Price column */}
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#fff',
                      fontFamily: MONO,
                    }}
                  >
                    ${row.currentPrice.toFixed(2)}
                  </div>
                  {/* intraday % — use a small mock or derive from PnL */}
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: row.currentPrice >= row.avgCost ? GAIN : LOSS,
                    }}
                  >
                    {row.avgCost > 0
                      ? `${((row.currentPrice - row.avgCost) / row.avgCost * 100) >= 0 ? '+' : ''}${((row.currentPrice - row.avgCost) / row.avgCost * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>

                {/* Qty input column */}
                <div style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="—"
                    value={row.inputStr}
                    onChange={e => setQty(row.symbol, e.target.value)}
                    style={{
                      width: '100%',
                      maxWidth: 70,
                      background: isActive
                        ? 'rgba(34,211,238,0.06)'
                        : 'transparent',
                      border: isActive
                        ? '1px solid rgba(34,211,238,0.30)'
                        : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 8,
                      padding: '6px 8px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: isActive ? '#fff' : DIM,
                      fontFamily: MONO,
                      textAlign: 'right',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Est. cost column */}
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: isActive ? CYAN : DIM,
                      fontFamily: MONO,
                    }}
                  >
                    {isActive ? `$${row.estCost.toFixed(2)}` : '—'}
                  </span>
                </div>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div
              style={{
                padding: '30px 0',
                textAlign: 'center',
                color: FAINT,
                fontSize: 12,
              }}
            >
              No positions in this basket
            </div>
          )}
        </div>

        {/* ── Summary Strip ── */}
        <div
          style={{
            padding: '10px 18px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 11,
            color: DIM,
          }}
        >
          <span>
            Symbols selected{' '}
            <span style={{ color: CYAN, fontWeight: 700 }}>
              {selectedCount} of {totalPositions}
            </span>
          </span>
          <span>
            Est. buying power used{' '}
            <span
              style={{
                color: totalCost <= availableCash ? GAIN : LOSS,
                fontWeight: 700,
              }}
            >
              ${totalCost.toFixed(2)}
            </span>
          </span>
          <span>
            Total est. cost{' '}
            <span style={{ color: '#fff', fontWeight: 700 }}>
              ${totalCost.toFixed(2)}
            </span>
          </span>
        </div>

        {/* ── CTA ── */}
        <div style={{ padding: '0 18px 10px' }}>
          <button
            type="button"
            disabled={submitting || selectedCount === 0}
            onClick={handleSubmit}
            style={{
              width: '100%',
              minHeight: 44,
              background: selectedCount > 0 ? CYAN_HEX : 'rgba(34,211,238,0.15)',
              border: 'none',
              borderRadius: 12,
              color: selectedCount > 0 ? '#0a0f1e' : DIM,
              fontWeight: 700,
              fontSize: 14,
              fontFamily: 'var(--font-sans)',
              cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            {submitting ? 'Placing order…' : 'Review & Buy →'}
          </button>
        </div>

        {/* ── Footnote ── */}
        <div
          style={{
            padding: '6px 18px 14px',
            fontSize: 10,
            color: FAINT,
            textAlign: 'center',
          }}
        >
          Prices update live · final fill price may vary at market
        </div>
      </div>
    </div>,
    document.body
  );
}