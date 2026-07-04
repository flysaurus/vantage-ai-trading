'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import type { Position, AccountSummary } from '@/types';
import type { Basket } from '@/context/PortfolioContext';
import { getCompanyProfile } from '@/lib/market-data';
import SellModal from './SellModal';
import TradeTicket from './TradeTicket';
import PortfolioChart from './PortfolioChart';
import MarketOverview from '../shared/MarketOverview';

// ─── Helpers ──────────────────────────────────────────────

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const fmt = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;

const pctStr = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

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

// ─── Account Hero Card ────────────────────────────────────

function AccountHero({ account, isConnected }: { account: AccountSummary; isConnected: boolean }) {
  const { dollars, cents } = splitCents(account.equity);
  return (
    <div className="hero-container" style={{ position: 'relative' }}>
      {/* DEMO MODE badge */}
      {!isConnected && (
        <span className="hero-demo-badge">DEMO MODE</span>
      )}

      {/* Label */}
      <div className="hero-label">Account Value</div>

      {/* Hero number */}
      <div>
        <span className="hero-value">${dollars}</span>
        <span className="hero-cents">.{cents}</span>
      </div>

      {/* P&L row */}
      <div className="hero-pnl-row">
        <div>
          <div className="hero-pnl-item-label">Today</div>
          <div
            className="hero-pnl-item-value"
            style={{ color: account.dayPnl >= 0 ? 'var(--gain)' : 'var(--loss)' }}
          >
            {fmt(account.dayPnl)} ({pctStr(account.dayPnlPercent)})
          </div>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>·</span>
        <div>
          <div className="hero-pnl-item-label">Total</div>
          <div
            className="hero-pnl-item-value"
            style={{ color: account.totalPnl >= 0 ? 'var(--gain)' : 'var(--loss)' }}
          >
            {fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})
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
  const [newsItems, setNewsItems] = useState<{ title: string; link: string; publisher: string; pubDate: string }[]>([]);
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
          <span className={`position-change ${gainLossClass(pos.dayChangePercent ?? 0)}`}>
            {(pos.dayChangePercent ?? 0) >= 0 ? '+' : ''}{(pos.dayChangePercent ?? 0).toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="position-card-bottom">
        <div className={`position-pill ${gainLossClass(todayPnL)}`}>
          <span className="pill-label">TODAY</span>
          <span className="pill-value">{todayPnL >= 0 ? '+' : ''}${Math.abs(todayPnL).toFixed(2)}</span>
          <span className="pill-pct">({todayPnL >= 0 ? '+' : ''}{Math.abs(todayPnLPct).toFixed(2)}%)</span>
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
          Also in: {b.emoji} {b.name}
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
            {/* Sector */}
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Sector</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)', lineHeight: 1.35 }}>
                {pos.sector || '—'}
              </div>
            </div>
            {/* Name — left col, no truncation */}
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Name</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)', lineHeight: 1.35 }}>
                {pos.name || '—'}
              </div>
            </div>
            {/* Asset Type — right col, aligned with Name */}
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
              borderTop: '1px solid rgba(255,255,255,0.06)',
              paddingTop: 12, marginBottom: 12,
            }}>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 8 }}>Related News</div>
              <div style={{
                background: 'rgba(15,23,42,0.50)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8,
                overflow: 'hidden',
              }}>
              {newsItems.map((item, i) => {
                const daysAgo = item.pubDate
                  ? Math.round((Date.now() - new Date(item.pubDate).getTime()) / (1000 * 60 * 60 * 24))
                  : null;
                const timeLabel = daysAgo != null
                  ? daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`
                  : '';
                return (
                  <a
                    key={i}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block', textDecoration: 'none', color: 'inherit',
                      padding: '8px 12px',
                      borderBottom: i < newsItems.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}
                  >
                    <div style={{ fontSize: 12, color: '#ffffff', fontWeight: 500, lineHeight: 1.4, marginBottom: 2 }}>
                      {item.title}
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
              onClick={onBuy}
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
              onClick={onSell}
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
  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 12,
        padding: 16,
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 16,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.5, color: '#e2e8f0', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>CASH</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
            ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.5, color: '#e2e8f0', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>INVESTED</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
            ${invested.toLocaleString('en-US', DOLLAR_FMT)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Portfolio Summary Sticky Footer ──────────────────────

function PortfolioFooter({
  totalMarketValue,
  totalTodayPnL,
  totalTotalPnL,
  totalTotalPnLPct,
}: {
  totalMarketValue: number;
  totalTodayPnL: number;
  totalTotalPnL: number;
  totalTotalPnLPct: number;
}) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: 'rgba(10,15,30,0.95)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '12px 20px',
      paddingBottom: 'calc(12px + env(safe-area-inset-bottom) + 64px)',
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
    }}>
      {/* Market Value */}
      <div style={{ textAlign: 'center' }}>
        <div className="section-label" style={{ fontSize: 10, letterSpacing: '0.08em', marginBottom: 2 }}>
          Market Value
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, color: '#ffffff',
        }}>
          {totalMarketValue >= 10000
            ? `$${(totalMarketValue / 1000).toFixed(1)}K`
            : `$${totalMarketValue.toFixed(0)}`}
        </div>
      </div>

      {/* Today P&L */}
      <div style={{ textAlign: 'center' }}>
        <div className="section-label" style={{ fontSize: 10, letterSpacing: '0.08em', marginBottom: 2 }}>
          Today
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16,
          color: totalTodayPnL >= 0 ? 'var(--gain)' : 'var(--loss)',
        }}>
          {totalTodayPnL >= 0 ? '+' : ''}
          {Math.abs(totalTodayPnL) >= 10000
            ? `$${(Math.abs(totalTodayPnL) / 1000).toFixed(1)}K`
            : `$${Math.abs(totalTodayPnL).toFixed(0)}`}
        </div>
      </div>

      {/* Total P&L */}
      <div style={{ textAlign: 'center' }}>
        <div className="section-label" style={{ fontSize: 10, letterSpacing: '0.08em', marginBottom: 2 }}>
          Total
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16,
          color: totalTotalPnL >= 0 ? 'var(--gain)' : 'var(--loss)',
        }}>
          {totalTotalPnL >= 0 ? '+' : ''}
          {Math.abs(totalTotalPnL) >= 10000
            ? `$${(Math.abs(totalTotalPnL) / 1000).toFixed(1)}K`
            : `$${Math.abs(totalTotalPnL).toFixed(0)}`}
          {' '}
          <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.7 }}>
            ({totalTotalPnLPct >= 0 ? '+' : ''}{totalTotalPnLPct.toFixed(1)}%)
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Pending Basket Card ─────────────────────────────────

function PendingBasketCard({ basket }: { basket: Basket }) {
  const positionCount = basket.activeCount || basket.positionCount || 0;
  const reserved = basket.positions
    ?.filter((p) => p.status === 'pending')
    .reduce((acc: number, p) => acc + (p.reservedAmount || p.totalCost || 0), 0) || 0;
  return (
    <div className="card-frost" style={{ margin: '0 16px 10px', padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{
          fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: '#ffffff',
        }}>
          {basket.emoji} {basket.name || 'Basket'}
        </span>
        <span className="pill" style={{
          padding: '3px 8px',
          background: 'rgba(245,158,11,0.15)',
          color: '#f59e0b',
          fontFamily: 'var(--font-sans)',
          fontWeight: 700,
          fontSize: 10,
        }}>
          PENDING
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 4 }}>
        ⏳ {basket.nextOpenLabel || 'awaiting market open'}
      </div>
      <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>
        {positionCount} positions · ${reserved.toFixed(2)} reserved
      </div>
    </div>
  );
}

// ─── Main PortfolioTab ───────────────────────────────────

export function PortfolioTab() {
  const [filter, setFilter] = useState('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [tradeTicket, setTradeTicket] = useState<{
    symbol: string; side: 'BUY' | 'SELL'; currentPrice: number;
    sharesHeld: number; availableCash: number;
  } | null>(null);

  const { account: brokerAccount, loading: brokerLoading } = usePortfolio();
  const { account: liveAccount, loading: liveLoading, baskets, pendingBaskets, executeTrade } = useLivePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();

  const displayAccount = isConnected
    ? (brokerAccount as AccountSummary | null)
    : (liveAccount as AccountSummary | null);
  const loading = isConnected ? brokerLoading : liveLoading;
  const positions: Position[] = displayAccount?.positions || [];

  // Hydrate missing company names from Finnhub
  const [enrichedPositions, setEnrichedPositions] = useState<Position[]>(positions);
  useEffect(() => {
    let cancelled = false;
    async function hydrateNames() {
      const needsName = positions.filter(p => !p.name || p.name === p.symbol);
      if (needsName.length === 0) {
        setEnrichedPositions(positions);
        return;
      }
      const updated = [...positions];
      const results = await Promise.allSettled(
        needsName.map(p => getCompanyProfile(p.symbol))
      );
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.name && !cancelled) {
          const idx = updated.findIndex(p => p.symbol === needsName[i].symbol);
          if (idx >= 0) updated[idx] = { ...updated[idx], name: r.value.name };
        }
      });
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

  // ── Derived values ──
  const displayPositions = enrichedPositions.length > 0 ? enrichedPositions : positions;

  const totalMarketValue = displayPositions.reduce((acc: number, p: Position) => acc + p.qty * (p.currentPrice || p.avgCost), 0);
  const totalCost = displayPositions.reduce((acc: number, p: Position) => acc + p.qty * p.avgCost, 0);
  const cashBalance = Math.max(0, 100000 - totalCost);
  const correctEquity = totalMarketValue + cashBalance;
  const totalTodayPnL = displayPositions.reduce((acc: number, p: Position) => acc + (p.dayChange || 0), 0);
  const totalTotalPnL = displayPositions.reduce((acc: number, p: Position) => {
    const mv = p.qty * (p.currentPrice ?? p.avgCost);
    return acc + (mv - (p.totalCost ?? p.qty * p.avgCost));
  }, 0);
  const totalCostBasis = displayPositions.reduce((acc: number, p: Position) => acc + (p.totalCost ?? p.qty * p.avgCost), 0);
  const totalTotalPnLPct = totalCostBasis > 0 ? (totalTotalPnL / totalCostBasis) * 100 : 0;

  const filteredPositions = useMemo(() => {
    if (filter === 'all') return displayPositions;

    const calcPnL = (p: Position) =>
      p.currentPrice
        ? (p.currentPrice - p.avgCost) * p.qty
        : 0;

    if (filter === 'gainers') {
      return displayPositions.filter(p => calcPnL(p) >= 0);
    }

    if (filter === 'losers') {
      return displayPositions.filter(p => calcPnL(p) < 0);
    }

    return displayPositions;
  }, [displayPositions, filter]);

  const accountData: AccountSummary = displayAccount || {
    equity: correctEquity,
    cash: cashBalance,
    buyingPower: cashBalance, // same as cash for demo
    dayPnl: totalTodayPnL,
    dayPnlPercent: correctEquity > 0 ? (totalTodayPnL / correctEquity) * 100 : 0,
    totalPnl: correctEquity - 100000,
    totalPnlPercent: ((correctEquity - 100000) / 100000) * 100,
    positions: displayPositions,
  };

  return (
    <div style={{ paddingBottom: 120 }}>
      {/* ── Account Hero ── */}
      <AccountHero account={accountData} isConnected={isConnected} />

      {/* ── Portfolio Chart ── */}
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

      {/* ── Buying Power Card ── */}
      <BuyingPowerCard account={accountData} invested={totalMarketValue} />

      {/* ── Market Overview ── */}
      <MarketOverview />

      {/* ── Pending Baskets ── */}
      {pendingBaskets.length > 0 && (
        <div style={{ paddingBottom: 4 }}>
          <h2 className="section-header">Ready to Execute</h2>
          {pendingBaskets.map((pb) => (
            <PendingBasketCard key={pb.id || pb.basketId} basket={pb} />
          ))}
        </div>
      )}

      {/* ── Positions Header ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 20px 12px',
      }}>
        <h2 className="section-header" style={{ padding: 0 }}>
          Positions
        </h2>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Filter */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              style={{
                padding: '6px 12px', borderRadius: 999,
                background: filter !== 'all' ? 'rgba(34,211,238,0.10)' : 'transparent',
                border: filter !== 'all' ? '1px solid rgba(34,211,238,0.25)' : '1px solid rgba(255,255,255,0.08)',
                color: filter !== 'all' ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {filter === 'all' ? 'All' : filter === 'gainers' ? 'Gainers' : 'Losers'}
            </button>
            {showFilterDropdown && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: '#131929', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: 4, zIndex: 50,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: 120,
              }}>
                {[
                  { key: 'all', label: 'All' },
                  { key: 'gainers', label: 'Gainers' },
                  { key: 'losers', label: 'Losers' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { setFilter(key); setShowFilterDropdown(false); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 12px', borderRadius: 8,
                      background: filter === key ? 'rgba(34,211,238,0.10)' : 'transparent',
                      color: filter === key ? 'var(--accent)' : '#ffffff',
                      fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 13,
                      cursor: 'pointer', border: 'none',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Select */}
          <button
            onClick={() => {
              if (selectMode) cancelSelect();
              else setSelectMode(true);
            }}
            style={{
              padding: '6px 12px', borderRadius: 999,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.08)',
              color: selectMode ? 'var(--accent)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
        </div>
      </div>

      {/* ── Position Cards ── */}
      {filteredPositions.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '40px 20px',
          color: 'var(--text-muted)', fontSize: 14,
        }}>
          {filter !== 'all' ? 'No positions match this filter' : 'No positions yet'}
        </div>
      ) : (
        filteredPositions.map((pos) => (
          <PositionCard
            key={pos.symbol}
            pos={pos}
            isSelected={selectedSymbols.has(pos.symbol)}
            isExpanded={expandedSymbols.has(pos.symbol)}
            onToggleSelect={() => toggleSelect(pos.symbol)}
            onToggleExpand={() => toggleExpand(pos.symbol)}
            onBuy={() => setTradeTicket({
              symbol: pos.symbol, side: 'BUY',
              currentPrice: pos.currentPrice ?? pos.avgCost,
              sharesHeld: pos.qty,
              availableCash: account?.cash ?? 0,
            })}
            onSell={() => setTradeTicket({
              symbol: pos.symbol, side: 'SELL',
              currentPrice: pos.currentPrice ?? pos.avgCost,
              sharesHeld: pos.qty,
              availableCash: 0,
            })}
            showCheckbox={selectMode}
            baskets={pendingBaskets as Basket[]}
          />
        ))
      )}

      {/* ── Sell Selected Bar ── */}
      {selectMode && selectedSymbols.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 140, left: 16, right: 16, zIndex: 101,
          background: 'rgba(19,25,41,0.98)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 16, padding: '14px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: '#ffffff',
            }}>
              {selectedSymbols.size} selected
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>
              ~$
              {filteredPositions
                .filter(p => selectedSymbols.has(p.symbol))
                .reduce((acc, p) => acc + p.qty * (p.currentPrice || p.avgCost), 0)
                .toLocaleString('en-US', DOLLAR_FMT)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={cancelSelect}
              style={{
                padding: '8px 16px', borderRadius: 999,
                background: 'transparent', border: '1px solid rgba(255,255,255,0.10)',
                color: '#cbd5e1',
                fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => setSellModalOpen(true)}
              style={{
                padding: '8px 16px', borderRadius: 999,
                background: '#ef4444', border: 'none',
                color: '#ffffff',
                fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Sell {selectedSymbols.size === 1 ? filteredPositions.find((p: Position) => selectedSymbols.has(p.symbol))?.symbol : `Selected (${selectedSymbols.size})`}
            </button>
          </div>
        </div>
      )}

      {/* ── Trade Ticket ── */}
      <TradeTicket
        isOpen={tradeTicket !== null}
        onClose={() => setTradeTicket(null)}
        symbol={tradeTicket?.symbol || ''}
        side={tradeTicket?.side || 'BUY'}
        currentPrice={tradeTicket?.currentPrice || 0}
        sharesHeld={tradeTicket?.sharesHeld || 0}
        availableCash={tradeTicket?.availableCash || 0}
        onConfirm={async ({ shares, type, limitPrice }) => {
          if (!tradeTicket) return;
          const price = type === 'limit' && limitPrice ? limitPrice : tradeTicket.currentPrice;
          await executeTrade(tradeTicket.symbol, tradeTicket.side, shares, price, type);
        }}
      />

      {/* ── Sell Modal ── */}
      {sellModalOpen && (
        <SellModal
          positions={
            filteredPositions
              .filter((p: Position) => selectedSymbols.has(p.symbol))
              .map((p: Position) => ({
                symbol: p.symbol,
                qty: p.qty,
                currentPrice: p.currentPrice || p.avgCost,
              }))
          }
          onClose={() => setSellModalOpen(false)}
        />
      )}

      {/* ── Sticky Portfolio Footer ── */}
      <PortfolioFooter
        totalMarketValue={totalMarketValue}
        totalTodayPnL={totalTodayPnL}
        totalTotalPnL={totalTotalPnL}
        totalTotalPnLPct={totalTotalPnLPct}
      />
    </div>
  );
}
