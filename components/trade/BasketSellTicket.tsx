// ─── Basket Sell Ticket ──────────────────────────────────
// Phase 6 — Multi-ticker sell form for an existing basket.
// Perl `basket-design-final.html` section 06.
// Supports "Sell by qty" (default) and "Sell All" (liquidate) modes.
// FIFO lot consumption drives the realized P/L estimate.

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getMarketStatus } from '@/lib/market-hours';
import {
  consumeLotsFIFO,
  calculateRealizedGain,
  getActiveLotCount,
  getTotalRemainingQty,
  type Lot,
  type FIFOResult,
} from '@/lib/fifo-engine';
import FIFOExplainer, { hasSeenFIFOExplainer } from '@/components/disclosure/FIFOExplainer';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

// ─── Types ───────────────────────────────────────────────

export interface BasketSellTicketProps {
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
      lots: Lot[];
    }>;
  };
  onConfirmSellByQty: (
    orders: Array<{ symbol: string; shares: number }>
  ) => Promise<void>;
  onConfirmSellAll: () => Promise<void>;
  /** Owning user id — used to load the FIFO lot ledger for each ticker. */
  userId?: string;
  /** Broker connection id (NULL = demo). Maps to position_lots.account_id. */
  connectionId?: string | null;
}

// ─── Constants ────────────────────────────────────────────

const MONO = 'var(--mono-font, monospace)';
const CYAN = 'var(--cyan, #22d3ee)';
const CYAN_HEX = '#22d3ee';
const DIM = 'var(--dim, #aab4c7)';
const FAINT = 'var(--faint, #8794a8)';
const GAIN = 'var(--gain, #10b981)';
const LOSS = 'var(--loss, #ef4444)';
const RED_HEX = '#ef4444';
const BG_CARD = 'var(--bg-card, #1a2235)';
const AMBER = 'var(--amber, #f0b73f)';

// ─── Helpers ─────────────────────────────────────────────

function formatLotDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

// ─── Component ────────────────────────────────────────────

