'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import { useAccounts } from '@/context/AccountContext';
import { useTabStore } from '@/store';
import type { Position, AccountSummary } from '@/types';
import { availableCash as computeAvailableCash } from '@/lib/available-cash';
import type { Basket } from '@/context/PortfolioContext';
import SellModal from './SellModal';
import BulkSellSheet from './BulkSellSheet';
import TradeTicket from './TradeTicket';
import BasketActionPanel from '@/components/basket/BasketActionPanel';
import BasketCard from './BasketCard';
import PortfolioChart from './PortfolioChart';
import PositionRow from './PositionRow';
import SectorAllocation from './SectorAllocation';
import AssetMixChart from './AssetMixChart';
import MarketOverview from '../shared/MarketOverview';
import { Masthead } from '@/components/layout/Masthead';
import { getStyleContent } from '@/lib/content/investor-styles';
import BasketBuyMoreTicket from '@/components/trade/BasketBuyMoreTicket';
import BasketSellTicket from '@/components/trade/BasketSellTicket';
import { apiGet } from '@/lib/api-client';
import { thresholdCrossings, computeThresholdCrossings } from '@/lib/insights/threshold-badge';
import type { AssetMix } from '@/lib/portfolio/sector-mix';

// ─── Helpers ──────────────────────────────────────────────

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const fmt = (n: number | null) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;

const pctStr = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** Holdings sort fields (Task 9, Part 4). `short` is what the collapsed
 *  control shows; `label` is the menu row. */
const SORT_OPTIONS = [
  { key: 'value', short: 'Value', label: 'Market Value' },
  { key: 'gainloss', short: 'Gain/Loss $', label: 'Gain/Loss ($)' },
  { key: 'pnl', short: 'P&L %', label: 'P&L (%)' },
  { key: 'qty', short: 'Qty', label: 'Quantity' },
  { key: 'alpha', short: 'A–Z', label: 'Alphabetical (ticker)' },
] as const;

const formatCurrency = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function splitCents(value: number): { dollars: string; cents: string } {
  const str = value.toLocaleString('en-US', DOLLAR_FMT);
  const parts = str.split('.');
  return { dollars: parts[0] || '0', cents: parts[1] || '00' };
}

// ─── Helpers ──────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// ─── Account Hero Card ────────────────────────────────────

