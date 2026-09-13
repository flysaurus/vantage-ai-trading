'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Position } from '@/types';
import { useReconstructedLots } from '@/hooks/useReconstructedLots';
import { useAccountLotsScope } from '@/hooks/useAccountLotsScope';
import { getActiveLotCount, getTotalRemainingQty, formatFIFOLabel, type Lot } from '@/lib/fifo-engine';
import { ThresholdBadgePill } from './ThresholdBadgePill';
import type { ThresholdCrossing } from '@/lib/insights/threshold-badge';

// ─── Props ─────────────────────────────────────────────────

interface PositionCardV3Props {
  pos: Position;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onBuy?: () => void;
  onSell?: (lots: Lot[]) => void;
  showCheckbox?: boolean;
  basketContext?: { basketId: string; basketName: string; basketEmoji: string } | null;
  /** Render only the expanded content inline (no card chrome/header) — used inside basket accordion. */
  inline?: boolean;
  /**
   * Active threshold crossing for THIS position (target-return/-loss milestone).
   * Rendered as a small pill next to the ticker. Most rows have none.
   */
  crossing?: ThresholdCrossing | null;
}

// ─── Helpers ───────────────────────────────────────────────

const fmtDollar = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const pctStr = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

const gainLossClass = (val: number) =>
  val > 0 ? 'gain' : val < 0 ? 'loss' : 'flat';

const formatLotDate = (dateStr: string): string => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
};

/** Quantities: whole shares stay whole, fractional shares get at most 4dp. */
const fmtQty = (n: number) =>
  n % 1 === 0 ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');

// ─── Component ─────────────────────────────────────────────