export default function BasketSellTicket({
  isOpen,
  onClose,
  basket,
  onConfirmSellByQty,
  onConfirmSellAll,
  userId,
  connectionId = null,
}: BasketSellTicketProps) {
  // Sell mode
  const [sellMode, setSellMode] = useState<'byQty' | 'all'>('byQty');
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});
  const [marketIsOpen, setMarketIsOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showFIFOExplainer, setShowFIFOExplainer] = useState(false);
  const [lotsByTicker, setLotsByTicker] = useState<Record<string, Lot[]>>({});

  // ── Load the FIFO lot ledger for every ticker in this basket ──
  useEffect(() => {
    if (!isOpen || !userId || basket.positions.length === 0) {
      setLotsByTicker({});
      return;
    }

    let cancelled = false;
    const uid = userId;

    async function fetchLots() {
      try {
        const client = getSupabaseBrowserClient();
        const symbols = basket.positions.map(p => p.symbol);

        let query = client
          .from('position_lots')
          .select('*')
          .eq('user_id', uid)
          .in('ticker', symbols)
          .gt('remaining_qty', 0)
          .order('filled_at', { ascending: true });

        if (connectionId) {
          query = query.eq('account_id', connectionId);
        }

        const { data, error } = await query;
        if (cancelled) return;

        if (error) {
          console.error('[BasketSellTicket] lot fetch error:', error.message);
          setLotsByTicker({});
        } else {
          const rows: any[] = data || [];
          const typed: Record<string, Lot[]> = {};
          for (const row of rows) {
            const lot: Lot = {
              id: row.id as string,
              ticker: row.ticker as string,
              qty: Number(row.qty),
              remaining_qty: Number(row.remaining_qty),
              price_at_fill: Number(row.price_at_fill),
              filled_at: row.filled_at as string,
              basket_id: (row.basket_id || null) as string | null,
              origin_tag: (row.origin_tag || null) as string | null,
              source: (row.source || null) as string | null,
            };
            if (!typed[lot.ticker]) typed[lot.ticker] = [];
            typed[lot.ticker].push(lot);
          }
          setLotsByTicker(typed);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[BasketSellTicket] lot fetch exception:', err);
          setLotsByTicker({});
        }
      }
    }

    fetchLots();
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId, connectionId, basket.positions]);

  // Positions with their real lots merged in (from the ledger).
  const positions = useMemo(() => {
    return basket.positions.map(p => ({
      ...p,
      lots: lotsByTicker[p.symbol] ?? p.lots ?? [],
    }));
  }, [basket.positions, lotsByTicker]);

  // Determine if any ticker has 2+ active lots — triggers FIFO explainer
  const multiLotTicker = useMemo(() => {
    if (hasSeenFIFOExplainer()) return null;
    return positions.find(p => getActiveLotCount(p.lots) >= 2);
  }, [positions]);

  // Dates for the explainer modal (independent of the dismiss flag).
  const explainerTarget = useMemo(() => {
    const p = positions.find(pos => getActiveLotCount(pos.lots) >= 2);
    if (!p) return null;
    const sorted = [...p.lots]
      .filter(l => l.remaining_qty > 0)
      .sort((a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime());
    return {
      ticker: p.symbol,
      oldestLotDate: sorted[0] ? formatLotDate(sorted[0].filled_at) : '',
      secondLotDate: sorted[1] ? formatLotDate(sorted[1].filled_at) : '',
    };
  }, [positions]);

  // Show FIFO explainer on open if not yet dismissed
  useEffect(() => {
    if (isOpen && multiLotTicker && !hasSeenFIFOExplainer()) {
      // Small delay so the ticket renders first
      const t = setTimeout(() => setShowFIFOExplainer(true), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen, multiLotTicker]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const ms = getMarketStatus();
    setMarketIsOpen(ms.isOpen);
    // Reset state
    setSellMode('byQty');
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

  const setQty = (symbol: string, val: string) => {
    setQtyMap(prev => ({ ...prev, [symbol]: val }));
  };

  // Snap to max for a ticker
  const setMaxQty = useCallback((symbol: string) => {
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) return;
    const maxQty = getTotalRemainingQty(pos.lots);
    setQty(symbol, String(maxQty));
  }, [positions]);

  // Derived rows with FIFO computation
  const { rows, totalProceeds, totalRealizedPL, positionsAffected } = useMemo(() => {
    const posArr = positions;
    let tp = 0;
    let tpl = 0;
    let affected = 0;
    const rows = posArr.map(pos => {
      const raw = qtyMap[pos.symbol] || '';
      const inputQty = parseFloat(raw) || 0;
      const avail = getTotalRemainingQty(pos.lots);
      const lotCount = getActiveLotCount(pos.lots);
      const isMaxed = inputQty > 0 && inputQty >= avail;

      let fifoResult: FIFOResult | null = null;
      let realizedGain = 0;

      if (inputQty > 0 && inputQty <= avail && pos.lots.length > 0) {
        try {
          fifoResult = consumeLotsFIFO(pos.lots, inputQty);
          realizedGain = calculateRealizedGain(fifoResult.consumed, pos.currentPrice);
        } catch {
          // qty > available, shouldn't happen with the guard above
        }
      }

      const proceeds = inputQty * pos.currentPrice;
      if (inputQty > 0) {
        tp += proceeds;
        tpl += realizedGain;
        affected++;
      }

      return {
        ...pos,
        inputQty,
        inputStr: raw,
        avail,
        lotCount,
        isMaxed,
        fifoResult,
        realizedGain,
        proceeds,
      };
    });

    return {
      rows,
      totalProceeds: tp,
      totalRealizedPL: tpl,
      positionsAffected: affected,
    };
  }, [positions, qtyMap]);

  // FIFO notice: show description for the first ticker with active qty > 0
  const fifoNotice = useMemo(() => {
    if (sellMode === 'all') return null;
    for (const row of rows) {
      if (row.inputQty > 0 && row.fifoResult && row.fifoResult.consumed.length > 0) {
        const consumed = row.fifoResult.consumed;
        const dates = consumed.map(c => {
          // Find the lot date
          const lot = row.lots.find(l => l.id === c.lot_id);
          return lot ? formatLotDate(lot.filled_at) : '?';
        });

        if (dates.length >= 2 && dates[0] !== dates[1]) {
          return (
            <span key={row.symbol}>
              ⚠ Shares sold oldest-first (FIFO) for tax purposes. Selling{' '}
              <strong>{row.symbol}</strong> draws from your {dates[0]} lot before your{' '}
              {dates[1]} lot.
            </span>
          );
        } else if (consumed.length >= 1) {
          const date = dates[0] || '?';
          return (
            <span>
              ⚠ Shares sold oldest-first (FIFO) for tax purposes.
            </span>
          );
        }
      }
    }
    return null;
  }, [rows, sellMode]);

  const handleSubmit = async () => {
    if (submitting) return;

    if (sellMode === 'all') {
      setSubmitting(true);
      try {
        await onConfirmSellAll();
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const orders = rows
      .filter(r => r.inputQty > 0)
      .map(r => ({
        symbol: r.symbol,
        shares: r.inputQty,
      }));
    if (orders.length === 0) return;
    setSubmitting(true);
    try {
      await onConfirmSellByQty(orders);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const canSubmit =
    sellMode === 'all' ||
    rows.some(r => r.inputQty > 0);

  return createPortal(
    <>
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
            Sell
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
            <span style={{ color: AMBER, fontSize: 10, fontWeight: 700 }}>
              Market Closed
            </span>
          )}
        </div>

        {/* ── Sell Mode Toggle ── */}
        <div
          style={{
            padding: '0 18px 10px',
            display: 'flex',
            gap: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setSellMode('byQty')}
            style={{
              flex: 1,
              minHeight: 34,
              background: sellMode === 'byQty' ? 'rgba(239,68,68,0.12)' : 'transparent',
              border: sellMode === 'byQty' ? '1px solid rgba(239,68,68,0.30)' : '1px solid rgba(255,255,255,0.06)',
              borderRadius: '8px 0 0 8px',
              color: sellMode === 'byQty' ? LOSS : DIM,
              fontWeight: 600,
              fontSize: 12,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            Sell by qty
          </button>
          <button
            type="button"
            onClick={() => setSellMode('all')}
            style={{
              flex: 1,
              minHeight: 34,
              background: sellMode === 'all' ? 'rgba(239,68,68,0.12)' : 'transparent',
              border: sellMode === 'all' ? '1px solid rgba(239,68,68,0.30)' : '1px solid rgba(255,255,255,0.06)',
              borderRadius: '0 8px 8px 0',
              color: sellMode === 'all' ? LOSS : DIM,
              fontWeight: 600,
              fontSize: 12,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            Sell All
          </button>
        </div>

        {sellMode === 'all' ? (
          /* ── Sell All Confirmation View ── */
          <div
            style={{
              flex: 1,
              padding: '20px 18px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 40 }}>🧺</span>
            <p
              style={{
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                textAlign: 'center',
                margin: 0,
              }}
            >
              Sell all positions in {basket.name}?
            </p>
            <p
              style={{
                color: DIM,
                fontSize: 12,
                textAlign: 'center',
                margin: 0,
              }}
            >
              This will liquidate all {basket.positions.length} positions.
              Shares will be sold oldest-first (FIFO). This action cannot
              be undone once the orders are placed.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 8,
                width: '100%',
                maxWidth: 340,
                marginTop: 8,
              }}
            >
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  minHeight: 40,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 10,
                  color: DIM,
                  fontWeight: 600,
                  fontSize: 13,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                style={{
                  flex: 1,
                  minHeight: 40,
                  background: RED_HEX,
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                }}
              >
                {submitting ? 'Selling…' : 'Sell All'}
              </button>
            </div>
          </div>
        ) : (
          <>
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
                Est. proceeds
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
                const showMaxChip = !row.isMaxed && row.avail > 0;

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
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>
                        {row.symbol}
                      </div>
                      <div style={{ fontSize: 10, color: FAINT, marginTop: 1 }}>
                        own {row.qty} sh · avg ${row.avgCost.toFixed(2)}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <input
                          type="number"
                          min="0"
                          max={row.avail}
                          step="1"
                          placeholder="—"
                          value={row.inputStr}
                          onChange={e => setQty(row.symbol, e.target.value)}
                          style={{
                            width: '100%',
                            maxWidth: 56,
                            background: row.isMaxed
                              ? 'rgba(239,68,68,0.08)'
                              : isActive
                                ? 'rgba(34,211,238,0.06)'
                                : 'transparent',
                            border: row.isMaxed
                              ? '1px solid rgba(239,68,68,0.35)'
                              : isActive
                                ? '1px solid rgba(34,211,238,0.30)'
                                : '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 8,
                            padding: '6px 8px',
                            fontSize: 12,
                            fontWeight: 600,
                            color: row.isMaxed ? LOSS : isActive ? '#fff' : DIM,
                            fontFamily: MONO,
                            textAlign: 'right',
                            outline: 'none',
                          }}
                        />
                        {showMaxChip && (
                          <button
                            type="button"
                            onClick={() => setMaxQty(row.symbol)}
                            style={{
                              background: 'rgba(34,211,238,0.15)',
                              border: 'none',
                              borderRadius: 4,
                              color: CYAN,
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '2px 5px',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-sans)',
                              whiteSpace: 'nowrap',
                              lineHeight: 1.3,
                            }}
                          >
                            MAX
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Est. proceeds column */}
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: isActive ? '#fff' : DIM,
                          fontFamily: MONO,
                        }}
                      >
                        {isActive ? `$${row.proceeds.toFixed(2)}` : '—'}
                      </div>
                      {/* Realized P/L sub-line */}
                      {isActive && (
                        <div
                          style={{
                            fontSize: 9,
                            fontWeight: 600,
                            color: row.realizedGain >= 0 ? GAIN : LOSS,
                          }}
                        >
                          {row.realizedGain >= 0 ? '+' : ''}
                          ${row.realizedGain.toFixed(2)}
                        </div>
                      )}
                      {/* Lot count label */}
                      {row.lotCount >= 2 && (
                        <div
                          style={{
                            fontSize: 9,
                            color: FAINT,
                            marginTop: 1,
                          }}
                        >
                          {row.lotCount} lots · FIFO
                        </div>
                      )}
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
                Positions affected{' '}
                <span style={{ color: '#fff', fontWeight: 700 }}>
                  {positionsAffected}
                </span>
              </span>
              <span>
                Est. realized P/L{' '}
                <span
                  style={{
                    color: totalRealizedPL >= 0 ? GAIN : LOSS,
                    fontWeight: 700,
                  }}
                >
                  {totalRealizedPL >= 0 ? '+' : ''}
                  ${totalRealizedPL.toFixed(2)}
                </span>
              </span>
              <span>
                Total est. proceeds{' '}
                <span style={{ color: '#fff', fontWeight: 700 }}>
                  ${totalProceeds.toFixed(2)}
                </span>
              </span>
            </div>

            {/* ── FIFO Notice ── */}
            {fifoNotice && (
              <div
                style={{
                  margin: '0 18px 6px',
                  padding: '8px 12px',
                  background: 'rgba(240,183,63,0.08)',
                  border: '1px solid rgba(240,183,63,0.20)',
                  borderRadius: 8,
                  fontSize: 10,
                  color: AMBER,
                  lineHeight: 1.5,
                }}
              >
                {fifoNotice}
              </div>
            )}

            {/* ── CTA ── */}
            <div style={{ padding: '0 18px 10px' }}>
              <button
                type="button"
                disabled={submitting || !canSubmit}
                onClick={handleSubmit}
                style={{
                  width: '100%',
                  minHeight: 44,
                  background: canSubmit ? RED_HEX : 'rgba(239,68,68,0.15)',
                  border: 'none',
                  borderRadius: 12,
                  color: canSubmit ? '#fff' : DIM,
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: 'var(--font-sans)',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  transition: 'all 0.15s',
                }}
              >
                {submitting ? 'Placing order…' : 'Review & Sell →'}
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
          </>
        )}
      </div>
    </div>

      {/* One-time FIFO explainer (first multi-lot sell only) */}
      <FIFOExplainer
        isOpen={showFIFOExplainer}
        onDismiss={() => setShowFIFOExplainer(false)}
        ticker={explainerTarget?.ticker ?? ''}
        oldestLotDate={explainerTarget?.oldestLotDate ?? ''}
        secondLotDate={explainerTarget?.secondLotDate ?? ''}
      />
    </>,
    document.body
  );
}