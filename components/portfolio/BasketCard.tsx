'use client';

import React, { useState, useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';
import { getActiveLotCount, type Lot } from '@/lib/fifo-engine';
import type { Position } from '@/types';
import PositionCardV3 from './PositionCardV3';

// ─── Types ────────────────────────────────────────────────

export interface BasketPositionForCard {
  symbol: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  allocationPct: number;
  marketValue: number;
  totalPnL: number;
  totalPnLPct: number;
  /** Today's $ change since prior close (shares × day change). */
  dailyPnL?: number;
  /** Today's % change since prior close (per share). */
  dailyPnLPct?: number;
  name?: string;
  status: string;
  sector?: string;
}

export interface BasketCardBasket {
  id: string;
  name: string;
  emoji: string;
  positions: BasketPositionForCard[];
  totalCost: number;
  marketValue: number;
  totalPnL: number;
  totalPnLPct: number;
  dailyPnL?: number;
  dailyPnLPct?: number;
  activeCount: number;
  status: string;
}

interface BasketCardProps {
  basket: BasketCardBasket;
  userId: string | undefined;
  isExpanded: boolean;
  isSelected: boolean;
  selectMode: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onBuy?: () => void;
  onSell?: () => void;
  onBuyTicker?: (ticker: BasketPositionForCard) => void;
  onSellTicker?: (ticker: BasketPositionForCard, lots: Lot[]) => void;
  connectionId?: string | null;
}

// ─── Helpers ───────────────────────────────────────────────

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

// ─── Violet (basket) color ───
const VIOLET = 'var(--violet, #b389f0)';
// Fallback hex for violet
const VIOLET_HEX = '#b389f0';

// ─── Component ─────────────────────────────────────────────

export default function BasketCard({
  basket,
  userId,
  isExpanded,
  isSelected,
  selectMode,
  onToggleExpand,
  onToggleSelect,
  onBuy,
  onSell,
  onBuyTicker,
  onSellTicker,
  connectionId,
}: BasketCardProps) {
  // ── Lot data for all tickers in basket ──
  const [basketLots, setBasketLots] = useState<Record<string, Lot[]>>({});
  const [lotsLoading, setLotsLoading] = useState(false);

  // ── Expanded ticker within basket (for inline lot display) ──
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(new Set());

  const activePositions = basket.positions.filter(p => p.status === 'active');
  const plColor = basket.totalPnL >= 0 ? 'var(--gain, #10b981)' : 'var(--loss, #ef4444)';
  const plSign = basket.totalPnL >= 0 ? '+' : '';

  // Fetch lots when expanded
  useEffect(() => {
    if (!isExpanded || !userId || activePositions.length === 0) return;

    let cancelled = false;
    const uid = userId;

    async function fetchLots() {
      setLotsLoading(true);
      try {
        const client = getSupabaseBrowserClient();
        const symbols = activePositions.map(p => p.symbol);

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
          console.error('[BasketCard] lot fetch error:', error.message);
          setBasketLots({});
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
          setBasketLots(typed);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[BasketCard] lot fetch exception:', err);
          setBasketLots({});
        }
      } finally {
        if (!cancelled) setLotsLoading(false);
      }
    }

    fetchLots();
    return () => { cancelled = true; };
  }, [isExpanded, userId, activePositions, connectionId]);

  // ── Per-ticker aggregated data ──
  const tickerRows = activePositions.map(p => {
    const lots = basketLots[p.symbol] || [];
    const activeLots = getActiveLotCount(lots);
    const totalRemainingQty = lots.filter(l => l.remaining_qty > 0).reduce((s, l) => s + l.remaining_qty, 0);
    const weightedAvgCost = totalRemainingQty > 0
      ? lots.filter(l => l.remaining_qty > 0).reduce((s, l) => s + l.remaining_qty * l.price_at_fill, 0) / totalRemainingQty
      : p.avgCost;
    const hasMultiLot = activeLots >= 2;

    return {
      ...p,
      lots,
      activeLots,
      totalRemainingQty,
      weightedAvgCost,
      hasMultiLot,
    };
  });

  const toggleTicker = (symbol: string) => {
    setExpandedTickers(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  return (
    <div
      className="basket-card"
      style={{
        margin: '0 14px 8px',
        background: 'var(--bg-card, #1a2235)',
        borderRadius: 16,
        border: isExpanded
          ? `1px solid rgba(179,137,240,0.35)`
          : '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}
    >
      {/* ── Compact Header Row ── */}
      <div
        className="basket-card-header"
        onClick={() => {
          if (selectMode) {
            onToggleSelect();
            return;
          }
          onToggleExpand();
        }}
        style={{
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        {/* Left side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {/* Checkbox (select mode) */}
          {selectMode && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
              style={{ flexShrink: 0 }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  border: `2px solid ${isSelected ? VIOLET_HEX : 'rgba(255,255,255,0.2)'}`,
                  background: isSelected ? VIOLET_HEX : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isSelected && (
                  <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>
                )}
              </div>
            </div>
          )}

          {/* Name + badge */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#8794a8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
              Basket
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12.5,
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {basket.name}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 999,
                  background: 'rgba(179,137,240,0.12)',
                  color: VIOLET_HEX,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >
                {basket.activeCount} position{basket.activeCount !== 1 ? 's' : ''}
              </span>
            </div>
            {basket.status === 'partial' && (
              <div style={{ color: '#f59e0b', fontSize: 10, marginTop: 2 }}>Partial</div>
            )}
          </div>
        </div>

        {/* Right side */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            marginLeft: 12,
          }}
        >
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: '#ffffff',
              }}
            >
              ${basket.marketValue.toLocaleString('en-US', DOLLAR_FMT)}
            </div>
            <div
              style={{
                color: plColor,
                fontSize: 11,
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              {plSign}${Math.abs(basket.totalPnL).toLocaleString('en-US', DOLLAR_FMT)} ({plSign}{basket.totalPnLPct.toFixed(1)}%)
            </div>
            <div
              style={{
                color: (basket.dailyPnL ?? 0) >= 0 ? 'var(--gain, #10b981)' : 'var(--loss, #ef4444)',
                fontSize: 10.5,
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              Today {(basket.dailyPnL ?? 0) >= 0 ? '+' : ''}${Math.abs(basket.dailyPnL ?? 0).toLocaleString('en-US', DOLLAR_FMT)} ({(basket.dailyPnLPct ?? 0) >= 0 ? '+' : ''}{(basket.dailyPnLPct ?? 0).toFixed(2)}%)
            </div>
          </div>

          {/* Chevron */}
          <span
            style={{
              color: 'var(--dim, #aab4c7)',
              fontSize: 14,
              lineHeight: 1,
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.25s',
              flexShrink: 0,
            }}
          >
            ▾
          </span>
        </div>
      </div>

      {/* ── Expansion ── */}
      {isExpanded && (
        <div
          style={{
            padding: '0 14px 14px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: 12,
          }}
        >
          {/* ── Per-ticker rows ── */}
          {tickerRows.map((ticker, idx) => {
            const tPnLColor = ticker.totalPnL >= 0 ? 'var(--gain, #10b981)' : 'var(--loss, #ef4444)';
            const tPnLSign = ticker.totalPnL >= 0 ? '+' : '';
            const todayPnL = ticker.dailyPnL ?? 0;
            const todayPnLPct = ticker.dailyPnLPct ?? 0;
            const todayColor = todayPnL >= 0 ? 'var(--gain, #10b981)' : 'var(--loss, #ef4444)';
            const todaySign = todayPnL >= 0 ? '+' : '';
            const isTickerExpanded = expandedTickers.has(ticker.symbol);
            const displayAvgCost = ticker.hasMultiLot
              ? ticker.weightedAvgCost
              : ticker.avgCost;
            const companyName = ticker.name && ticker.name !== ticker.symbol ? ticker.name : null;

            // Map basket position → Position so the inline standalone component
            // (PositionCardV3) renders its full detail scoped to this ticker.
            const inlinePosition: Position = {
              symbol: ticker.symbol,
              name: companyName ?? ticker.symbol,
              qty: ticker.shares,
              avgCost: ticker.avgCost,
              currentPrice: ticker.currentPrice,
              marketValue: ticker.marketValue,
              dayChange: todayPnL,
              dayChangePercent: todayPnLPct,
              totalPnl: ticker.totalPnL,
              totalPnlPercent: ticker.totalPnLPct,
              portfolioPercent: ticker.allocationPct,
              sector: ticker.sector,
            };

            return (
              <div
                key={ticker.symbol}
                style={{
                  padding: '10px 12px',
                  marginBottom: idx < tickerRows.length - 1 ? 6 : 8,
                  background: 'rgba(179,137,240,0.04)',
                  border: isTickerExpanded
                    ? '1px solid rgba(179,137,240,0.30)'
                    : '1px solid rgba(179,137,240,0.10)',
                  borderRadius: 12,
                }}
              >
                {/* Ticker header row (tap to expand accordion) */}
                <div
                  onClick={() => toggleTicker(ticker.symbol)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                >
                  {/* Left: symbol · company name */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: '#ffffff' }}>
                      {ticker.symbol}
                    </span>
                    {companyName && (
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: 'var(--dim, #aab4c7)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '24ch',
                        }}
                      >
                        · {companyName}
                      </span>
                    )}
                  </div>

                  {/* Right: current price + shares + chevron */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 10 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', fontFamily: 'var(--mono-font, monospace)' }}>
                        ${ticker.currentPrice.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)' }}>
                        {ticker.shares % 1 === 0 ? ticker.shares : ticker.shares.toFixed(4)} sh
                      </div>
                    </div>
                    <span
                      style={{
                        color: 'var(--dim, #aab4c7)',
                        fontSize: 13,
                        lineHeight: 1,
                        transform: isTickerExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                        flexShrink: 0,
                      }}
                    >
                      ▾
                    </span>
                  </div>
                </div>

                {/* Stat grid: Fill/Avg · Today · Total */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 8,
                    marginTop: 9,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint, #8794a8)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
                      {ticker.hasMultiLot ? 'Avg' : 'Fill'}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--mono-font, monospace)' }}>
                      ${displayAvgCost.toFixed(2)}
                    </div>
                    {ticker.hasMultiLot && (
                      <div style={{ fontSize: 9.5, color: 'var(--faint, #8794a8)', marginTop: 1 }}>
                        {ticker.activeLots} lots
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint, #8794a8)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
                      Today
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: todayColor, fontFamily: 'var(--mono-font, monospace)' }}>
                      {todaySign}${Math.abs(todayPnL).toFixed(2)}
                    </div>
                    <div style={{ fontSize: 9.5, color: todayColor, marginTop: 1 }}>
                      {todaySign}{todayPnLPct.toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint, #8794a8)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
                      Total
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: tPnLColor, fontFamily: 'var(--mono-font, monospace)' }}>
                      {tPnLSign}${Math.abs(ticker.totalPnL).toFixed(2)}
                    </div>
                    <div style={{ fontSize: 9.5, color: tPnLColor, marginTop: 1 }}>
                      {tPnLSign}{ticker.totalPnLPct.toFixed(2)}%
                    </div>
                  </div>
                </div>

                {/* Inline standalone detail (accordion) */}
                {isTickerExpanded && (
                  <PositionCardV3
                    inline
                    pos={inlinePosition}
                    isSelected={false}
                    isExpanded={true}
                    onToggleSelect={() => {}}
                    onToggleExpand={() => toggleTicker(ticker.symbol)}
                    onBuy={() => onBuyTicker?.(ticker)}
                    onSell={(lots) => onSellTicker?.(ticker, lots)}
                    showCheckbox={false}
                    basketContext={{
                      basketId: basket.id,
                      basketName: basket.name,
                      basketEmoji: basket.emoji,
                    }}
                    connectionId={connectionId ?? null}
                  />
                )}
              </div>
            );
          })}

          {/* ── Aggregate bar ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              padding: '10px 12px',
              background: 'rgba(179,137,240,0.05)',
              borderRadius: 10,
              marginBottom: 12,
              border: '1px solid rgba(179,137,240,0.12)',
            }}
          >
            <div>
              <div style={{ fontSize: 9, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                Total Value
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#ffffff',
                  fontFamily: 'var(--mono-font, monospace)',
                }}
              >
                ${basket.marketValue.toLocaleString('en-US', DOLLAR_FMT)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                Total Return
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: plColor }}>
                {plSign}${Math.abs(basket.totalPnL).toLocaleString('en-US', DOLLAR_FMT)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                Positions
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: VIOLET_HEX }}>
                {basket.activeCount}
              </div>
            </div>
          </div>

          {/* ── Buy More / Sell / ⋯ Buttons ── */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="basket-buy-more-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof onBuy === 'function') {
                  onBuy();
                } else {
                  console.error('[BasketCard] onBuy is not a function:', typeof onBuy);
                }
              }}
              style={{
                flex: 1,
                minHeight: 40,
                background: 'transparent',
                border: `1px solid ${VIOLET_HEX}44`,
                borderRadius: 10,
                color: VIOLET_HEX,
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Buy More
            </button>
            <button
              type="button"
              className="basket-sell-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof onSell === 'function') {
                  onSell();
                } else {
                  console.error('[BasketCard] onSell is not a function:', typeof onSell);
                }
              }}
              style={{
                flex: 1,
                minHeight: 40,
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: 10,
                color: 'var(--loss, #ef4444)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Sell
            </button>
            <button
              type="button"
              style={{
                minHeight: 40,
                width: 40,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10,
                color: 'var(--dim, #aab4c7)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              ⋯
            </button>
          </div>
        </div>
      )}
    </div>
  );
}