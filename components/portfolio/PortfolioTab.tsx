'use client';

import { useState, useMemo, useEffect } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import type { Position, AccountSummary } from '@/types';
import type { Basket } from '@/context/PortfolioContext';
import { getCompanyProfile } from '@/lib/market-data';
import SellModal from './SellModal';
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
  showCheckbox = false,
  baskets = [],
}: {
  pos: Position;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onBuy?: () => void;
  showCheckbox?: boolean;
  baskets?: Basket[];
}) {
  const currentPrice = pos.currentPrice ?? pos.avgCost;
  const totalPnL = (currentPrice - pos.avgCost) * pos.qty;
  const costBasis = pos.totalCost ?? pos.qty * pos.avgCost;
  const totalPnLPct = costBasis > 0 ? (totalPnL / costBasis) * 100 : 0;
  const todayPnL = pos.dayChange ?? 0;
  const todayPnLPct = pos.dayChangePercent ?? 0;

  // 52-week range ball position
  const weekPos =
    pos.weekHigh52 != null &&
    pos.weekLow52 != null &&
    pos.weekHigh52 !== pos.weekLow52
      ? Math.min(98, Math.max(2, ((currentPrice - pos.weekLow52) / (pos.weekHigh52 - pos.weekLow52)) * 100))
      : 50;

  const upToday = todayPnL >= 0;
  const upTotal = totalPnL >= 0;

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
          <span className="pill-pct">({todayPnL >= 0 ? '+' : ''}{Math.abs(todayPnLPct).toFixed(1)}%)</span>
        </div>
        <div className={`position-pill ${gainLossClass(totalPnL)}`}>
          <span className="pill-label">TOTAL</span>
          <span className="pill-value">{totalPnL >= 0 ? '+' : ''}${Math.abs(totalPnL).toFixed(2)}</span>
          <span className="pill-pct">({totalPnL >= 0 ? '+' : ''}{Math.abs(totalPnLPct).toFixed(1)}%)</span>
        </div>
      </div>

      {/* 52-week range bar */}
      {pos.weekLow52 != null && pos.weekHigh52 != null && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
            ${pos.weekLow52.toFixed(2)}
          </span>
          <div style={{
            flex: 1, height: 3, borderRadius: 999,
            background: 'rgba(255,255,255,0.06)', position: 'relative',
          }}>
            <div style={{
              position: 'absolute', left: `${weekPos}%`, top: -3,
              width: 8, height: 8, borderRadius: 9,
              background: '#ffffff', transform: 'translateX(-50%)',
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
            ${pos.weekHigh52.toFixed(2)}
          </span>
        </div>
      )}

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
        <div style={{ paddingTop: 16, marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Metadata */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', marginBottom: 16 }}>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Symbol</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', fontFamily: 'var(--font-sans)' }}>
                {pos.symbol}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Name</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
                {pos.name || '—'}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Sector</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
                {pos.sector || '—'}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Asset Type</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
                {pos.type || 'Stock'}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Exchange</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
                {pos.exchange || '—'}
              </div>
            </div>
          </div>

          {/* Financial grid */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: 16,
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px',
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
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Total P&L</div>
              <div style={{
                fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
                color: totalPnL >= 0 ? 'var(--gain)' : 'var(--loss)',
              }}>
                {formatCurrency(totalPnL)} ({totalPnL >= 0 ? '+' : ''}{totalPnLPct.toFixed(1)}%)
              </div>
            </div>
            <div>
              <div className="section-label" style={{ fontSize: 10, marginBottom: 2 }}>Daily G/L</div>
              <div style={{
                fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
                color: todayPnL >= 0 ? 'var(--gain)' : 'var(--loss)',
              }}>
                {todayPnL >= 0 ? '+' : ''}{formatCurrency(todayPnL)} ({todayPnL >= 0 ? '+' : ''}{todayPnLPct.toFixed(1)}%)
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
            display: 'flex', gap: 10, marginTop: 16,
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
          <div style={{ fontSize: 11, letterSpacing: 0.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>CASH</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
            ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>INVESTED</div>
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
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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

  const { account: brokerAccount, loading: brokerLoading } = usePortfolio();
  const { account: liveAccount, loading: liveLoading, baskets, pendingBaskets } = useLivePortfolio();
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
            onBuy={() => {}}
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
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
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
                color: 'var(--text-muted)',
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