export default function PositionCardV3({
  pos,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onBuy,
  onSell,
  showCheckbox = false,
  basketContext = null,
  inline = false,
  crossing = null,
}: PositionCardV3Props) {
  // ── Lot data — the SAME account-scoped, activities-based reconstruction
  // Position Detail reads (hooks/useReconstructedLots →
  // GET /api/strategies/tax-harvest/lots). The synthetic `position_lots`
  // ledger is gone from this card; both consumers share one real-lot source.
  const { connectionId: activeConnectionId, isDemo: isDemoAccount } = useAccountLotsScope();
  const {
    lots,
    unknownStart,
    windowStartDate,
    loading: lotsLoading,
    error: lotsError,
  } = useReconstructedLots({
    connectionId: activeConnectionId,
    isDemo: isDemoAccount,
    symbol: pos.symbol,
    // Fetch once expanded (or when rendered inline inside a basket accordion).
    enabled: inline || isExpanded,
  });

  // ── Sparkline + fundamentals + news ──
  const [sparkline, setSparkline] = useState<{
    points: { t: number; c: number }[];
    high52w: number;
    low52w: number;
  } | null>(null);
  const [sparklineLoading, setSparklineLoading] = useState(false);
  const [fundamentals, setFundamentals] = useState<{
    eps: number | null;
    pe: number | null;
    dividendYield: number | null;
    dividendRate: number | null;
    recommendation: string | null;
    numAnalysts: number | null;
    marketCap: number | null;
    volume: number | null;
    avgVolume: number | null;
    dayHigh: number | null;
    dayLow: number | null;
    beta: number | null;
    nextEarningsDate: string | null;
  } | null>(null);
  const [newsItems, setNewsItems] = useState<
    {
      title: string;
      link: string;
      publisher: string;
      pubDate: string;
      sentiment?: { label: 'positive' | 'negative' | 'neutral'; score: number };
    }[]
  >([]);
  const [tooltip, setTooltip] = useState<{
    x: number;
    price: number;
    date: string;
  } | null>(null);
  const sparkSvgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;

    async function load() {
      setSparklineLoading(true);
      try {
        const [sparkRes, fundRes, newsRes] = await Promise.all([
          fetch(`/api/market/sparkline?symbol=${encodeURIComponent(pos.symbol)}`),
          fetch(`/api/stock/fundamentals?symbol=${encodeURIComponent(pos.symbol)}`),
          fetch(`/api/stock/news?symbol=${encodeURIComponent(pos.symbol)}&count=3`),
        ]);
        if (sparkRes.ok) {
          const data = await sparkRes.json();
          if (!cancelled && data.points?.length) {
            setSparkline({
              points: data.points,
              high52w: data.high52w,
              low52w: data.low52w,
            });
          }
        }
        if (fundRes.ok) {
          const fData = await fundRes.json();
          if (!cancelled && fData.symbol) {
            setFundamentals({
              eps: fData.eps,
              pe: fData.pe,
              dividendYield: fData.dividendYield,
              dividendRate: fData.dividendRate,
              recommendation: fData.recommendation,
              numAnalysts: fData.numAnalysts,
              marketCap: fData.marketCap,
              volume: fData.volume,
              avgVolume: fData.avgVolume,
              dayHigh: fData.dayHigh,
              dayLow: fData.dayLow,
              beta: fData.beta,
              nextEarningsDate: fData.nextEarningsDate,
            });
          }
        }
        if (newsRes?.ok) {
          const nData = await newsRes.json();
          if (!cancelled && nData.news) {
            setNewsItems(nData.news);
          }
        }
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setSparklineLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isExpanded, pos.symbol]);

  // ── Sparkline interaction helpers ──
  const handleSparkHover = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!sparkline || !sparkSvgRef.current) return;
      const svg = sparkSvgRef.current;
      const rect = svg.getBoundingClientRect();
      const clientX =
        'touches' in e ? e.touches[0].clientX : e.clientX;
      const svgX = clientX - rect.left;
      const ratio = svgX / rect.width;
      if (ratio < 0 || ratio > 1) {
        setTooltip(null);
        return;
      }
      const pts = sparkline.points;
      const idx = Math.round(ratio * (pts.length - 1));
      const clamped = Math.max(0, Math.min(idx, pts.length - 1));
      const pt = pts[clamped];
      const date = new Date(pt.t * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: '2-digit',
      });
      setTooltip({ x: svgX, price: pt.c, date });
    },
    [sparkline]
  );
  const clearSparkTooltip = useCallback(() => setTooltip(null), []);

  // ── Derived values ──
  const currentPrice = pos.currentPrice ?? pos.avgCost;
  const costBasis = pos.totalCost ?? pos.qty * pos.avgCost;
  // Single source of truth: broker-authoritative open PnL when present.
  const totalPnL = pos.totalPnl ?? (currentPrice - pos.avgCost) * pos.qty;
  const totalPnLPct = pos.totalPnlPercent ?? (costBasis > 0 ? (totalPnL / costBasis) * 100 : 0);
  const hasToday = pos.dayChange != null && pos.dayChangePercent != null;
  const todayPnL = pos.dayChange ?? 0;
  const todayPnLPct = pos.dayChangePercent ?? 0;

  // Current price drives the per-lot Gain/Loss column — mirrors Position
  // Detail exactly (null when the quote is unusable → '—', never a fake 0).
  const lotCurrentPrice = pos.currentPrice ?? null;

  // Lot summary — derived from the reconstructed lots, same as Position Detail.
  const activeLots = getActiveLotCount(lots);
  const totalRemainingQty = getTotalRemainingQty(lots);
  const weightedAvgCost =
    totalRemainingQty > 0
      ? lots
          .filter((l) => l.remaining_qty > 0)
          .reduce((sum, l) => sum + l.remaining_qty * l.price_at_fill, 0) / totalRemainingQty
      : 0;
  const lotCount = activeLots;
  const showLotBadge = lotCount >= 2;
  const avgCostDisplay = lotCount >= 1 ? Math.round(weightedAvgCost * 100) / 100 : pos.avgCost;

  // Known lots only tell part of the story when shares predate the activity
  // window — never present the count as the whole position (verbatim from
  // Position Detail: `${knownLotsLabel}+`, or `1+` if no dated lots at all).
  const knownLotsLabel = formatFIFOLabel(activeLots, activeLots > 1);
  const fifoLabel = unknownStart
    ? knownLotsLabel
      ? `${knownLotsLabel}+`
      : '1+'
    : knownLotsLabel;
  // Collapsed pill count, e.g. "2+ lots" when the start is unknown.
  const lotBadgeCountLabel = unknownStart ? `${lotCount}+` : `${lotCount}`;

  // Is this in a basket? (Phase 4 pre-wire)
  const inBasket = !!basketContext;

  return (
    <div
      className="position-card-v3"
      style={inline
        ? {
            margin: 0,
            background: 'transparent',
            borderRadius: 0,
            border: 'none',
            overflow: 'visible',
          }
        : {
            margin: '0 14px 8px',
            background: 'var(--bg-card, #1a2235)',
            borderRadius: 16,
            border: isExpanded
              ? '1px solid rgba(34,211,238,0.35)'
              : '1px solid rgba(255,255,255,0.06)',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
          }}
    >
      {/* ── Compact Header Row ── */}
      {!inline && (
        <div
          className="pcv3-header"
          onClick={onToggleExpand}
          style={{
            padding: '12px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
        {/* Left side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {/* Checkbox (select mode) */}
          {showCheckbox && (
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
                  border: `2px solid ${isSelected ? '#22d3ee' : 'rgba(255,255,255,0.2)'}`,
                  background: isSelected ? '#22d3ee' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isSelected && (
                  <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>
                    ✓
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Symbol + qty */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '13.5px',
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                }}
              >
                {pos.symbol}
              </span>

              {/* Threshold-crossing badge: only rows with an ACTIVE crossing. */}
              <ThresholdBadgePill crossing={crossing} testId={`threshold-badge-${pos.symbol}`} />

              {/* Lot badge: only when 2+ active lots */}
              {showLotBadge && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'rgba(34,211,238,0.12)',
                    color: '#22d3ee',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {lotBadgeCountLabel} lots
                </span>
              )}

              {/* Basket context tag (Phase 4 pre-wire) */}
              {inBasket && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'rgba(179,137,240,0.12)',
                    color: 'var(--violet, #b389f0)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    lineHeight: 1.4,
                  }}
                >
                  Basket · {basketContext.basketName}
                </span>
              )}
            </div>
            {pos.name && pos.name !== pos.symbol && (
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50ch' }}>
                {pos.name}
              </div>
            )}
            <div style={{ fontSize: '11.5px', color: '#cbd5e1', marginTop: 1, fontWeight: 500 }}>
              {pos.qty % 1 === 0 ? pos.qty : pos.qty.toFixed(4)} shares
            </div>
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
                fontWeight: 700,
                fontSize: '12.5px',
                color: '#ffffff',
                fontFamily: 'var(--mono-font, monospace)',
              }}
            >
              ${currentPrice.toFixed(2)}
            </div>
            {/* Unavailable quote (no usable source) → explicit dash, NEVER a
                fabricated +0.00%. A genuinely flat day still renders +0.00%. */}
            <div
              data-testid="position-day-change"
              style={{
                fontSize: '9.5px',
                fontWeight: 600,
                color: !hasToday
                  ? 'var(--text-muted, #94a3b8)'
                  : (pos.dayChangePercent as number) >= 0
                    ? 'var(--gain, #10b981)'
                    : 'var(--loss, #ef4444)',
                marginTop: 1,
              }}
            >
              {!hasToday
                ? '—'
                : `${(pos.dayChangePercent as number) >= 0 ? '+' : ''}${(pos.dayChangePercent as number).toFixed(2)}%`}
            </div>
          </div>

          {/* Persistent chevron */}
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
      )}

      {/* ── Expanded Sections ── */}
      {(inline || isExpanded) && (
        <div
          style={inline
            ? {
                padding: '12px 0 0',
                borderTop: '1px solid rgba(179,137,240,0.12)',
              }
            : {
                padding: '0 14px 14px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: 12,
              }}
        >
          {/* ── 1. Lots & Cost Basis ── */}
          <div style={{ marginBottom: 14 }}>
            <div
              className="pcv3-section-label"
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--dim, #aab4c7)',
                letterSpacing: '0.04em',
                marginBottom: 8,
                textTransform: 'uppercase',
              }}
            >
              Lots &amp; Cost Basis
            </div>

            {/* Summary bar: Qty | Avg Cost | Lots */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 8,
                padding: '10px 12px',
                background: 'rgba(34,211,238,0.04)',
                borderRadius: 10,
                marginBottom: 10,
                border: '1px solid rgba(34,211,238,0.08)',
              }}
            >
              <div>
                <div style={{ fontSize: 9, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                  QTY
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#ffffff',
                    fontFamily: 'var(--mono-font, monospace)',
                  }}
                >
                  {pos.qty % 1 === 0 ? pos.qty : pos.qty.toFixed(4)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                  AVG COST
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#ffffff',
                    fontFamily: 'var(--mono-font, monospace)',
                  }}
                >
                  ${avgCostDisplay.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                  LOTS
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#22d3ee' }}>
                  {fifoLabel}
                </div>
              </div>
            </div>

            {/* Unknown-start disclosure — deliberately prominent, directly ABOVE
                the table (same placement/wording rules as Position Detail).
                Shares predating the broker's transaction history have no
                purchase date on file, so the lots below UNDERSTATE the
                position and must never be presented as the whole position. */}
            {unknownStart && (
              <div
                data-testid="position-card-unknown-start"
                style={{
                  padding: '10px 14px',
                  background: 'var(--v-warn-dim, rgba(251,191,36,0.10))',
                  border: '1px dashed var(--v-warn, #fbbf24)',
                  borderRadius: 10,
                  fontSize: 11.5,
                  color: 'var(--v-warn, #fbbf24)',
                  marginBottom: 10,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ {unknownStart.label}</div>
                <div style={{ color: '#cbd5e1' }}>
                  {fmtQty(unknownStart.sharesHeldBeforeWindow)} shares in this position were held before your broker&apos;s
                  transaction history begins
                  {windowStartDate
                    ? ` (${new Date(windowStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`
                    : ''}
                  , so they have no purchase date on file and the lots below understate the position.
                </div>
              </div>
            )}

            {/* Lot table */}
            {lotsLoading && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--faint, #8794a8)',
                  padding: '8px 0',
                }}
              >
                Loading lots…
              </div>
            )}
            {!lotsLoading && lotsError && (
              <div style={{ fontSize: 11, color: 'var(--loss, #ef4444)', padding: '8px 0' }}>
                {lotsError}
              </div>
            )}
            {!lotsLoading && !lotsError && lots.length > 0 && (
              <div
                data-testid="position-card-lots"
                style={{
                  background: 'rgba(30,41,59,0.40)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                {/* Table header — matches Position Detail exactly. */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '0.9fr 1fr 1.3fr 1.3fr 1.3fr',
                    gap: 4,
                    padding: '7px 10px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'var(--faint, #8794a8)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}
                >
                  <span>Qty</span>
                  <span>Fill</span>
                  <span>Cost basis</span>
                  <span>Date</span>
                  <span>Gain/Loss</span>
                </div>

                {lots.filter((l) => l.remaining_qty > 0).map((l) => {
                  // Same per-lot P&L the canonical Detail table computes.
                  const lotPnl =
                    lotCurrentPrice != null && Number.isFinite(lotCurrentPrice) && lotCurrentPrice > 0
                      ? l.remaining_qty * (lotCurrentPrice - l.price_at_fill)
                      : null;
                  const lotPnlColor =
                    lotPnl == null
                      ? 'var(--dim, #aab4c7)'
                      : lotPnl >= 0
                        ? 'var(--gain, #10b981)'
                        : 'var(--loss, #ef4444)';

                  return (
                    <div
                      key={l.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '0.9fr 1fr 1.3fr 1.3fr 1.3fr',
                        gap: 4,
                        padding: '9px 10px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        alignItems: 'center',
                        fontSize: 11,
                        color: '#cbd5e1',
                      }}
                    >
                      <span
                        style={{
                          color: '#ffffff',
                          fontWeight: 700,
                          fontFamily: 'var(--mono-font, monospace)',
                        }}
                      >
                        {fmtQty(l.remaining_qty)}
                      </span>
                      <span style={{ fontFamily: 'var(--mono-font, monospace)' }}>
                        {fmtDollar(l.price_at_fill)}
                      </span>
                      <span style={{ fontFamily: 'var(--mono-font, monospace)' }}>
                        {fmtDollar(l.remaining_qty * l.price_at_fill)}
                      </span>
                      <span>{formatLotDate(l.filled_at)}</span>
                      <span
                        style={{
                          fontWeight: 700,
                          fontFamily: 'var(--mono-font, monospace)',
                          color: lotPnlColor,
                        }}
                      >
                        {lotPnl == null
                          ? '—'
                          : `${lotPnl >= 0 ? '+' : '-'}$${Math.abs(lotPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Fallback only when there are genuinely no lots AND no disclosure
                to explain the gap. */}
            {!lotsLoading && !lotsError && lots.length === 0 && !unknownStart && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--faint, #8794a8)',
                  padding: '8px 0',
                  fontStyle: 'italic',
                }}
              >
                No lot data available for this position.
              </div>
            )}
          </div>

          {/* ── 2. Stat Block: AVG COST | INVESTED | MARKET VALUE ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '8px 24px',
              marginBottom: 12,
              padding: '8px 0',
              borderTop: '1px solid rgba(34,211,238,0.08)',
              borderBottom: '1px solid rgba(34,211,238,0.08)',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--dim, #aab4c7)',
                  marginBottom: 2,
                }}
              >
                AVG COST
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#ffffff',
                }}
              >
                ${pos.avgCost.toFixed(2)}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--dim, #aab4c7)',
                  marginBottom: 2,
                }}
              >
                INVESTED
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#ffffff',
                }}
              >
                ${costBasis.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--dim, #aab4c7)',
                  marginBottom: 2,
                }}
              >
                MARKET VALUE
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#ffffff',
                }}
              >
                ${pos.marketValue.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </div>
            </div>
          </div>

          {/* ── 3. TODAY / TOTAL Return Pills ── */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div
              className={`pcv3-pill ${hasToday ? gainLossClass(todayPnL) : ''}`}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                background: !hasToday
                  ? 'transparent'
                  : todayPnL >= 0
                    ? 'rgba(16,185,129,0.08)'
                    : 'rgba(239,68,68,0.08)',
                border: !hasToday
                  ? '1px solid var(--v-border, rgba(148,163,184,0.2))'
                  : todayPnL >= 0
                    ? '1px solid rgba(16,185,129,0.15)'
                    : '1px solid rgba(239,68,68,0.15)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim, #aab4c7)' }}>
                  TODAY
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: !hasToday
                      ? 'var(--dim, #aab4c7)'
                      : todayPnL >= 0
                        ? 'var(--gain, #10b981)'
                        : 'var(--loss, #ef4444)',
                    fontFamily: 'var(--mono-font, monospace)',
                  }}
                >
                  {hasToday
                    ? `${todayPnL >= 0 ? '+' : '-'}${Math.abs(todayPnLPct).toFixed(2)}% · ${todayPnL >= 0 ? '+' : '-'}$${Math.abs(todayPnL).toFixed(2)}`
                    : '—'}
                </span>
              </div>
            </div>

            <div
              className={`pcv3-pill ${gainLossClass(totalPnL)}`}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                background:
                  totalPnL >= 0
                    ? 'rgba(16,185,129,0.08)'
                    : 'rgba(239,68,68,0.08)',
                border:
                  totalPnL >= 0
                    ? '1px solid rgba(16,185,129,0.15)'
                    : '1px solid rgba(239,68,68,0.15)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim, #aab4c7)' }}>
                  TOTAL
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: totalPnL >= 0 ? 'var(--gain, #10b981)' : 'var(--loss, #ef4444)',
                    fontFamily: 'var(--mono-font, monospace)',
                  }}
                >
                  {(totalPnL >= 0 ? '+' : '-')}{Math.abs(totalPnLPct).toFixed(1)}% · {(totalPnL >= 0 ? '+' : '-')}${Math.abs(totalPnL).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* ── 4. 52-Week Sparkline (interactive) ── */}
          {sparkline && sparkline.points.length >= 2 && (() => {
            const pts = sparkline.points;
            const yMin = sparkline.low52w;
            const yMax = sparkline.high52w;
            const yRange = yMax - yMin || 1;
            const W = 300;
            const H = 80;
            const pad = 4;

            const scaleX = (i: number) =>
              pad + (i / (pts.length - 1)) * (W - pad * 2);
            const scaleY = (v: number) =>
              H - pad - ((v - yMin) / yRange) * (H - pad * 2);

            const linePath = pts
              .map(
                (pt, i) =>
                  `${i === 0 ? 'M' : 'L'}${scaleX(i)},${scaleY(pt.c)}`
              )
              .join(' ');
            const areaPath =
              linePath +
              ` L${scaleX(pts.length - 1)},${H - pad} L${scaleX(0)},${H - pad} Z`;

            const curX = scaleX(pts.length - 1);
            const curY = scaleY(currentPrice);
            const firstX = scaleX(0);
            const firstY = scaleY(pts[0].c);

            let hiIdx = 0,
              loIdx = 0;
            for (let i = 1; i < pts.length; i++) {
              if (pts[i].c > pts[hiIdx].c) hiIdx = i;
              if (pts[i].c < pts[loIdx].c) loIdx = i;
            }
            const hiX = scaleX(hiIdx);
            const hiY = scaleY(pts[hiIdx].c);
            const loX = scaleX(loIdx);
            const loY = scaleY(pts[loIdx].c);

            const tooltipSvgX = tooltip
              ? (tooltip.x /
                  (sparkSvgRef.current?.getBoundingClientRect().width || 1)) *
                W
              : null;
            const tooltipIdx = tooltip
              ? Math.round(
                  (tooltip.x /
                    (sparkSvgRef.current?.getBoundingClientRect().width || 1)) *
                    (pts.length - 1)
                )
              : null;
            const tooltipY =
              tooltipIdx != null
                ? scaleY(
                    pts[
                      Math.max(0, Math.min(tooltipIdx, pts.length - 1))
                    ].c
                  )
                : null;

            const gradId = `sparkGradV3-${pos.symbol.replace('.', '_')}`;

            return (
              <div style={{ marginBottom: 14, position: 'relative' }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--dim, #aab4c7)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  52-Week Price History
                </div>
                <svg
                  ref={sparkSvgRef}
                  viewBox={`0 0 ${W} ${H}`}
                  style={{
                    width: '100%',
                    height: 80,
                    display: 'block',
                    touchAction: 'none',
                  }}
                  onMouseMove={handleSparkHover}
                  onMouseLeave={clearSparkTooltip}
                  onTouchMove={(e) => {
                    e.preventDefault();
                    handleSparkHover(e);
                  }}
                  onTouchEnd={clearSparkTooltip}
                >
                  <path
                    d={areaPath}
                    fill={`url(#${gradId})`}
                    opacity={0.15}
                  />
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={hiX}
                    cy={hiY}
                    r={4}
                    fill="#22d3ee"
                    fillOpacity={0.3}
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                  />
                  <text
                    x={hiX}
                    y={hiY - 7}
                    textAnchor={hiIdx < pts.length / 2 ? 'start' : 'end'}
                    fill="#fbbf24"
                    fontSize={9}
                    fontWeight={600}
                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                  >
                    H ${pts[hiIdx].c.toFixed(2)}
                  </text>
                  <circle
                    cx={loX}
                    cy={loY}
                    r={4}
                    fill="#ef4444"
                    fillOpacity={0.3}
                    stroke="#ef4444"
                    strokeWidth={1.5}
                  />
                  <text
                    x={loX}
                    y={loY + 14}
                    textAnchor={loIdx < pts.length / 2 ? 'start' : 'end'}
                    fill="#ef4444"
                    fontSize={9}
                    fontWeight={600}
                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                  >
                    L ${pts[loIdx].c.toFixed(2)}
                  </text>
                  <rect
                    x={firstX - 2}
                    y={firstY - 22}
                    width={46}
                    height={16}
                    rx={4}
                    fill="rgba(10,15,30,0.85)"
                  />
                  <text
                    x={firstX + 5}
                    y={firstY - 10}
                    textAnchor="start"
                    fill="#cbd5e1"
                    fontSize={9}
                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                  >
                    ${pts[0].c.toFixed(2)}
                  </text>
                  {tooltipSvgX != null && tooltipY != null && (
                    <line
                      x1={tooltipSvgX}
                      y1={pad}
                      x2={tooltipSvgX}
                      y2={H - pad}
                      stroke="rgba(255,255,255,0.4)"
                      strokeWidth={0.5}
                      strokeDasharray="3 2"
                    />
                  )}
                  {tooltipSvgX != null && tooltipY != null && (
                    <circle
                      cx={tooltipSvgX}
                      cy={tooltipY}
                      r={3.5}
                      fill="#22d3ee"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  )}
                  <circle
                    cx={curX}
                    cy={curY}
                    r={3}
                    fill="#ffffff"
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                    opacity={tooltip ? 0.4 : 1}
                  />
                  <text
                    x={curX - 5}
                    y={curY - 6}
                    textAnchor="end"
                    fill="#ffffff"
                    fontSize={10}
                    fontWeight={700}
                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                  >
                    ${currentPrice.toFixed(2)}
                  </text>
                  <defs>
                    <linearGradient
                      id={gradId}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#22d3ee"
                        stopOpacity={0.4}
                      />
                      <stop
                        offset="100%"
                        stopColor="#22d3ee"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                </svg>
                {tooltip && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -42,
                      left: Math.max(
                        0,
                        Math.min(
                          tooltip.x - 50,
                          (sparkSvgRef.current?.getBoundingClientRect()
                            .width || 300) - 110
                        )
                      ),
                      background: 'rgba(15, 23, 42, 0.9)',
                      backdropFilter: 'blur(12px)',
                      WebkitBackdropFilter: 'blur(12px)',
                      border: '1px solid rgba(34, 211, 238, 0.3)',
                      borderRadius: 8,
                      padding: '4px 10px',
                      pointerEvents: 'none',
                      zIndex: 10,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div
                      style={{
                        color: '#22d3ee',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      ${tooltip.price.toFixed(2)}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 10 }}>
                      {tooltip.date}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: '#cbd5e1',
                    }}
                  >
                    Low ${sparkline.low52w.toFixed(2)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: '#cbd5e1',
                    }}
                  >
                    High ${sparkline.high52w.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* ── 5. Fundamentals Grid ── */}
          {fundamentals && (
            <div
              style={{
                marginBottom: 12,
                paddingTop: 10,
                borderTop: '1px solid rgba(34,211,238,0.08)',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--dim, #aab4c7)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                Fundamentals
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px 24px',
                }}
              >
                {fundamentals.marketCap != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      Mkt Cap
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      {fundamentals.marketCap >= 1e12
                        ? `$${(fundamentals.marketCap / 1e12).toFixed(2)}T`
                        : `$${(fundamentals.marketCap / 1e9).toFixed(1)}B`}
                    </div>
                  </div>
                )}
                {fundamentals.pe != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      P/E
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      {fundamentals.pe.toFixed(1)}
                    </div>
                  </div>
                )}
                {fundamentals.eps != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      EPS
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      ${fundamentals.eps.toFixed(2)}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                    Div Yield
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#22d3ee' }}>
                    {fundamentals.dividendYield != null && fundamentals.dividendYield > 0
                      ? `${fundamentals.dividendYield.toFixed(2)}%`
                      : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                    Div Amt
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#22d3ee' }}>
                    {fundamentals.dividendRate != null && fundamentals.dividendRate > 0
                      ? `$${fundamentals.dividendRate.toFixed(2)}/yr`
                      : '—'}
                  </div>
                </div>
                {fundamentals.recommendation ? (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      Analyst
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          textTransform: 'capitalize',
                          padding: '1px 8px',
                          borderRadius: 4,
                          color:
                            fundamentals.recommendation === 'buy' ||
                            fundamentals.recommendation === 'strong_buy'
                              ? '#10b981'
                              : fundamentals.recommendation === 'sell' ||
                                fundamentals.recommendation === 'strong_sell'
                              ? '#ef4444'
                              : '#fbbf24',
                          background:
                            fundamentals.recommendation === 'buy' ||
                            fundamentals.recommendation === 'strong_buy'
                              ? 'rgba(16,185,129,0.12)'
                              : fundamentals.recommendation === 'sell' ||
                                fundamentals.recommendation === 'strong_sell'
                              ? 'rgba(239,68,68,0.12)'
                              : 'rgba(251,191,36,0.12)',
                        }}
                      >
                        {fundamentals.recommendation.replace('_', ' ')}
                      </span>
                      {fundamentals.numAnalysts != null && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#ffffff' }}>
                          · {fundamentals.numAnalysts} analysts
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div />
                )}
              </div>

              {/* Additional metrics row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px 24px',
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                {fundamentals.dayHigh != null && fundamentals.dayLow != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      Day Range
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      ${fundamentals.dayLow.toFixed(2)} – ${fundamentals.dayHigh.toFixed(2)}
                    </div>
                  </div>
                )}
                {fundamentals.volume != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      Volume
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      {(fundamentals.volume / 1e6).toFixed(1)}M
                      {fundamentals.avgVolume != null && (
                        <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 400, marginLeft: 4 }}>
                          avg {(fundamentals.avgVolume / 1e6).toFixed(1)}M
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {fundamentals.beta != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      Beta
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      {fundamentals.beta.toFixed(2)}
                    </div>
                  </div>
                )}
                {fundamentals.nextEarningsDate && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint, #8794a8)', marginBottom: 2 }}>
                      Earnings
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      {new Date(
                        fundamentals.nextEarningsDate + 'T12:00:00'
                      ).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 6. Related News ── */}
          {newsItems.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                borderTop: '1px solid rgba(255,255,255,0.08)',
                paddingTop: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--dim, #aab4c7)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  Related News
                </div>
                <span
                  style={{
                    fontSize: 9,
                    color: 'rgba(255,255,255,0.40)',
                    fontStyle: 'italic',
                  }}
                >
                  Sentiment reflects article tone, not investment advice.
                </span>
              </div>
              <div
                style={{
                  background: 'rgba(30,41,59,0.60)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                {newsItems.map((item, i) => {
                  const daysAgo = item.pubDate
                    ? Math.round(
                        (Date.now() - new Date(item.pubDate).getTime()) /
                          (1000 * 60 * 60 * 24)
                      )
                    : null;
                  const timeLabel =
                    daysAgo != null
                      ? daysAgo === 0
                        ? 'Today'
                        : daysAgo === 1
                        ? '1d ago'
                        : `${daysAgo}d ago`
                      : '';
                  const sentColor =
                    item.sentiment?.label === 'positive'
                      ? 'var(--gain)'
                      : item.sentiment?.label === 'negative'
                      ? 'var(--loss)'
                      : 'var(--warning)';
                  const sentLabel = item.sentiment?.label
                    ? item.sentiment.label.charAt(0).toUpperCase() +
                      item.sentiment.label.slice(1)
                    : '';
                  return (
                    <a
                      key={i}
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'block',
                        textDecoration: 'none',
                        color: 'inherit',
                        padding: '10px 14px',
                        borderBottom:
                          i < newsItems.length - 1
                            ? '1px solid rgba(255,255,255,0.06)'
                            : 'none',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            color: '#ffffff',
                            fontWeight: 500,
                            lineHeight: 1.4,
                            marginBottom: 2,
                            flex: 1,
                          }}
                        >
                          {item.title}
                        </div>
                        {sentLabel && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              color: sentColor,
                              background:
                                item.sentiment?.label === 'positive'
                                  ? 'rgba(16,185,129,0.10)'
                                  : item.sentiment?.label === 'negative'
                                  ? 'rgba(239,68,68,0.10)'
                                  : 'rgba(245,158,11,0.10)',
                              border: `1px solid ${
                                item.sentiment?.label === 'positive'
                                  ? 'rgba(16,185,129,0.20)'
                                  : item.sentiment?.label === 'negative'
                                  ? 'rgba(239,68,68,0.20)'
                                  : 'rgba(245,158,11,0.20)'
                              }`,
                              borderRadius: 4,
                              padding: '1px 6px',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                              marginTop: 1,
                            }}
                          >
                            {sentLabel}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          fontSize: 10,
                          color: '#cbd5e1',
                        }}
                      >
                        <span>{item.publisher}</span>
                        {timeLabel && <span>{timeLabel}</span>}
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 7. Buy More / Sell Buttons ── */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBuy?.();
              }}
              style={{
                flex: 1,
                minHeight: 44,
                background: 'transparent',
                border: '1px solid rgba(34,211,238,0.35)',
                borderRadius: 12,
                color: 'var(--accent, #22d3ee)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Buy More
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // Sell hands the reconstructed lots to the trade ticket for
                // FIFO ordering / specific-lot DISCLOSURE only. The broker
                // sell endpoint is quantity-based and always applies FIFO —
                // it does NOT honour a hand-picked lot. Kept as-is so sell
                // semantics are unchanged.
                onSell?.(lots);
              }}
              style={{
                flex: 1,
                minHeight: 44,
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: 12,
                color: 'var(--loss, #ef4444)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Sell
            </button>
          </div>
        </div>
      )}
    </div>
  );
}