function AccountHero({ account, isConnected }: { account: AccountSummary; isConnected: boolean }) {
  const { dollars, cents } = splitCents(account.equity);

  return (
    <div style={{ margin: '20px 20px 0' }} data-testid="balance-block">
      <div data-testid="balance-rule" style={{ borderTop: '2px solid var(--v-accent)', marginBottom: 12 }} />
      <div
        data-testid="balance-card"
        style={{
          background: 'var(--v-por-card)',
          border: '0.5px solid var(--v-card-border)',
          borderRadius: 16,
          padding: '16px 18px 18px',
        }}
      >
        {/* label row — orb + label, mirroring the Insights balance card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            aria-hidden="true"
            data-testid="balance-orb"
            style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--v-orb)', flexShrink: 0 }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)' }}>
            PORTFOLIO VALUE
          </span>
        </div>

        {/* balance — BOLD SANS (was italic serif) */}
        <div data-testid="balance-section" style={{ marginTop: 12 }}>
          <div>
            <span
              data-testid="balance-amount"
              style={{ fontFamily: 'var(--font-sans, Inter, sans-serif)', fontWeight: 800, letterSpacing: '-0.02em', fontSize: 44, color: 'var(--v-text-primary)', lineHeight: 1 }}
            >
              ${dollars}
            </span>
            <span style={{ fontFamily: 'var(--font-sans, Inter, sans-serif)', fontWeight: 700, fontSize: 26, color: 'var(--v-text-muted)' }}>
              .{cents}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
              Today{' '}
              {/* colour follows the REAL SIGN of THIS figure */}
              <span data-testid="today-figure" style={{ color: account.dayPnl == null ? 'var(--v-text-muted)' : account.dayPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 700 }}>
                {account.dayPnl == null ? '—' : `${fmt(account.dayPnl)} (${pctStr(account.dayPnlPercent)})`}
              </span>
            </span>
            <span style={{ color: 'var(--v-text-faint)', fontSize: 12 }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
              Total{' '}
              {/* independent of Today — loss-red whenever TOTAL is negative */}
              <span data-testid="total-figure" style={{ color: account.totalPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 700 }}>
                {fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Position Card ────────────────────────────────────────

function PositionCard({
  pos,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onBuy,
  onSell,
  showCheckbox = false,
  baskets = [],
}: {
  pos: Position;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onBuy?: () => void;
  onSell?: () => void;
  showCheckbox?: boolean;
  baskets?: Basket[];
}) {
  const currentPrice = pos.currentPrice ?? pos.avgCost;
  const totalPnL = (currentPrice - pos.avgCost) * pos.qty;
  const costBasis = pos.totalCost ?? pos.qty * pos.avgCost;
  const totalPnLPct = costBasis > 0 ? (totalPnL / costBasis) * 100 : 0;
  const hasToday = pos.dayChange != null && pos.dayChangePercent != null;
  const todayPnL = pos.dayChange ?? 0;
  const todayPnLPct = pos.dayChangePercent ?? 0;

  // ── Sparkline state ──
  const [sparkline, setSparkline] = useState<{ points: { t: number; c: number }[]; high52w: number; low52w: number } | null>(null);
  const [sparklineLoading, setSparklineLoading] = useState(false);
  const [fundamentals, setFundamentals] = useState<{
    eps: number|null; pe: number|null; dividendYield: number|null;
    dividendRate: number|null; recommendation: string|null;
    numAnalysts: number|null; marketCap: number|null;
    volume: number|null; avgVolume: number|null;
    dayHigh: number|null; dayLow: number|null;
    beta: number|null; nextEarningsDate: string|null;
  } | null>(null);
  const [newsItems, setNewsItems] = useState<{ title: string; link: string; publisher: string; pubDate: string; sentiment?: { label: 'positive' | 'negative' | 'neutral'; score: number } }[]>([]);
  const [newsLoaded, setNewsLoaded] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; price: number; date: string } | null>(null);
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
            setSparkline({ points: data.points, high52w: data.high52w, low52w: data.low52w });
          }
        }
        if (fundRes.ok) {
          const fData = await fundRes.json();
          if (!cancelled && fData.symbol) {
            setFundamentals({
              eps: fData.eps, pe: fData.pe, dividendYield: fData.dividendYield,
              dividendRate: fData.dividendRate, recommendation: fData.recommendation,
              numAnalysts: fData.numAnalysts, marketCap: fData.marketCap,
              volume: fData.volume, avgVolume: fData.avgVolume,
              dayHigh: fData.dayHigh, dayLow: fData.dayLow,
              beta: fData.beta, nextEarningsDate: fData.nextEarningsDate,
            });
          }
        }
        if (newsRes?.ok) {
          const nData = await newsRes.json();
          if (!cancelled && nData.news) {
            setNewsItems(nData.news);
            setNewsLoaded(true);
          }
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setSparklineLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [isExpanded, pos.symbol]);

  // ── Sparkline interaction helpers ──
  const handleSparkHover = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!sparkline || !sparkSvgRef.current) return;
    const svg = sparkSvgRef.current;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const svgX = clientX - rect.left;
    const ratio = svgX / rect.width;
    if (ratio < 0 || ratio > 1) { setTooltip(null); return; }
    const pts = sparkline.points;
    const idx = Math.round(ratio * (pts.length - 1));
    const clamped = Math.max(0, Math.min(idx, pts.length - 1));
    const pt = pts[clamped];
    const date = new Date(pt.t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    setTooltip({ x: svgX, price: pt.c, date });
  }, [sparkline]);
  const clearSparkTooltip = useCallback(() => setTooltip(null), []);

  const companyName = pos.name && pos.name !== pos.symbol ? pos.name : '';
  const gainLossClass = (pnl: number) => pnl > 0 ? 'gain' : pnl < 0 ? 'loss' : 'flat';

  return (
    <div className="position-card" style={{ margin: '0 14px 8px' }}>
      <div className="position-card-top" onClick={onToggleExpand} style={{ cursor: 'pointer' }}>
        <div className="position-card-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showCheckbox && (
              <div onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} style={{ flexShrink: 0 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 9,
                  border: `2px solid ${isSelected ? '#22d3ee' : 'rgba(255,255,255,0.2)'}`,
                  background: isSelected ? '#22d3ee' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                </div>
              </div>
            )}
            <span className="position-symbol">{pos.symbol}</span>
            {pos.type === 'ETF' && (
              <span style={{
                fontSize: 10, color: 'var(--accent)', flexShrink: 0,
                background: 'rgba(34,211,238,0.10)', border: '1px solid rgba(34,211,238,0.30)',
                borderRadius: 999, padding: '2px 8px', fontWeight: 600,
              }}>ETF</span>
            )}
            {companyName && <span className="position-company">{companyName}</span>}
          </div>
          <span className="position-qty">{pos.qty % 1 === 0 ? pos.qty : pos.qty.toFixed(4)} shares</span>
        </div>
        <div className="position-card-right">
          <span className="position-price">${currentPrice.toFixed(2)}</span>
          {hasToday ? (
            <span className={`position-change ${gainLossClass(pos.dayChangePercent as number)}`}>
              {(pos.dayChangePercent as number) >= 0 ? '+' : ''}{(pos.dayChangePercent as number).toFixed(2)}%
            </span>
          ) : (
            // No usable quote → explicit dash, never a fabricated +0.00%.
            <span className="position-change" style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </div>
      </div>

      {/* ── Cost/Value mini-stat grid ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
        gap: '8px 24px', margin: '6px 0 8px',
        padding: '8px 0',
        borderTop: '1px solid rgba(34,211,238,0.08)',
        borderBottom: '1px solid rgba(34,211,238,0.08)',
      }}>
        <div>
          <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>AVG COST</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
            ${(pos.avgCost ?? 0).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>INVESTED</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
            ${((pos.avgCost ?? 0) * pos.qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>MARKET VALUE</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
            ${pos.marketValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      <div className="position-card-bottom">
        <div className={`position-pill ${hasToday ? gainLossClass(todayPnL) : 'flat'}`}>
          <span className="pill-label">TODAY</span>
          {hasToday ? (
            <>
              <span className="pill-value">{todayPnL >= 0 ? '+' : ''}${Math.abs(todayPnL).toFixed(2)}</span>
              <span className="pill-pct">({todayPnL >= 0 ? '+' : ''}{Math.abs(todayPnLPct).toFixed(2)}%)</span>
            </>
          ) : (
            // No usable quote — explicit unavailable marker, never a fake $0.00.
            <span className="pill-value">—</span>
          )}
        </div>
        <div className={`position-pill ${gainLossClass(totalPnL)}`}>
          <span className="pill-label">TOTAL</span>
          <span className="pill-value">{totalPnL >= 0 ? '+' : ''}${Math.abs(totalPnL).toFixed(2)}</span>
          <span className="pill-pct">({totalPnL >= 0 ? '+' : ''}{Math.abs(totalPnLPct).toFixed(1)}%)</span>
        </div>
      </div>

      {/* ── 52-Week Sparkline (interactive) ── */}
      {isExpanded && sparkline && sparkline.points.length >= 2 && (() => {
        const pts = sparkline.points;
        const labelHigh = sparkline.high52w;
        const labelLow = sparkline.low52w;
        const yMin = labelLow;
        const yMax = labelHigh;
        const yRange = yMax - yMin || 1;
        const W = 300;
        const H = 80;
        const pad = 4;

        const scaleX = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
        const scaleY = (v: number) => H - pad - ((v - yMin) / yRange) * (H - pad * 2);

        const linePath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i)},${scaleY(pt.c)}`).join(' ');
        const areaPath = linePath + ` L${scaleX(pts.length - 1)},${H - pad} L${scaleX(0)},${H - pad} Z`;

        const curX = scaleX(pts.length - 1);
        const curY = scaleY(currentPrice);
        const firstX = scaleX(0);
        const firstY = scaleY(pts[0].c);

        // Find exact high/low points along the line
        let hiIdx = 0, loIdx = 0;
        for (let i = 1; i < pts.length; i++) {
          if (pts[i].c > pts[hiIdx].c) hiIdx = i;
          if (pts[i].c < pts[loIdx].c) loIdx = i;
        }
        const hiX = scaleX(hiIdx);
        const hiY = scaleY(pts[hiIdx].c);
        const loX = scaleX(loIdx);
        const loY = scaleY(pts[loIdx].c);

        // Tooltip indicator line X in SVG coords
        const tooltipSvgX = tooltip ? (tooltip.x / (sparkSvgRef.current?.getBoundingClientRect().width || 1)) * W : null;
        const tooltipIdx = tooltip ? Math.round((tooltip.x / (sparkSvgRef.current?.getBoundingClientRect().width || 1)) * (pts.length - 1)) : null;
        const tooltipY = tooltipIdx != null ? scaleY(pts[Math.max(0, Math.min(tooltipIdx, pts.length - 1))].c) : null;

        const gradId = `sparkGrad-${pos.symbol.replace('.','_')}`;

        return (
          <div style={{ marginTop: 12, position: 'relative' }}>
            {/* Chart header */}
            <div className="section-label" style={{ fontSize: 10, marginBottom: 6 }}>52-Week Price History</div>
            <svg
              ref={sparkSvgRef}
              viewBox={`0 0 ${W} ${H}`}
              style={{ width: '100%', height: 80, display: 'block', touchAction: 'none' }}
              onMouseMove={handleSparkHover}
              onMouseLeave={clearSparkTooltip}
              onTouchMove={(e) => { e.preventDefault(); handleSparkHover(e); }}
              onTouchEnd={clearSparkTooltip}
            >
              {/* Area fill */}
              <path d={areaPath} fill={`url(#${gradId})`} opacity={0.15} />
              {/* Line */}
              <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              {/* 52W High marker */}
              <circle cx={hiX} cy={hiY} r={4} fill="#22d3ee" fillOpacity={0.3} stroke="#22d3ee" strokeWidth={1.5} />
              <text x={hiX} y={hiY - 7} textAnchor={hiIdx < pts.length / 2 ? 'start' : 'end'} fill="#fbbf24" fontSize={9} fontWeight={600} style={{ fontFamily: 'var(--font-mono, monospace)' }}>H ${pts[hiIdx].c.toFixed(2)}</text>
              {/* 52W Low marker */}
              <circle cx={loX} cy={loY} r={4} fill="#ef4444" fillOpacity={0.3} stroke="#ef4444" strokeWidth={1.5} />
              <text x={loX} y={loY + 14} textAnchor={loIdx < pts.length / 2 ? 'start' : 'end'} fill="#ef4444" fontSize={9} fontWeight={600} style={{ fontFamily: 'var(--font-mono, monospace)' }}>L ${pts[loIdx].c.toFixed(2)}</text>
              {/* First price label — positioned above line with bg pill to avoid overlap */}
              <rect x={firstX - 2} y={firstY - 22} width={46} height={16} rx={4} fill="rgba(10,15,30,0.85)" />
              <text x={firstX + 5} y={firstY - 10} textAnchor="start" fill="#cbd5e1" fontSize={9} style={{ fontFamily: 'var(--font-mono, monospace)' }}>${pts[0].c.toFixed(2)}</text>
              {/* Tooltip vertical line */}
              {tooltipSvgX != null && tooltipY != null && (
                <line x1={tooltipSvgX} y1={pad} x2={tooltipSvgX} y2={H - pad} stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} strokeDasharray="3 2" />
              )}
              {/* Tooltip dot */}
              {tooltipSvgX != null && tooltipY != null && (
                <circle cx={tooltipSvgX} cy={tooltipY} r={3.5} fill="#22d3ee" stroke="#ffffff" strokeWidth={1.5} />
              )}
              {/* Current price dot + label — positioned left of point to avoid clipping */}
              <circle cx={curX} cy={curY} r={3} fill="#ffffff" stroke="#22d3ee" strokeWidth={1.5} opacity={tooltip ? 0.4 : 1} />
              <text x={curX - 5} y={curY - 6} textAnchor="end" fill="#ffffff" fontSize={10} fontWeight={700} style={{ fontFamily: 'var(--font-mono, monospace)' }}>${currentPrice.toFixed(2)}</text>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
            </svg>
            {/* Tooltip — frosted glass */}
            {tooltip && (
              <div style={{
                position: 'absolute',
                top: -42,
                left: Math.max(0, Math.min(tooltip.x - 50, (sparkSvgRef.current?.getBoundingClientRect().width || 300) - 110)),
                background: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(34, 211, 238, 0.3)',
                borderRadius: 8,
                padding: '4px 10px',
                pointerEvents: 'none',
                zIndex: 10,
                whiteSpace: 'nowrap',
              }}>
                <div style={{ color: '#22d3ee', fontSize: 12, fontWeight: 600 }}>${tooltip.price.toFixed(2)}</div>
                <div style={{ color: '#94a3b8', fontSize: 10 }}>{tooltip.date}</div>
              </div>
            )}
            {/* Labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'var(--font-sans)' }}>
                Low ${labelLow.toFixed(2)}
              </span>
              <span style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'var(--font-sans)' }}>
                High ${labelHigh.toFixed(2)}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Basket references */}
      {baskets.filter(b => b.positions.some(p => p.symbol === pos.symbol && p.status === 'active')).map(b => (
        <span key={b.id} style={{
          fontSize: 10, color: 'var(--accent)', opacity: 0.7, display: 'block', marginTop: 4,
        }}>
          Also in: {b.name}
        </span>
      ))}

      {/* PENDING BASKET badge */}
      {baskets.filter(b => b.positions.some(p => p.symbol === pos.symbol && p.status === 'pending')).length > 0 && (
        <span className="pill" style={{
          display: 'inline-block', marginTop: 6,
          padding: '3px 8px',
          background: 'rgba(245,158,11,0.12)',
          border: '1px solid rgba(245,158,11,0.25)',
          color: 'var(--warning)',
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: 11,
        }}>
          PENDING
        </span>
      )}

      {/* Expanded section */}
      {isExpanded && (
        <div style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {/* ── Metadata — label-above-value 2-col grid ── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '8px 24px', marginBottom: 12,
          }}>
            {/* Symbol */}
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Symbol</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>{pos.symbol}</div>
            </div>
            {/* Name — right of Symbol, no truncation */}
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Name</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)', lineHeight: 1.35 }}>
                {pos.name || '—'}
              </div>
            </div>
            {/* Sector — left col */}
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Sector</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)', lineHeight: 1.35 }}>
                {pos.sector || '—'}
              </div>
            </div>
            {/* Asset Type — right col, aligned with Sector */}
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Asset Type</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                {pos.type || 'Stock'}
              </div>
            </div>
          </div>

          {/* ── Fundamentals grid — 2-col label-above-value ── */}
          {fundamentals && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: '8px 24px', marginBottom: 12, paddingTop: 10,
              borderTop: '1px solid rgba(34,211,238,0.08)',
            }}>
              {fundamentals.marketCap != null && (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Mkt Cap</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                    {fundamentals.marketCap >= 1e12
                      ? `$${(fundamentals.marketCap / 1e12).toFixed(2)}T`
                      : `$${(fundamentals.marketCap / 1e9).toFixed(1)}B`}
                  </div>
                </div>
              )}
              {fundamentals.pe != null ? (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>P/E</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                    {fundamentals.pe.toFixed(1)}
                  </div>
                </div>
              ) : <div />}
              {fundamentals.eps != null ? (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>EPS</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                    ${fundamentals.eps.toFixed(2)}
                  </div>
                </div>
              ) : <div />}
              <div>
                <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Div Yield</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#22d3ee', fontFamily: 'var(--font-sans)' }}>
                  {fundamentals.dividendYield != null && fundamentals.dividendYield > 0
                    ? `${fundamentals.dividendYield.toFixed(2)}%`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Div Amt</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#22d3ee', fontFamily: 'var(--font-sans)' }}>
                  {fundamentals.dividendRate != null && fundamentals.dividendRate > 0
                    ? `$${fundamentals.dividendRate.toFixed(2)}/yr`
                    : '—'}
                </div>
              </div>
              {fundamentals.recommendation ? (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Analyst</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, textTransform: 'capitalize',
                      padding: '1px 8px', borderRadius: 4,
                      color: fundamentals.recommendation === 'buy' || fundamentals.recommendation === 'strong_buy' ? '#10b981'
                           : fundamentals.recommendation === 'sell' || fundamentals.recommendation === 'strong_sell' ? '#ef4444'
                           : '#fbbf24',
                      background: fundamentals.recommendation === 'buy' || fundamentals.recommendation === 'strong_buy' ? 'rgba(16,185,129,0.12)'
                                 : fundamentals.recommendation === 'sell' || fundamentals.recommendation === 'strong_sell' ? 'rgba(239,68,68,0.12)'
                                 : 'rgba(251,191,36,0.12)',
                    }}>
                      {fundamentals.recommendation.replace('_', ' ')}
                    </span>
                    {fundamentals.numAnalysts != null && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#ffffff' }}>
                        · {fundamentals.numAnalysts} analysts
                      </span>
                    )}
                  </div>
                </div>
              ) : <div />}
            </div>
          )}

          {/* ── Additional metrics grid ── */}
          {fundamentals && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: '8px 24px', marginBottom: 12, paddingTop: 10,
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
              {fundamentals.dayHigh != null && fundamentals.dayLow != null ? (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Day Range</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                    ${fundamentals.dayLow.toFixed(2)} – ${fundamentals.dayHigh.toFixed(2)}
                  </div>
                </div>
              ) : <div />}
              {fundamentals.volume != null ? (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Volume</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                    {(fundamentals.volume / 1e6).toFixed(1)}M
                    {fundamentals.avgVolume != null && (
                      <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 400, marginLeft: 4 }}>
                        avg {(fundamentals.avgVolume / 1e6).toFixed(1)}M
                      </span>
                    )}
                  </div>
                </div>
              ) : <div />}
              {fundamentals.beta != null ? (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Beta</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                    {fundamentals.beta.toFixed(2)}
                  </div>
                </div>
              ) : <div />}
              {fundamentals.nextEarningsDate ? (
                <div>
                  <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Earnings</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                    {new Date(fundamentals.nextEarningsDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              ) : <div />}
            </div>
          )}

          {/* ── Related News ── */}
          {newsItems.length > 0 && (
            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.08)',
              paddingTop: 14, marginBottom: 12,
              marginTop: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="section-label" style={{ fontSize: 10 }}>Related News</div>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.40)', fontStyle: 'italic' }}>
                  Sentiment reflects article tone, not investment advice.
                </span>
              </div>
              <div style={{
                background: 'rgba(30,41,59,0.60)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10,
                overflow: 'hidden',
              }}>
              {newsItems.map((item, i) => {
                const daysAgo = item.pubDate
                  ? Math.round((Date.now() - new Date(item.pubDate).getTime()) / (1000 * 60 * 60 * 24))
                  : null;
                const timeLabel = daysAgo != null
                  ? daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`
                  : '';
                const sentColor = item.sentiment?.label === 'positive' ? 'var(--gain)'
                  : item.sentiment?.label === 'negative' ? 'var(--loss)'
                  : 'var(--warning)';
                const sentLabel = item.sentiment?.label
                  ? item.sentiment.label.charAt(0).toUpperCase() + item.sentiment.label.slice(1)
                  : '';
                return (
                  <a
                    key={i}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block', textDecoration: 'none', color: 'inherit',
                      padding: '10px 14px',
                      borderBottom: i < newsItems.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ fontSize: 12, color: '#ffffff', fontWeight: 500, lineHeight: 1.4, marginBottom: 2, flex: 1 }}>
                        {item.title}
                      </div>
                      {sentLabel && (
                        <span style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: sentColor,
                          background: item.sentiment?.label === 'positive' ? 'rgba(16,185,129,0.10)'
                            : item.sentiment?.label === 'negative' ? 'rgba(239,68,68,0.10)'
                            : 'rgba(245,158,11,0.10)',
                          border: `1px solid ${item.sentiment?.label === 'positive' ? 'rgba(16,185,129,0.20)'
                            : item.sentiment?.label === 'negative' ? 'rgba(239,68,68,0.20)'
                            : 'rgba(245,158,11,0.20)'}`,
                          borderRadius: 4,
                          padding: '1px 6px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          marginTop: 1,
                        }}>
                          {sentLabel}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#cbd5e1' }}>
                      <span>{item.publisher}</span>
                      {timeLabel && <span>{timeLabel}</span>}
                    </div>
                  </a>
                );
              })}
              </div>
            </div>
          )}

          {/* Financial grid */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: 12,
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px 24px',
          }}>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Avg Cost</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                ${pos.avgCost.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Current Price</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                ${currentPrice.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Quantity</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                {pos.qty % 1 === 0 ? pos.qty : pos.qty.toFixed(4)}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Cost Basis</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                ${costBasis.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{
            display: 'flex', gap: 10, marginTop: 12,
          }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                console.log('[BUY] clicked', pos.symbol);
                if (typeof onBuy !== 'function') {
                  console.error('[BUY] onBuy is not a function:', typeof onBuy, onBuy);
                  return;
                }
                onBuy();
                console.log('[BUY] onBuy called successfully');
              }}
              style={{
                flex: 1, minHeight: 44,
                background: 'transparent',
                border: '1px solid rgba(34,211,238,0.35)',
                borderRadius: 12, color: 'var(--accent)',
                fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Buy More
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSell?.(); }}
              style={{
                flex: 1, minHeight: 44,
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: 12, color: 'var(--loss)',
                fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14,
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

// ─── Buying Power Card ──────────────────────────────────

function BuyingPowerCard({ account, invested }: { account: AccountSummary; invested: number }) {
  // Two rows of two — prevents the 4-across layout from clipping Invested.
  const cells: Array<{ label: string; value: string; color?: string }> = [
    { label: 'CASH', value: formatCurrency(computeAvailableCash(account)) },
    { label: 'RESERVED', value: formatCurrency(account.reservedCash ?? 0), color: 'var(--v-hero-warn)' },
    { label: 'BUYING POWER', value: account.buyingPower != null ? formatCurrency(account.buyingPower) : '—' },
    { label: 'INVESTED', value: formatCurrency(invested) },
  ];
  return (
    <div style={{ padding: '0 20px 16px' }} data-testid="holdings-stats">
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px 16px',
        padding: 16,
        background: 'var(--v-card)',
        border: '0.5px solid var(--v-card-border)',
        borderRadius: 16,
      }}>
        {cells.map((c) => (
          <div key={c.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--v-text-muted)', fontFamily: 'var(--font-sans)', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.label}</div>
            <div style={{
              fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, color: c.color ?? 'var(--v-text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main PortfolioTab ───────────────────────────────────

export function PortfolioTab() {
  const [filter, setFilter] = useState('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // ── Sort (Task 9, Part 4) ──
  // The chip row above is FILTERS (All/Gainers/Losers). Sorting is a separate
  // control: one dropdown (which field) + one direction toggle (asc/desc).
  const [sortKey, setSortKey] = useState<'value' | 'gainloss' | 'pnl' | 'qty' | 'alpha'>('value');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [sortOpen, setSortOpen] = useState(false);

  // Decomposed sector mix + asset mix (Parts 1 & 2) and the user's own
  // target-return/-loss thresholds (Part 6 badges).
  const [assetMix, setAssetMix] = useState<AssetMix | null>(null);
  const [targetThresholds, setTargetThresholds] = useState<{
    targetReturnPct: number | null;
    targetLossPct: number | null;
  }>({ targetReturnPct: null, targetLossPct: null });
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  // Bulk sell is a two-step action: select -> confirm sheet (with FIFO
  // disclosure) -> execute. It used to fire at the broker on the first tap.
  const [bulkSellOpen, setBulkSellOpen] = useState(false);
  const [expandedBasketIds, setExpandedBasketIds] = useState<Set<string>>(new Set());
  const [tradeTicket, setTradeTicket] = useState<{
    symbol: string; side: 'BUY' | 'SELL'; currentPrice: number;
    sharesHeld: number; availableCash: number;
    lots?: import('@/lib/fifo-engine').Lot[];
  } | null>(null);

  // Phase 6: Basket-level trade tickets
  const [basketBuyMoreTicket, setBasketBuyMoreTicket] = useState<{
    basketId: string;
  } | null>(null);
  const [basketSellTicket, setBasketSellTicket] = useState<{
    basketId: string;
  } | null>(null);

  const { account: brokerAccount, accountScope: brokerScope, loading: brokerLoading, error: brokerError } = usePortfolio();
  const { account: liveAccount, accountScope: liveScope, loading: liveLoading, baskets, executeTrade, sellBasketPositions, refresh: refreshContext, brokerMeta } = useLivePortfolio();
  const { isConnected } = useBroker();
  const { activeAccount, activeAccountId } = useAccounts();
  const { user } = useAuth();
  const { focusPosition, setFocusPosition, openPositionDetail, tradeRequest, clearTradeRequest, setTab, setPendingPrompt, setChatOpen } = useTabStore();

  // Hard boundary: Demo must NEVER show broker data. Scope data source by active account.
  const isShowingDemo = activeAccount?.isDemo ?? false;
  // Read-only = live broker connection without trading access (demo is always full).
  const isReadOnly = !isShowingDemo && !(activeAccount?.tradingEnabled ?? false);

  const isBrokerExpected = isConnected && !isShowingDemo;

  // ── TRACE diagnostic ──
  useEffect(() => {
    console.error('[PortfolioTab]', JSON.stringify({
      isConnected, isShowingDemo, isBrokerExpected,
      activeAccountId: activeAccount?.id || 'none',
      brokerLoading, liveLoading,
      brokerEquity: brokerAccount?.equity ?? 'null',
      brokerPos: brokerAccount?.positions?.length ?? 0,
      liveEquity: liveAccount?.equity ?? 'null',
      livePos: liveAccount?.positions?.length ?? 0,
      brokerErr: brokerError || 'none',
    }));
  }, [isConnected, isShowingDemo, activeAccount, brokerLoading, liveLoading, brokerAccount, liveAccount, brokerError]);

  // PART 2 — SCOPE GATE: only accept a resolved account that was fetched for the
  // SELECTED account id. An id mismatch means the store still holds the previous
  // account's real numbers → treat as unresolved (spinner), never display them.
  const displayAccount = isBrokerExpected
    ? (brokerScope === (activeAccountId ?? null) ? (brokerAccount as AccountSummary | null) : null)
    : (liveScope === (activeAccountId ?? null) ? (liveAccount as AccountSummary | null) : null);
  const loading = isBrokerExpected ? brokerLoading : liveLoading;

  const positions: Position[] = displayAccount?.positions || [];

  // Account / broker labels for the shared <Masthead/> (same as Insights).
  const accountName = isShowingDemo ? 'Demo' : brokerMeta?.name || activeAccount?.name || 'Broker';
  const brokerLabel = (
    isShowingDemo ? 'Demo' : brokerMeta?.broker || brokerMeta?.name || activeAccount?.name || 'Broker'
  ).toUpperCase();
  const dotColor = isShowingDemo ? 'var(--v-admin-label)' : isConnected ? 'var(--v-gain)' : 'var(--v-text-faint)';
  const investorStyle = (user?.investorStyle as string | undefined) || 'buffett';
  const styleLabel = getStyleContent(investorStyle).shortLabel;

  // ALL active notices — used for the inline threshold badges below.
  const [noticedAll, setNoticedAll] = useState<any[]>([]);
  const fetchTopNoticed = useCallback(async () => {
    try {
      const res = await apiGet(`/api/ai/noticed?accountId=${encodeURIComponent(activeAccountId || 'demo')}`);
      if (res.ok) {
        const data = await res.json();
        setNoticedAll(data.items || []);
      }
    } catch { /* ignore */ }
  }, [activeAccountId]);
  useEffect(() => { fetchTopNoticed(); }, [fetchTopNoticed]);

  // User's own target-return/-loss thresholds — the badge ladder honours them
  // exactly like the trigger engine does (null = default ladder).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet('/api/user/preferences');
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setTargetThresholds({
          targetReturnPct: typeof j?.target_return_pct === 'number' ? j.target_return_pct : null,
          targetLossPct: typeof j?.target_loss_pct === 'number' ? j.target_loss_pct : null,
        });
      } catch { /* default ladder */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Threshold crossings → inline badges on the affected position rows ──
  // Computed further down, once `displayPositions` exists (it is declared
  // later in this component — a useMemo here would hit the TDZ).

  // ── Cross-tab focus → the ONE canonical Position Detail overlay ──
  // Any legacy REVIEW_POSITION caller that still sets focusPosition lands in the
  // same full-screen detail every other entry point opens.
  useEffect(() => {
    if (!focusPosition) return;
    openPositionDetail(focusPosition, 'portfolio');
    setFocusPosition(null);
  }, [focusPosition, openPositionDetail, setFocusPosition]);

  // ── Buy More / Sell raised from the Position Detail overlay ──
  useEffect(() => {
    if (!tradeRequest) return;
    const pos = positions.find((p: any) => (p.symbol || '').toUpperCase() === tradeRequest.symbol.toUpperCase());
    if (!pos) return; // positions not resolved yet — retry on next positions change
    setTradeTicket({
      symbol: pos.symbol,
      side: tradeRequest.side,
      currentPrice: pos.currentPrice ?? pos.avgCost,
      sharesHeld: pos.qty,
      availableCash: tradeRequest.side === 'BUY' ? computeAvailableCash(displayAccount) : 0,
    });
    clearTradeRequest();
  }, [tradeRequest, positions, displayAccount, clearTradeRequest]);

  // Hydrate missing company names + sectors from API.
  // NOTE (Task 9, Part 2): this feeds the decomposed sector chart. Firing all
  // ~25 profile lookups in parallel made the upstream provider rate-limit, some
  // lookups silently failed, and those positions fell into the chart's "Other"
  // bucket (the sector mix then differed between otherwise identical loads).
  // Bounded concurrency + one retry keeps the mix deterministic.
  const [enrichedPositions, setEnrichedPositions] = useState<Position[]>(positions);
  useEffect(() => {
    let cancelled = false;
    const HYDRATE_CONCURRENCY = 4;
    async function fetchProfile(symbol: string): Promise<any | null> {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(`/api/company/profile?symbol=${encodeURIComponent(symbol)}`);
          if (r.ok) {
            const j = await r.json();
            if (j && !j.error) return j;
          }
        } catch { /* retry below */ }
        await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
      }
      return null;
    }
    async function hydrateNames() {
      const needsName = positions.filter(p => !p.name || p.name === p.symbol);
      const needsSector = positions.filter(p => !p.sector);
      if (needsName.length === 0 && needsSector.length === 0) {
        setEnrichedPositions(positions);
        return;
      }
      const updated = [...positions];
      for (let i = 0; i < positions.length; i += HYDRATE_CONCURRENCY) {
        if (cancelled) return;
        const chunk = positions.slice(i, i + HYDRATE_CONCURRENCY);
        const results = await Promise.allSettled(chunk.map(p => fetchProfile(p.symbol)));
        results.forEach((r, j) => {
          const result = r.status === 'fulfilled' ? r.value : null;
          if (!result || cancelled) return;
          const idx = updated.findIndex(p => p.symbol === chunk[j].symbol);
          if (idx < 0) return;
          if (result.name && (!updated[idx].name || updated[idx].name === updated[idx].symbol)) {
            updated[idx] = { ...updated[idx], name: result.name };
          }
          if (result.sector && !updated[idx].sector) {
            updated[idx] = { ...updated[idx], sector: result.sector };
          }
        });
      }
      if (!cancelled) setEnrichedPositions(updated);
    }
    hydrateNames();
    return () => { cancelled = true; };
  }, [positions.map(p => p.symbol).join(',')]);


  const toggleExpand = (symbol: string) => {
    setExpandedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const toggleSelect = (symbol: string) => {
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const cancelSelect = () => {
    setSelectMode(false);
    setSelectedSymbols(new Set());
  };

  // ── Bulk sell: the confirmation sheet resolves the selection into concrete
  // targets; this only runs once the user has confirmed there.
  // Declared as function declarations (hoisted) so they can live above the
  // `displayPositions` / `baskets` bindings — the bodies only run after render. ──
  function computeBulkSellItems() {
    const out: { symbol: string; qty: number; price: number }[] = [];
    selectedSymbols.forEach(s => {
      if (s.startsWith('basket:')) return;
      const pos = displayPositions.find((p: Position) => p.symbol === s);
      if (pos) out.push({ symbol: pos.symbol, qty: pos.qty, price: pos.currentPrice ?? pos.avgCost });
    });
    return out;
  }

  function computeBulkSellBaskets() {
    const out: { id: string; name: string; symbols: string[] }[] = [];
    selectedSymbols.forEach(s => {
      if (!s.startsWith('basket:')) return;
      const bid = s.replace('basket:', '');
      const basket = baskets.find((b: Basket) => b.id === bid);
      if (basket) {
        out.push({
          id: basket.id,
          name: basket.name,
          symbols: basket.positions.filter(p => p.status === 'active').map(p => p.symbol),
        });
      }
    });
    return out;
  }

  const runBulkSell = async () => {
    for (const item of computeBulkSellItems()) {
      try {
        await executeTrade(item.symbol, 'SELL', item.qty, item.price);
      } catch { /* continue */ }
    }

    for (const basket of computeBulkSellBaskets()) {
      if (basket.symbols.length > 0) {
        try {
          await sellBasketPositions(basket.id, basket.symbols);
        } catch { /* continue */ }
      }
    }

    setBulkSellOpen(false);
    refreshContext?.();
    cancelSelect();
  };

  // ── Derived values ──
  const displayPositions = enrichedPositions.length > 0 ? enrichedPositions : positions;

  // Symbol → hydrated company name (used to enrich basket position rows).
  const nameBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of enrichedPositions) {
      if (p.name && p.name !== p.symbol) m.set(p.symbol, p.name);
    }
    return m;
  }, [enrichedPositions]);

  // Invested = sum of per-position MARKET VALUE. Broker-authoritative when present
  // (Position.marketValue), falling back to price×qty only for transient demo rows.
  // Used solely for the Cash/Reserved/Invested invariant. Equity/Today/Total are
  // read from `accountData` (single source of truth) — never re-summed here.
  const investedValue = displayPositions.reduce((acc: number, p: Position) => acc + (p.marketValue || p.qty * (p.currentPrice || p.avgCost)), 0);

  // Demo-only fallbacks (only reached while the demo account is still loading).
  // Demo genuinely starts at $100K, so these are correct for the demo path only.
  const demoTotalCost = displayPositions.reduce((acc: number, p: Position) => acc + p.qty * p.avgCost, 0);
  const demoCashBalance = Math.max(0, 100000 - demoTotalCost);
  const demoEquity = investedValue + demoCashBalance;
  const demoTodayPnL = displayPositions.reduce((acc: number, p: Position) => acc + (p.dayChange || 0), 0);

  const filteredPositions = useMemo(() => {
    const calcPnL = (p: Position) =>
      p.currentPrice
        ? (p.currentPrice - p.avgCost) * p.qty
        : 0;

    const base =
      filter === 'gainers' ? displayPositions.filter(p => calcPnL(p) >= 0)
      : filter === 'losers' ? displayPositions.filter(p => calcPnL(p) < 0)
      : displayPositions;

    // ── Sort (Task 9, Part 4) ──
    // Applied to whatever the filter left. The direction toggle is shared by
    // every key, so "lowest P&L first" is one tap, not a separate option.
    const val = (p: Position) => p.marketValue || p.qty * (p.currentPrice || p.avgCost) || 0;
    const qty = (p: Position) => p.qty || 0;
    const pnlPct = (p: Position) => {
      if (p.totalPnlPercent != null) return p.totalPnlPercent;
      const cb = p.totalCost ?? p.qty * p.avgCost;
      return cb > 0 ? (calcPnL(p) / cb) * 100 : 0;
    };
    const keyed: Array<[Position, number | string]> = base.map((p) => {
      switch (sortKey) {
        case 'alpha': return [p, (p.symbol || '').toUpperCase()];
        case 'qty': return [p, qty(p)];
        case 'pnl': return [p, pnlPct(p)];
        case 'gainloss': return [p, calcPnL(p)];
        default: return [p, val(p)];
      }
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return keyed
      .slice()
      .sort((a, b) => {
        if (typeof a[1] === 'string' || typeof b[1] === 'string') {
          const cmp = String(a[1]).localeCompare(String(b[1]));
          return dir * cmp;
        }
        const av = a[1] as number;
        const bv = b[1] as number;
        if (av === bv) return 0;
        return av < bv ? -dir : dir;
      })
      .map(([p]) => p);
  }, [displayPositions, filter, sortKey, sortDir]);

  // ── Threshold crossings → inline badges on the affected position rows ──
  // Crossings used to be list items; they belong next to the position instead.
  // Symbols without an active crossing simply have no entry (no badge).
  //
  // Source of truth = the LIVE position P&L % measured against the SAME band
  // ladder the Noticed trigger engine uses (lib/noticed/bands.ts). The noticed
  // feed is layered underneath for provenance (it can still contribute an
  // event id) but it is no longer the only input: its rows get `resolved` once
  // fired, which is why the badges had disappeared entirely.
  const crossings = useMemo(
    () => ({
      ...thresholdCrossings(noticedAll),
      ...computeThresholdCrossings(displayPositions, targetThresholds),
    }),
    [noticedAll, displayPositions, targetThresholds],
  );

  // ── Asset mix + decomposed sector mix (Parts 1 & 2) ──
  // ETF sector weights are resolved server-side (Yahoo topHoldings, 7-day
  // cache) — never guessed here. Until it lands, the charts fall back to the
  // positions' own sectors.
  useEffect(() => {
    const payload = displayPositions
      .map((p: Position) => ({
        symbol: p.symbol,
        sector: p.sector ?? null,
        value: p.marketValue || p.qty * (p.currentPrice || p.avgCost) || 0,
      }))
      .filter((p) => p.symbol && p.value > 0);
    if (payload.length === 0) {
      setAssetMix(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portfolio/sector-mix', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positions: payload }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as AssetMix;
        if (!cancelled && data && typeof data.total === 'number') setAssetMix(data);
      } catch { /* fallback to raw sectors */ }
    })();
    return () => { cancelled = true; };
  }, [displayPositions]);

  // Fallback: if broker expected but not loaded yet, show zeroes (loading skeleton)
  // If demo, use computed demo numbers ($100K starting capital)
  const accountData: AccountSummary = displayAccount || (isBrokerExpected ? {
    // Real account, broker data still loading → honest "unavailable" skeleton.
    equity: 0,
    cash: 0,
    buyingPower: null,
    dayPnl: 0,
    dayPnlPercent: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    positions: [],
  } : isShowingDemo ? {
    // Genuinely demo → demo numbers. buyingPower = cash (no margin concept).
    equity: demoEquity,
    cash: demoCashBalance,
    buyingPower: demoCashBalance,
    dayPnl: demoTodayPnL,
    dayPnlPercent: demoEquity > 0 ? (demoTodayPnL / demoEquity) * 100 : 0,
    totalPnl: demoEquity - 100000,
    totalPnlPercent: ((demoEquity - 100000) / 100000) * 100,
    positions: displayPositions,
  } : {
    // Neither broker-expected nor demo → never substitute another account's data.
    equity: 0,
    cash: 0,
    buyingPower: null,
    dayPnl: 0,
    dayPnlPercent: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    positions: [],
  });

  // ── Loading / Error states ──
  if (loading) {
    return (
      <div style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ marginTop: 16, color: '#9ca3af', fontSize: 14 }}>Loading portfolio data…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (brokerError && isBrokerExpected) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <p style={{ fontSize: 16, fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>Failed to load broker data</p>
        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>{brokerError}</p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '8px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 24, background: 'var(--v-canvas)', minHeight: '100%' }}>
      {/* ── 0. Shared masthead (SAME component Insights uses) ── */}
      <Masthead
        accountName={accountName}
        brokerLabel={brokerLabel}
        dotColor={dotColor}
        isReadOnly={isReadOnly}
        styleLabel={styleLabel}
        onStyleClick={() => setTab('settings')}
        testIds={{
          masthead: 'holdings-masthead',
          rule: 'holdings-masthead-rule',
          header: 'holdings-header',
          wordmark: 'masthead-wordmark',
          account: 'masthead-account',
        }}
      />

      {/* ── 1. Balance block (bold sans) ── */}
      <AccountHero account={accountData} isConnected={isBrokerExpected} />

      {/* ── 3. Portfolio Chart ── */}
      <div style={{ padding: '0 20px 16px' }}>
        <PortfolioChart
          positions={positions.map((p) => ({
            symbol: p.symbol,
            shares: p.qty,
            buyDate: p.buyDate,
            avgCost: p.avgCost,
            totalCost: p.totalCost || p.qty * p.avgCost,
          }))}
          cashBalance={displayAccount?.cash ?? 0}
        />
      </div>

      {/* ── 4. Cash / Reserved / Buying Power / Invested ── */}
      <BuyingPowerCard account={accountData} invested={investedValue} />

      {/* ── 4b. Asset mix — ETFs vs individual stocks (structure) ── */}
      <AssetMixChart mix={assetMix} />

      {/* ── 4c. Sector Allocation (ETF exposure decomposed) ── */}
      <SectorAllocation positions={positions} mix={assetMix} />

      {/* ── 5. Market Overview ── */}
      <MarketOverview />

      {/* ── 6. Positions ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 20px 12px',
      }}>
        <h2 className="section-header" style={{ padding: 0, color: 'var(--v-text-primary)' }}>
          Positions
        </h2>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Filter chips — All / Gainers / Losers (replaces the All+dropdown) */}
          <div data-testid="filter-chips" style={{ display: 'flex', gap: 6 }}>
            {([
              { key: 'all', label: 'All' },
              { key: 'gainers', label: 'Gainers' },
              { key: 'losers', label: 'Losers' },
            ] as const).map(({ key, label }) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  data-testid={`filter-chip-${key}`}
                  data-active={active ? 'true' : undefined}
                  onClick={() => setFilter(key)}
                  style={{
                    padding: '6px 12px', borderRadius: 999,
                    background: active ? 'var(--v-accent)' : 'transparent',
                    border: active ? '1px solid var(--v-accent)' : '1px solid var(--v-card-border)',
                    color: active ? 'var(--v-accent-text)' : 'var(--v-text-secondary)',
                    fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Sort — a separate control from the filter chips: which field, and
              which direction. Value/Gain-Loss are option #1 and #2; both
              directions work for every field. */}
          {!showFilterDropdown && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                data-testid="sort-toggle"
                data-sort-key={sortKey}
                data-sort-dir={sortDir}
                onClick={() => setSortOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={sortOpen}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '6px 10px', borderRadius: 999,
                  background: 'transparent', border: '1px solid var(--v-card-border)',
                  color: 'var(--v-text-secondary)',
                  fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {SORT_OPTIONS.find((o) => o.key === sortKey)?.short}
                <span aria-hidden="true" style={{ fontSize: 10 }}>{sortDir === 'desc' ? '\u2193' : '\u2191'}</span>
              </button>

              {sortOpen && (
                <>
                  {/* Click-away catcher */}
                  <div
                    data-testid="sort-scrim"
                    onClick={() => setSortOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 60 }}
                  />
                  <div
                    data-testid="sort-menu"
                    role="listbox"
                    style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 61,
                      minWidth: 210, padding: 6,
                      background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)',
                      borderRadius: 12, boxShadow: '0 10px 28px rgba(16,24,43,0.18)',
                    }}
                  >
                    {SORT_OPTIONS.map((o) => {
                      const active = o.key === sortKey;
                      return (
                        <button
                          key={o.key}
                          type="button"
                          data-testid={`sort-option-${o.key}`}
                          data-active={active ? 'true' : undefined}
                          role="option"
                          aria-selected={active}
                          onClick={() => { setSortKey(o.key); setSortOpen(false); }}
                          style={{
                            display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                            padding: '9px 10px', borderRadius: 8, border: 'none',
                            background: active ? 'var(--v-accent-dim)' : 'transparent',
                            color: active ? 'var(--v-accent-label)' : 'var(--v-text-secondary)',
                            fontFamily: 'var(--font-sans)', fontWeight: active ? 700 : 600, fontSize: 13,
                            cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          <span>{o.label}</span>
                          {active && <span aria-hidden="true" style={{ fontSize: 11 }}>{sortDir === 'desc' ? '\u2193' : '\u2191'}</span>}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      data-testid="sort-direction"
                      onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                      style={{
                        display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                        marginTop: 4, padding: '9px 10px', borderRadius: 8,
                        border: 'none', borderTop: '1px solid var(--v-card-border)',
                        background: 'transparent', color: 'var(--v-text-secondary)',
                        fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13,
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span>Direction</span>
                      <span style={{ fontWeight: 700, color: 'var(--v-text-primary)' }}>
                        {sortDir === 'desc' ? 'High → Low ↓' : 'Low → High ↑'}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Select mode — a MODE toggle, not a filter. Demoted to a text link so the
              chip row reads purely as All / Gainers / Losers. Hidden entirely on
              read-only connections: the only thing it enables is selling. */}
          {!isReadOnly && (
          <button
            type="button"
            data-testid="select-toggle"
            onClick={() => {
              if (selectMode) cancelSelect();
              else setSelectMode(true);
            }}
            style={{
              padding: 0, background: 'transparent', border: 'none',
              marginLeft: 8,
              color: 'var(--v-accent-label)',
              fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12,
              cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
          )}
        </div>
      </div>

      {/* ── Unified Holdings + Baskets ── */}
      {(() => {
        // Group filtered positions: which belong to baskets?
        const basketSymbolMap = new Map<string, string>(); // symbol → basketId
        baskets.forEach(b => b.positions.forEach(p => {
          if (p.status === 'active') basketSymbolMap.set(p.symbol, b.id);
        }));

        // ── Compute basket groups from positions with basketId (not in context baskets) ──
        // This is the SAME grouping logic Order History uses (Part 2) —
        // positions carry basketId from order_history, grouping them into ONE basket row.
        const coveredBasketIds = new Set(baskets.map(b => b.id));
        const positionBasketIdSet = new Set<string>();
        filteredPositions.forEach((pos: any) => {
          if (pos.basketId && !coveredBasketIds.has(pos.basketId)) {
            positionBasketIdSet.add(pos.basketId);
          }
        });

        const positionBasketGroups: any[] = Array.from(positionBasketIdSet).map(basketId => {
          const groupPositions = filteredPositions.filter((p: any) => p.basketId === basketId);
          const firstPos = groupPositions[0];
          const totalCost = groupPositions.reduce((s: number, p: any) => s + (p.avgCost || 0) * (p.qty || 0), 0);
          const marketValue = groupPositions.reduce((s: number, p: any) => s + (p.marketValue || 0), 0);
          const totalPnl = marketValue - totalCost;
          const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

          // Register symbols for exclusion from individual position list
          groupPositions.forEach(p => basketSymbolMap.set(p.symbol, basketId));

          return {
            id: basketId,
            userId: '',
            name: firstPos.basketName || 'Basket',
            emoji: firstPos.basketEmoji || '🧺',
            theme: '',
            positions: groupPositions.map(p => {
              const costBasis = (p.avgCost || 0) * (p.qty || 0);
              const pnl = p.totalPnl ?? ((p.marketValue || 0) - costBasis);
              const pnlPct = p.totalPnlPercent ?? (costBasis > 0 ? (pnl / costBasis) * 100 : 0);
              return {
                symbol: p.symbol,
                shares: p.qty || 0,
                avgCost: p.avgCost || 0,
                currentPrice: p.currentPrice || p.avgCost || 0,
                status: 'active' as const,
                marketValue: p.marketValue || 0,
                totalPnL: pnl,
                totalPnLPct: pnlPct,
                allocationPct: totalCost > 0 ? (((p.avgCost || 0) * (p.qty || 0)) / totalCost) * 100 : 0,
                name: p.name || p.symbol,
                sector: p.sector || '',
              };
            }),
            totalCost,
            marketValue,
            totalPnL: totalPnl,  // match rendering key 'totalPnL'
            totalPnLPct: totalPnlPct,  // match rendering key 'totalPnLPct'
            activeCount: groupPositions.length,
            status: 'active' as const,
            created_at: (firstPos as any).submittedAt || (firstPos as any).createdAt || '',
            filled_at: (firstPos as any).submittedAt || (firstPos as any).createdAt || '',
          };
        });

        // Filter out closed/liquidated baskets (Phase 4 Part D)
        const activeBaskets = baskets.filter(
          (b: Basket) => b.status !== 'closed' && (b as any).status !== 'liquidated'
        );

        // Combine context baskets + position-based basket groups into one render list
        const allBasketRows = [...activeBaskets, ...positionBasketGroups];

        const hasBasketsOrPositions = allBasketRows.length > 0 || filteredPositions.length > 0;
        if (!hasBasketsOrPositions) {
          const isUnavailable = accountData?.holdingsUnavailable || false;
          return (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
              {isUnavailable ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171', marginBottom: 4 }}>
                    Holdings Unavailable
                  </div>
                  <div style={{ fontSize: 11, maxWidth: 280, margin: '0 auto' }}>
                    Your broker did not return position data. This may happen during maintenance windows
                    or if your account type restricts third-party data access.
                  </div>
                </>
              ) : filter !== 'all' ? (
                'No positions match this filter'
              ) : (
                'No positions yet'
              )}
            </div>
          );
        }

        return (
          <>
            {/* Render baskets interleaved with positions (Phase 4: BasketCard) */}
            {allBasketRows.map((basket: any) => {
              const isExpanded = expandedBasketIds.has(basket.id);

              return (
                <BasketCard
                  key={`basket-${basket.id}`}
                  basket={{
                    id: basket.id,
                    name: basket.name,
                    emoji: basket.emoji || '🧺',
                    positions: basket.positions.map((p: any) => ({
                      symbol: p.symbol,
                      shares: p.shares,
                      avgCost: p.avgCost,
                      currentPrice: p.currentPrice || p.avgCost,
                      allocationPct: p.allocationPct || 0,
                      marketValue: p.marketValue,
                      totalPnL: p.totalPnL,
                      totalPnLPct: p.totalPnLPct,
                      dailyPnL: p.dailyPnL ?? 0,
                      dailyPnLPct: p.dailyPnLPct ?? 0,
                      name: nameBySymbol.get(p.symbol) || p.name || p.symbol,
                      status: p.status,
                      sector: p.sector,
                    })),
                    totalCost: basket.totalCost,
                    marketValue: basket.marketValue,
                    totalPnL: basket.totalPnL,
                    totalPnLPct: basket.totalPnLPct,
                    dailyPnL: basket.dailyPnL ?? 0,
                    dailyPnLPct: basket.dailyPnLPct ?? 0,
                    activeCount: basket.activeCount,
                    status: basket.status,
                  }}
                  userId={(user?.id as string) || undefined}
                  crossings={crossings}
                  isExpanded={isExpanded}
                  isSelected={selectedSymbols.has(`basket:${basket.id}`)}
                  selectMode={selectMode}
                  onToggleExpand={() => {
                    setExpandedBasketIds(prev => {
                      const next = new Set(prev);
                      if (next.has(basket.id)) next.delete(basket.id);
                      else next.add(basket.id);
                      return next;
                    });
                  }}
                  onToggleSelect={() => {
                    setSelectedSymbols(prev => {
                      const next = new Set(prev);
                      const key = `basket:${basket.id}`;
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  onBuy={async () => {
                    // Phase 6: Open basket-level Buy More ticket
                    setBasketBuyMoreTicket({ basketId: basket.id });
                  }}
                  onSell={async () => {
                    // Phase 6: Open basket-level Sell ticket
                    setBasketSellTicket({ basketId: basket.id });
                  }}
                  onBuyTicker={(ticker) => {
                    setTradeTicket({
                      symbol: ticker.symbol,
                      side: 'BUY',
                      currentPrice: ticker.currentPrice ?? ticker.avgCost,
                      sharesHeld: ticker.shares,
                      availableCash: computeAvailableCash(displayAccount),
                    });
                  }}
                  onSellTicker={(ticker, lots) => {
                    setTradeTicket({
                      symbol: ticker.symbol,
                      side: 'SELL',
                      currentPrice: ticker.currentPrice ?? ticker.avgCost,
                      sharesHeld: ticker.shares,
                      availableCash: 0,
                      lots,
                    });
                  }}
                  connectionId={null}
                />
              );
            })}

            {/* Individual stocks NOT in any basket — one card, tap → canonical detail */}
            {filteredPositions.filter((pos: any) => !basketSymbolMap.has(pos.symbol)).length > 0 && (
              <div
                data-testid="positions-list"
                style={{ margin: '0 20px', background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 16, overflow: 'hidden' }}
              >
                {filteredPositions
                  .filter((pos: any) => !basketSymbolMap.has(pos.symbol))
                  .map((pos: any) => (
                    <PositionRow
                      key={pos.symbol}
                      pos={pos}
                      crossing={crossings[pos.symbol?.toUpperCase()] || null}
                      selectMode={selectMode}
                      isSelected={selectedSymbols.has(pos.symbol)}
                      onToggleSelect={() => toggleSelect(pos.symbol)}
                      onOpen={() => openPositionDetail(pos.symbol, 'portfolio')}
                    />
                  ))}
              </div>
            )}

            {/* No items at all */}
            {allBasketRows.length === 0 && filteredPositions.filter((pos: any) => !basketSymbolMap.has(pos.symbol)).length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
                No positions yet
              </div>
            )}
          </>
        );
      })()}

      {/* Basket sell flow moved to shared BasketActionPanel component */}

      {/* ── Trade Ticket (standalone position) ── */}
      <TradeTicket
        isOpen={tradeTicket !== null}
        onClose={() => setTradeTicket(null)}
        symbol={tradeTicket?.symbol || ''}
        side={tradeTicket?.side || 'BUY'}
        currentPrice={tradeTicket?.currentPrice || 0}
        sharesHeld={tradeTicket?.sharesHeld || 0}
        availableCash={tradeTicket?.availableCash || 0}
        lots={tradeTicket?.lots || []}
        variant="manual"
        onConfirm={async (params) => {
          if (!tradeTicket) return;
          const price = tradeTicket.currentPrice;
          const result = await executeTrade(
            tradeTicket.symbol,
            tradeTicket.side,
            params.shares,
            price,
            params.type,
            params.stopPrice,
            params.limitPrice,
            params.timeInForce
          );
          if (!result.success) {
            throw new Error(result.error || 'Order failed');
          }
          setTradeTicket(null);
        }}
      />

      {/* ── Basket Buy More Ticket (Phase 6) ── */}
      {(() => {
        if (!basketBuyMoreTicket) return null;
        const basketData = baskets.find(b => b.id === basketBuyMoreTicket.basketId);
        if (!basketData) return null;

        return (
          <BasketBuyMoreTicket
            isOpen={true}
            onClose={() => setBasketBuyMoreTicket(null)}
            basket={{
              id: basketData.id,
              name: basketData.name,
              emoji: basketData.emoji || '🧺',
              positions: basketData.positions
                .filter(p => p.status === 'active')
                .map(p => ({
                  symbol: p.symbol,
                  qty: p.shares,
                  avgCost: p.avgCost,
                  currentPrice: p.currentPrice || p.avgCost,
                })),
            }}
            onConfirm={async (orders) => {
              for (const order of orders) {
                await executeTrade(order.symbol, 'BUY', order.shares, order.estimatedCost / order.shares, undefined, undefined, undefined, undefined, basketBuyMoreTicket.basketId);
              }
              refreshContext?.();
              setBasketBuyMoreTicket(null);
            }}
            availableCash={computeAvailableCash(displayAccount)}
          />
        );
      })()}

      {/* ── Basket Sell Ticket (Phase 6) ── */}
      {(() => {
        if (!basketSellTicket) return null;
        const basketData = baskets.find(b => b.id === basketSellTicket.basketId);
        if (!basketData) return null;

        const positionsWithLots = basketData.positions
          .filter(p => p.status === 'active')
          .map(p => ({
            symbol: p.symbol,
            qty: p.shares,
            avgCost: p.avgCost,
            currentPrice: p.currentPrice || p.avgCost,
            lots: [] as any[],
          }));

        return (
          <BasketSellTicket
            isOpen={true}
            onClose={() => setBasketSellTicket(null)}
            basket={{
              id: basketData.id,
              name: basketData.name,
              emoji: basketData.emoji || '🧺',
              positions: positionsWithLots,
            }}
            onConfirmSellByQty={async (orders) => {
              for (const order of orders) {
                const pos = basketData.positions.find(p => p.symbol === order.symbol);
                const price = pos?.currentPrice || pos?.avgCost || 0;
                await executeTrade(order.symbol, 'SELL', order.shares, price);
              }
              refreshContext?.();
              setBasketSellTicket(null);
            }}
            onConfirmSellAll={async () => {
              const activeSymbols = basketData.positions
                .filter(p => p.status === 'active')
                .map(p => p.symbol);
              if (activeSymbols.length > 0) {
                await sellBasketPositions(basketData.id, activeSymbols);
                refreshContext?.();
              }
              setBasketSellTicket(null);
            }}
            userId={(user?.id as string) || undefined}
            connectionId={null}
          />
        );
      })()}

      {/* ── Select Mode Action Bar ── */}
      {!isReadOnly && selectMode && selectedSymbols.size > 0 && (
        <div style={{
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
        }}>
          <span style={{
            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
            fontFamily: 'var(--font-sans)',
          }}>
            {selectedSymbols.size} selected
          </span>
          <button
            data-testid="bulk-sell-open"
            onClick={() => setBulkSellOpen(true)}
            style={{
              padding: '8px 20px', borderRadius: 10,
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', fontSize: 13, fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            Sell Selected
          </button>
        </div>
      )}

      {/* ── Bulk sell confirmation (holds the FIFO disclosure) ── */}
      {bulkSellOpen && (
        <BulkSellSheet
          items={computeBulkSellItems()}
          baskets={computeBulkSellBaskets()}
          onClose={() => setBulkSellOpen(false)}
          onConfirm={runBulkSell}
        />
      )}

    </div>
  );
}
