'use client';

import { useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import DemoBanner from '@/components/shared/DemoBanner';
import type { Position, AccountSummary } from '@/types';
import type { Basket } from '@/context/PortfolioContext';
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

const gain = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400');

const formatCurrency = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// ─── Account Card ─────────────────────────────────────────

function AccountCard({ account, isConnected }: { account: AccountSummary; isConnected: boolean }) {
  return (
    <div data-testid="account-card" style={{ margin: '16px 16px 0 16px' }}>
      <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
        Account Value
      </div>
      <div style={{ background: '#1a2235', borderRadius: '10px', border: '1px solid #2a3448', padding: '20px' }}>
        {/* Row 1: Account Value + Demo Mode badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '28px', fontWeight: '700', color: '#ffffff' }}>
            ${account.equity.toLocaleString('en-US', DOLLAR_FMT)}
          </span>
          {!isConnected && (
            <span style={{
              fontSize: '10px',
              color: '#22d3ee',
              background: 'rgba(34,211,238,0.1)',
              border: '1px solid rgba(34,211,238,0.2)',
              borderRadius: '4px',
              padding: '2px 8px',
              whiteSpace: 'nowrap',
            }}>
              Demo Mode
            </span>
          )}
        </div>

        {/* Row 2: TODAY P&L · TOTAL P&L on one line */}
        <p style={{ fontSize: '13px', marginTop: '6px', lineHeight: '1.5' }}>
          <span style={{ color: '#6b7280' }}>TODAY</span>{' '}
          <span style={{ color: account.dayPnl > 0 ? '#10b981' : account.dayPnl < 0 ? '#ef4444' : '#6b7280' }}>
            {fmt(account.dayPnl)} ({pctStr(account.dayPnlPercent)})
          </span>
          {' · '}
          <span style={{ color: '#6b7280' }}>TOTAL</span>{' '}
          <span style={{ color: account.totalPnl > 0 ? '#10b981' : account.totalPnl < 0 ? '#ef4444' : '#6b7280' }}>
            {fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})
          </span>
        </p>

        {/* Divider */}
        <div style={{ borderTop: '1px solid #2a3448', margin: '16px 0' }} />

        {/* Portfolio value chart */}
        <PortfolioChart
          positions={(account.positions || []).map((p) => ({
            symbol: p.symbol,
            shares: p.qty,
            buyDate: p.buyDate,
            avgCost: p.avgCost,
            totalCost: p.totalCost,
          }))}
          cashBalance={account.cash ?? 0}
        />

        {/* Divider */}
        <div style={{ borderTop: '1px solid #2a3448', margin: '16px 0' }} />

        {/* 2-col stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 0' }}>
          <div>
            <p style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Buying Power</p>
            <p style={{ fontSize: '15px', fontWeight: '600', color: '#ffffff' }}>
              ${account.buyingPower.toLocaleString('en-US', DOLLAR_FMT)}
            </p>
          </div>
          <div>
            <p style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Cash</p>
            <p style={{ fontSize: '15px', fontWeight: '600', color: '#ffffff' }}>
              ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Position Card (checkbox + expandable card) ───────────

function getExchange(symbol: string): string {
  const nyse = ['JPM', 'UNH', 'ADBE', 'COST', 'LLY'];
  const nasdaq = ['GOOGL', 'MSFT', 'NVDA'];
  const nysearca = ['SPY', 'QQQ'];
  if (nysearca.includes(symbol)) return 'NYSE Arca';
  if (nasdaq.includes(symbol)) return 'NASDAQ';
  if (nyse.includes(symbol)) return 'NYSE';
  return '—';
}

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
  const livePrice = pos.currentPrice || pos.avgCost;
  const marketValue = pos.qty * livePrice;
  const totalPnL = marketValue - (pos.totalCost || 0);
  const totalPnLPct = (pos.totalCost || 0) > 0 ? (totalPnL / pos.totalCost!) * 100 : 0;
  const todayPnL = pos.dayChange || 0;
  const todayPnLPct = pos.dayChangePercent || 0;

  // 52-week range ball position
  const weekPos =
    pos.weekHigh52 != null &&
    pos.weekLow52 != null &&
    pos.weekHigh52 !== pos.weekLow52
      ? Math.min(98, Math.max(2, ((pos.currentPrice - pos.weekLow52) / (pos.weekHigh52 - pos.weekLow52)) * 100))
      : 50;

  return (
    <div style={{ marginLeft: '16px', marginRight: '16px', marginBottom: '6px' }}>
      <div
        data-testid={`position-${pos.symbol}`}
        style={{
          background: '#1a2235',
          borderRadius: '12px',
          overflow: 'hidden',
          borderLeft: `3px solid ${totalPnL >= 0 ? '#10b981' : '#ef4444'}`,
        }}
      >
        {/* Top row — ticker + market value */}
        <div
          onClick={onToggleExpand}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '12px 14px 8px',
            cursor: 'pointer',
          }}
        >
          {/* Left — ticker + shares */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
              {showCheckbox && (
                <div onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} style={{ marginRight: '4px' }}>
                  <div style={{
                    width: '16px', height: '16px', borderRadius: '2px', border: `2px solid ${isSelected ? '#22d3ee' : '#475569'}`,
                    background: isSelected ? '#22d3ee' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: '10px', lineHeight: 1 }}>&#10003;</span>}
                  </div>
                </div>
              )}
              <span style={{ color: '#ffffff', fontWeight: '700', fontSize: '15px' }}>{pos.symbol}</span>
              {pos.type === 'ETF' && (
                <span style={{
                  fontSize: '9px', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.4)',
                  borderRadius: '3px', padding: '1px 5px', fontWeight: '600',
                }}>ETF</span>
              )}
            </div>
            <span style={{ color: '#6b7280', fontSize: '12px' }}>
              {pos.qty % 1 === 0 ? pos.qty : pos.qty.toFixed(4)} shares
            </span>
            {baskets.filter(b => b.positions.some(p => p.symbol === pos.symbol && p.status === 'active')).map(b => (
              <span key={b.id} style={{ fontSize: '10px', color: '#22d3ee', opacity: 0.7, display: 'block' }}>
                Also in: {b.emoji} {b.name}
              </span>
            ))}
          </div>

          {/* Right — market value */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffffff', fontWeight: '600', fontSize: '15px' }}>
              {formatCurrency(marketValue)}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', marginLeft: '14px', marginRight: '14px' }} />

        {/* Bottom row — TODAY + TOTAL 2x2 */}
        <div onClick={onToggleExpand} style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          padding: '8px 14px 12px', gap: '4px', cursor: 'pointer',
        }}>
          <div style={{ color: '#4b5563', fontSize: '9px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>TODAY</div>
          <div style={{ color: '#4b5563', fontSize: '9px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>TOTAL</div>
          <div style={{ color: todayPnL >= 0 ? '#10b981' : '#ef4444', fontSize: '12px', fontWeight: '500' }}>
            {todayPnL >= 0 ? '+' : ''}{formatCurrency(todayPnL)} ({todayPnL >= 0 ? '+' : ''}{todayPnLPct.toFixed(1)}%)
          </div>
          <div style={{ color: totalPnL >= 0 ? '#10b981' : '#ef4444', fontSize: '12px', fontWeight: '500', textAlign: 'right' }}>
            {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)} ({totalPnL >= 0 ? '+' : ''}{totalPnLPct.toFixed(1)}%)
          </div>
        </div>

        {/* Expanded section */}
        {isExpanded && (
          <div style={{ paddingLeft: '16px', paddingRight: '16px', paddingBottom: '20px', paddingTop: '4px' }}>
            <div style={{
              borderTop: '1px solid #2a3448',
              marginTop: '16px',
              marginBottom: '20px'
            }} />

            {/* Metadata labels */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', marginBottom: '20px' }}>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Symbol</p>
                <p className="text-sm font-semibold text-white">{pos.symbol}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Name</p>
                <p className="text-sm font-semibold text-white">{pos.name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Sector</p>
                <p className="text-sm font-semibold text-white">{pos.sector || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Asset Type</p>
                <p className="text-sm font-semibold text-white">{pos.type || 'Stock'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Exchange</p>
                <p className="text-sm font-semibold text-white">{getExchange(pos.symbol)}</p>
              </div>
            </div>

            {/* Divider before financials */}
            <div style={{ borderTop: '1px solid #2a3448', marginBottom: '20px' }} />

            {/* Financial grid */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                  Daily G/L
                </p>
                <p className={`text-base font-semibold ${gain(pos.dayChange)}`}>
                  {fmt(pos.dayChange)} (
                  {pctStr(pos.dayChangePercent)})
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                  Total G/L
                </p>
                <p className={`text-base font-semibold ${gain(pos.totalPnl)}`}>
                  {fmt(pos.totalPnl)} ({pctStr(pos.totalPnlPercent)})
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                  Current Bid
                </p>
                <p className="text-base font-semibold text-white">
                  ${pos.currentPrice.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                  Avg Cost
                </p>
                <p className="text-base font-semibold text-white">
                  ${pos.avgCost.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                  Portfolio %
                </p>
                <p className="text-base font-semibold text-white">
                  {pos.portfolioPercent.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                  Total Cost
                </p>
                <p className="text-base font-semibold text-white">
                  ${(pos.avgCost * pos.qty).toLocaleString('en-US', DOLLAR_FMT)}
                </p>
              </div>
              {baskets.filter(b => b.positions.some(p => p.symbol === pos.symbol && p.status === 'active')).length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  {baskets.filter(b => b.positions.some(p => p.symbol === pos.symbol && p.status === 'active')).map(b => (
                    <span key={b.id} style={{ fontSize: '11px', color: '#22d3ee', opacity: 0.8 }}>
                      {b.emoji} Also in: {b.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 52-Week Range */}
            {pos.weekHigh52 != null && pos.weekLow52 != null && (
              <div style={{ marginTop: '24px' }}>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                  52-Week Range
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    ${pos.weekLow52.toFixed(0)}
                  </span>
                  <div className="relative flex-1 h-1.5 bg-slate-700 rounded-full">
                    <div
                      className="absolute w-2.5 h-2.5 bg-white rounded-full"
                      style={{
                        top: '-3px',
                        left: `${weekPos}%`,
                        transform: 'translateX(-50%)',
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    ${pos.weekHigh52.toFixed(0)}
                  </span>
                </div>
              </div>
            )}

            {/* Buy More / Sell buttons */}
            <div className="flex gap-3" style={{ marginTop: '24px', marginBottom: '20px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onBuy?.();
                }}
                className="flex-1 border border-cyan-500/40 text-cyan-400 rounded-lg py-3 text-sm font-medium min-h-[48px]"
              >
                Buy More
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect();
                }}
                className="flex-1 border border-red-500/40 text-red-400 rounded-lg py-3 text-sm font-medium min-h-[48px]"
              >
                Sell
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Buy Modal ───────────────────────────────────────────

function BuyModal({
  position,
  buyingPower,
  onClose,
  onExecute,
}: {
  position: Position;
  buyingPower: number;
  onClose: () => void;
  onExecute: (symbol: string, side: 'BUY' | 'SELL', shares: number, price: number) => Promise<{ success: boolean; error?: string }>;
}) {
  const [shares, setShares] = useState(1);
  const [orderType, setOrderType] = useState<'Market' | 'Limit' | 'Stop'>('Market');
  const [tif, setTif] = useState<'Day' | 'GTC'>('Day');
  const [limitPrice, setLimitPrice] = useState('');

  const estCost = shares * position.currentPrice;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a2235] rounded-xl p-6 w-full max-w-sm border border-[#2a3448]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start">
          <h3 className="text-lg font-bold text-white">
            Buy {position.symbol}
          </h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">
            &#10005;
          </button>
        </div>
        <p className="text-sm text-slate-400 mt-1 mb-4">
          Current price: ${position.currentPrice.toFixed(2)}/share
        </p>

        {/* Quantity */}
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Quantity</p>
        <div className="flex items-center gap-2 mb-4">
          <input
            type="number"
            min={1}
            value={shares}
            onChange={(e) => setShares(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-24 bg-[#0f1829] border border-[#2a3448] rounded-md px-3 py-2 text-white text-sm outline-none"
          />
          <span className="text-slate-400 text-sm">shares</span>
        </div>
        <p className="text-sm text-cyan-400 mb-4">
          Est. cost: ${estCost.toLocaleString('en-US', DOLLAR_FMT)}
        </p>

        {/* Order Type */}
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Order Type</p>
        <div className="flex gap-2 mb-3">
          {(['Market', 'Limit', 'Stop'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={
                orderType === t
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 rounded-md px-3 py-1.5 text-xs font-medium'
                  : 'text-slate-400 border border-slate-700 rounded-md px-3 py-1.5 text-xs font-medium'
              }
            >
              {t}
            </button>
          ))}
        </div>

        {/* Time in Force */}
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Time in Force</p>
        <div className="flex gap-2 mb-3">
          {(['Day', 'GTC'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTif(t)}
              className={
                tif === t
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 rounded-md px-3 py-1.5 text-xs font-medium'
                  : 'text-slate-400 border border-slate-700 rounded-md px-3 py-1.5 text-xs font-medium'
              }
            >
              {t}
            </button>
          ))}
        </div>

        {/* Limit Price */}
        {orderType === 'Limit' && (
          <div className="mb-3">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Limit Price</p>
            <input
              type="number"
              step="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="$0.00"
              className="bg-[#0f1829] border border-[#2a3448] rounded-md p-2 w-full text-white outline-none placeholder-slate-600 text-sm"
            />
          </div>
        )}

        {/* Buying Power */}
        <p className="text-xs text-slate-500 mt-3">
          Buying Power: ${buyingPower.toLocaleString('en-US', DOLLAR_FMT)}
        </p>

        {/* Buttons */}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 border border-slate-700 text-slate-400 rounded-lg py-3 text-sm">
            Cancel
          </button>
          <button
            onClick={async () => {
              const price = orderType === 'Limit' && limitPrice ? parseFloat(limitPrice) : position.currentPrice;
              if (!price || isNaN(price) || price <= 0) return;
              const result = await onExecute(position.symbol, 'BUY', shares, price);
              if (result.success) onClose();
            }}
            disabled={estCost > buyingPower}
            className={`flex-1 rounded-lg py-3 text-sm font-semibold ${
              estCost > buyingPower
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-cyan-500 text-white'
            }`}
          >
            {estCost > buyingPower ? 'Insufficient Funds' : 'Confirm Buy'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Build Demo Account ───────────────────────────────────

// ─── Main Tab ─────────────────────────────────────────────

export function PortfolioTab() {
  const { account, loading: brokerLoading } = usePortfolio();
  const { account: liveAccount, loading: liveLoading, executeTrade, baskets, sellBasketPositions, pendingBaskets } = useLivePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [sellModalPositions, setSellModalPositions] =
    useState<{symbol:string, qty:number, currentPrice:number}[] | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [showBuySymbol, setShowBuySymbol] = useState<Position | null>(null);

  // ── Basket state ──
  const [expandedBasket, setExpandedBasket] = useState<string | null>(null);
  const [basketSellMode, setBasketSellMode] = useState<Record<string, boolean>>({});
  const [basketSelected, setBasketSelected] = useState<Record<string, boolean>>({});

  // ── account data: broker if connected, shared context otherwise ──
  const displayAccount: AccountSummary | null = isConnected
    ? account || null
    : liveAccount || null;
  const loading = isConnected ? brokerLoading : liveLoading;

  // Loading
  if (loading) {
    return (
      <div className="px-4 pt-4 space-y-3 pb-24">
        <div className="h-10 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-56 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-8 bg-slate-800 rounded-md animate-pulse w-32" />
        <div className="h-16 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-16 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-16 bg-slate-800 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!displayAccount) {
    return <div className="p-8 text-center text-slate-400">Loading portfolio…</div>;
  }

  const positions = displayAccount.positions || [];

  // ── Basket grouping ──
  const individualPositions = positions.filter(p => !p.basketId);
  const basketPositions = positions.filter(p => !!p.basketId);
  interface BasketGroup {
    displayName: string;
    emoji: string;
    positions: Position[];
    totalCost: number;
    marketValue: number;
    totalPnL: number;
    totalPnLPct: number;
  }
  const basketGroups = basketPositions.reduce<Record<string, BasketGroup>>((groups, pos) => {
    const key = pos.basketDisplayName || pos.basketName || 'Basket';
    if (!groups[key]) {
      groups[key] = {
        displayName: key,
        emoji: pos.basketEmoji || '🧺',
        positions: [],
        totalCost: 0,
        marketValue: 0,
        totalPnL: 0,
        totalPnLPct: 0,
      };
    }
    groups[key].positions.push(pos);
    groups[key].totalCost += pos.totalCost || (pos.avgCost * pos.qty);
    groups[key].marketValue += pos.marketValue;
    groups[key].totalPnL += pos.marketValue - (pos.totalCost || (pos.avgCost * pos.qty));
    return groups;
  }, {});
  // Compute PnL % after accumulating
  for (const g of Object.values(basketGroups)) {
    g.totalPnLPct = g.totalCost > 0 ? (g.totalPnL / g.totalCost) * 100 : 0;
  }
  const toggleGroup = (name: string) => {
    setExpandedBasket(prev => prev === name ? null : name);
  };

  const toggleSelect = (sym: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym],
    );
  };

  const toggleExpand = (sym: string) => {
    setExpandedSymbol((prev) => (prev === sym ? null : sym));
  };

  const allSelected =
    positions.length > 0 && selectedSymbols.length === positions.length;
  const someSelected = selectedSymbols.length > 0 && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedSymbols([]);
    } else {
      setSelectedSymbols(positions.map((p) => p.symbol));
    }
  };

  // ── Summary calculations for sticky footer ──
  const cashBalance = liveAccount?.cash || 0;
  const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0) + cashBalance;
  const totalTodayPnL = positions.reduce((sum, p) => sum + (p.dayChange || 0), 0);
  const prevMarketValue = totalMarketValue - totalTodayPnL;
  const totalTodayPct = prevMarketValue > 0 ? (totalTodayPnL / prevMarketValue) * 100 : 0;
  const totalInvested = positions.reduce((sum, p) => sum + (p.totalCost || 0), 0);
  const totalPnL = positions.reduce((sum, p) => sum + p.marketValue - (p.totalCost || 0), 0);
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  return (
    <div className="min-h-0 bg-[#060a14]" style={{ paddingBottom: 'calc(100px + env(safe-area-inset-bottom))' }}>
      {/* 1. Demo banner */}
      {!isConnected && <DemoBanner />}

      {/* ─── Market Overview ─── */}
      <MarketOverview />

      {/* 2. Account Card */}
      <AccountCard account={displayAccount} isConnected={isConnected} />

      {/* 2.5: Basket Section */}
      {baskets.length > 0 && (
        <div data-testid="baskets-section" style={{ marginTop: '20px', paddingLeft: '16px', paddingRight: '16px' }} id="baskets-section">
          <span className="text-xs text-slate-500 uppercase tracking-wider" style={{ marginBottom: '8px', display: 'block' }}>
            Baskets
          </span>
          {baskets.map(basket => {
            const isExpanded = expandedBasket === basket.id;
            const isSellMode = basketSellMode[basket.id];
            const isPending = basket.status === 'pending';
            const selCount = Object.values(basketSelected).filter(Boolean).length;
            const allSel = basket.positions.filter(p => p.status === 'active' || p.status === 'pending').every(p => basketSelected[p.symbol]);

            return (
              <div key={basket.id} style={{
                background: '#1a2235', border: isPending ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(34,211,238,0.15)',
                borderRadius: '12px', marginBottom: '8px', overflow: 'hidden',
                borderLeft: isPending ? '3px solid #f59e0b' : undefined,
                opacity: isPending ? 0.85 : 1,
              }}>
                {/* Header row */}
                <div onClick={() => { setExpandedBasket(isExpanded ? null : basket.id); if (isExpanded) { setBasketSellMode(prev => ({ ...prev, [basket.id]: false })); setBasketSelected({}); } }} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 16px', cursor: 'pointer',
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '18px' }}>{basket.emoji}</span>
                      <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '15px' }}>{basket.name}</span>
                      {isPending && (
                        <span style={{ fontSize: '10px', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '4px', padding: '1px 6px' }}>PENDING</span>
                      )}
                      {basket.status === 'partial' && (
                        <span style={{ fontSize: '10px', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '4px', padding: '1px 6px' }}>PARTIAL</span>
                      )}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '2px' }}>
                      {isPending
                        ? <span style={{ color: '#f59e0b' }}>⏳ {basket.nextOpenLabel || 'awaiting market open'}</span>
                        : `${basket.activeCount} of ${basket.positionCount} positions`
                      }
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#ffffff', fontWeight: '600', fontSize: '16px' }}>
                      ${isPending ? basket.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : basket.marketValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                    {!isPending && (
                      <div style={{ color: basket.totalPnL >= 0 ? '#10b981' : '#ef4444', fontSize: '12px' }}>
                        {basket.totalPnL >= 0 ? '+' : ''}${basket.totalPnL.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        {' '}({basket.totalPnL >= 0 ? '+' : ''}{basket.totalPnLPct.toFixed(1)}%)
                      </div>
                    )}
                    {isPending && (
                      <div style={{ color: '#f59e0b', fontSize: '11px' }}>reserved</div>
                    )}
                  </div>
                </div>

                {/* Expanded view */}
                {isExpanded && (
                  <>
                    {/* Sell mode toggle — hidden for pending baskets */}
                    {!isPending && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{basket.activeCount} positions</span>
                        <button onClick={(e) => { e.stopPropagation(); setBasketSellMode(prev => ({ ...prev, [basket.id]: !isSellMode })); setBasketSelected({}); }} style={{
                          color: '#ef4444', background: 'none', border: '1px solid rgba(239,68,68,0.3)',
                          borderRadius: '6px', padding: '3px 10px', fontSize: '12px', cursor: 'pointer',
                        }}>{isSellMode ? 'Cancel' : 'Sell Positions'}</button>
                      </div>
                    )}

                    {/* Position rows */}
                    {basket.positions.filter(p => p.status === 'active' || p.status === 'pending').map(pos => {
                      const isPosPending = pos.status === 'pending';
                      return (
                      <div key={pos.symbol} style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.04)', gap: '10px' }}>
                        {isSellMode && !isPosPending && (
                          <input type="checkbox"
                            checked={basketSelected[pos.symbol] || false}
                            onChange={() => { setBasketSelected(prev => ({ ...prev, [pos.symbol]: !prev[pos.symbol] })); }}
                            style={{ accentColor: '#22d3ee', width: '18px', height: '18px', flexShrink: 0 }}
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '14px' }}>{pos.symbol}</span>
                            <span style={{ color: isPosPending ? '#f59e0b' : '#ffffff', fontWeight: '500' }}>
                              ${isPosPending ? (pos.reservedAmount || pos.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : (pos.marketValue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                            <span style={{ color: '#6b7280', fontSize: '11px' }}>
                              {isPosPending ? '⏳ pending' : `${pos.shares.toFixed(4)}sh · ${pos.allocationPct}%`}
                            </span>
                            {!isPosPending && (
                              <span style={{ color: (pos.totalPnL || 0) >= 0 ? '#10b981' : '#ef4444', fontSize: '11px' }}>
                                {(pos.totalPnL || 0) >= 0 ? '+' : ''}${(pos.totalPnL || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                {' '}({(pos.totalPnLPct || 0).toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )})}

                    {/* Sell mode footer */}
                    {isSellMode && (
                      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#9ca3af', fontSize: '12px', cursor: 'pointer' }}>
                          <input type="checkbox"
                            checked={allSel}
                            onChange={() => {
                              const toggle: Record<string, boolean> = {};
                              const activeSymbols = basket.positions.filter(p => p.status === 'active').map(p => p.symbol);
                              activeSymbols.forEach(s => { toggle[s] = !allSel; });
                              setBasketSelected(prev => ({ ...prev, ...toggle }));
                            }}
                            style={{ accentColor: '#22d3ee' }}
                          />
                          Select all
                        </label>
                        <button onClick={async () => {
                          const toSell = Object.entries(basketSelected).filter(([, v]) => v).map(([k]) => k);
                          if (!toSell.length) return;
                          const result = await sellBasketPositions(basket.id, toSell);
                          if (result.success) {
                            setBasketSellMode(prev => ({ ...prev, [basket.id]: false }));
                            setBasketSelected({});
                          }
                        }} disabled={selCount === 0} style={{
                          flex: 1, padding: '10px',
                          background: selCount > 0 ? '#ef4444' : 'rgba(239,68,68,0.2)',
                          color: '#ffffff', border: 'none', borderRadius: '8px',
                          fontSize: '14px', fontWeight: '600',
                          cursor: selCount > 0 ? 'pointer' : 'not-allowed',
                        }}>Sell {selCount > 0 ? `${selCount} position${selCount > 1 ? 's' : ''}` : 'Selected'}</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Column header */}
      {positions.length > 0 && (
        <div data-testid="holdings-section" id="holdings-section" className="flex items-center" style={{ marginLeft: '16px', marginRight: '16px', padding: '0 14px', marginTop: '20px', marginBottom: '10px' }}>
          {selectMode && (
            <button onClick={toggleSelectAll} aria-label="Select all" style={{ marginRight: '4px' }}>
              <div
                className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-all duration-150 ${
                  allSelected
                    ? 'bg-cyan-500 border-cyan-500'
                    : someSelected
                      ? 'bg-cyan-500/40 border-cyan-500'
                      : 'border-slate-600 bg-transparent'
                }`}
              >
                {(allSelected || someSelected) && (
                  <span className="text-white text-[10px] leading-none">
                    {allSelected ? '\u2713' : '\u2013'}
                  </span>
                )}
              </div>
            </button>
          )}
          <span className="flex-1" style={{ color: '#ffffff', fontSize: '16px', fontWeight: '700', letterSpacing: '-0.01em', textTransform: 'uppercase' }}>
            HOLDINGS
          </span>
          {selectMode ? (
            selectedSymbols.length === 0 ? (
              <button
                onClick={() => { setSelectMode(false); setSelectedSymbols([]); }}
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: '#94a3b8',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  padding: '5px 10px',
                  background: 'transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={() => {
                  const sp = positions.filter((p) => selectedSymbols.includes(p.symbol));
                  setSellModalPositions(sp.map(s => ({
                    symbol: s.symbol,
                    qty: s.qty,
                    currentPrice: s.currentPrice
                  })));
                }}
                style={{
                  fontSize: '11px',
                  fontWeight: '700',
                  color: '#ffffff',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '5px 12px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {selectedSymbols.length === positions.length && positions.length > 1
                  ? 'Sell Portfolio'
                  : `Sell Selected (${selectedSymbols.length})`}
              </button>
            )
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              style={{
                fontSize: '11px',
                fontWeight: '600',
                color: '#22d3ee',
                border: '1px solid rgba(34,211,238,0.4)',
                borderRadius: '8px',
                padding: '5px 10px',
                background: 'transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              Sell Positions
            </button>
          )}
        </div>
      )}

      {/* 4. Individual Positions (non-basket) */}
      {individualPositions.map((pos) => (
        <PositionCard
          key={pos.symbol}
          pos={pos}
          isSelected={selectedSymbols.includes(pos.symbol)}
          isExpanded={expandedSymbol === pos.symbol}
          onToggleSelect={() => toggleSelect(pos.symbol)}
          onToggleExpand={() => toggleExpand(pos.symbol)}
          onBuy={() => setShowBuySymbol(pos)}
          showCheckbox={selectMode}
          baskets={baskets}
        />
      ))}

      {/* 5. Basket Groups */}
      {Object.entries(basketGroups).map(([name, group]) => {
        const isExpanded = expandedBasket === name;
        const pnl = group.totalPnL;
        const pnlPct = group.totalPnLPct;
        const isPos = pnl >= 0;
        return (
          <div
            key={name}
            style={{
              marginLeft: '16px',
              marginRight: '16px',
              marginBottom: '8px',
              background: '#1a2235',
              border: '1px solid rgba(34,211,238,0.1)',
              borderLeft: `3px solid ${isPos ? '#10b981' : '#ef4444'}`,
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            {/* Collapsed header */}
            <div
              onClick={() => toggleGroup(name)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '14px 16px',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '3px',
                }}>
                  <span style={{ fontSize: '16px' }}>{group.emoji}</span>
                  <span style={{
                    color: '#ffffff',
                    fontWeight: '600',
                    fontSize: '15px',
                  }}>
                    {group.displayName}
                  </span>
                </div>
                <span style={{ color: '#6b7280', fontSize: '11px' }}>
                  {group.positions.length} position{group.positions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#ffffff', fontWeight: '600', fontSize: '15px' }}>
                  {formatCurrency(group.marketValue)}
                </div>
                <div style={{
                  color: isPos ? '#10b981' : '#ef4444',
                  fontSize: '12px',
                }}>
                  {isPos ? '+' : ''}{formatCurrency(pnl)}{' '}
                  ({isPos ? '+' : ''}{pnlPct.toFixed(1)}%)
                </div>
              </div>
            </div>

            {/* Expanded positions list */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {group.positions.map((pos) => (
                  <div
                    key={pos.symbol}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 16px 10px 28px',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    <div>
                      <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '14px' }}>
                        {pos.symbol}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '8px' }}>
                        {pos.qty % 1 === 0 ? pos.qty : pos.qty.toFixed(4)} shares
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#ffffff', fontWeight: '500', fontSize: '13px' }}>
                        {formatCurrency(pos.marketValue)}
                      </div>
                      <div style={{
                        color: (pos.marketValue - (pos.totalCost || 0)) >= 0 ? '#10b981' : '#ef4444',
                        fontSize: '11px',
                      }}>
                        {((pos.marketValue - (pos.totalCost || 0)) >= 0 ? '+' : '')}
                        {formatCurrency(pos.marketValue - (pos.totalCost || 0))}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Sell Basket button */}
                <div style={{ padding: '12px 16px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const sp = group.positions.map(p => ({
                        symbol: p.symbol,
                        qty: p.qty,
                        currentPrice: p.currentPrice,
                      }));
                      setSellModalPositions(sp);
                    }}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: '#ef4444',
                      border: 'none',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '14px',
                      fontWeight: '700',
                      cursor: 'pointer',
                    }}
                  >
                    Sell Basket
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 6. Pending Basket Orders */}
      {pendingBaskets && pendingBaskets.length > 0 && (
        <>
          {pendingBaskets.map((pb: any) => (
            <div
              key={pb.id}
              style={{
                marginLeft: '16px',
                marginRight: '16px',
                marginBottom: '8px',
                background: '#1a2235',
                border: '1px solid rgba(245,158,11,0.2)',
                borderLeft: '3px solid #f59e0b',
                borderRadius: '12px',
                padding: '14px 16px',
                opacity: 0.85,
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{ fontSize: '16px' }}>
                    {pb.basketEmoji || '🧺'}
                  </span>
                  <span style={{
                    color: '#ffffff',
                    fontWeight: '600',
                    fontSize: '14px',
                  }}>
                    {pb.basketDisplayName || pb.basketName || 'Basket'}
                  </span>
                </div>
                <span style={{
                  background: 'rgba(245,158,11,0.15)',
                  color: '#f59e0b',
                  fontSize: '10px',
                  fontWeight: '700',
                  padding: '3px 8px',
                  borderRadius: '4px',
                }}>
                  PENDING
                </span>
              </div>
              <div style={{
                color: '#f59e0b',
                fontSize: '12px',
                marginBottom: '4px',
              }}>
                ⏳ {pb.nextOpenLabel || 'awaiting market open'}
              </div>
              <div style={{
                color: '#6b7280',
                fontSize: '11px',
              }}>
                {pb.orders?.length || 0} positions ·
                ${(pb.totalReserved || 0).toFixed(2)} reserved
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ height: '40px' }} />

      {/* Sticky Portfolio Summary Footer */}
      <div data-testid="portfolio-footer" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: 'linear-gradient(' +
          'to top,' +
          '#0a0f1e 65%,' +
          'transparent 100%' +
        ')',
        paddingTop: '24px',
        paddingBottom: 'calc(8px + env(safe-area-inset-bottom) + 64px)',
        paddingLeft: '16px',
        paddingRight: '16px',
      }}>
        {/* Label above pill */}
        <div style={{
          textAlign: 'center',
          marginBottom: '6px',
        }}>
          <span style={{
            color: 'rgba(255,255,255,0.3)',
            fontSize: '9px',
            fontWeight: '600',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Portfolio Summary
          </span>
        </div>

        {/* Three-column pill */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          background: 'rgba(26,34,53,0.98)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '16px',
          padding: '12px 0',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}>

          {/* Market Value */}
          <div style={{
            textAlign: 'center',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            padding: '0 8px',
          }}>
            <div style={{
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: '700',
              letterSpacing: '-0.01em',
            }}>
              {totalMarketValue >= 10000
                ? `$${(totalMarketValue/1000).toFixed(1)}K`
                : `$${totalMarketValue.toFixed(0)}`
              }
            </div>
            <div style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginTop: '3px',
              fontWeight: '500',
            }}>
              Market Value
            </div>
          </div>

          {/* Today P&L */}
          <div style={{
            textAlign: 'center',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            padding: '0 8px',
          }}>
            <div style={{
              color: totalTodayPnL >= 0
                ? '#34d399'
                : '#f87171',
              fontSize: '14px',
              fontWeight: '700',
            }}>
              {totalTodayPnL >= 0 ? '+' : ''}
              {Math.abs(totalTodayPnL) >= 10000
                ? `$${(Math.abs(totalTodayPnL)/1000).toFixed(1)}K`
                : `$${Math.abs(totalTodayPnL).toFixed(0)}`
              }
            </div>
            <div style={{
              color: totalTodayPnL >= 0
                ? 'rgba(52,211,153,0.7)'
                : 'rgba(248,113,113,0.7)',
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginTop: '3px',
              fontWeight: '500',
            }}>
              Today {totalTodayPnL >= 0 ? '+' : ''}
              {totalTodayPct.toFixed(1)}%
            </div>
          </div>

          {/* Total P&L */}
          <div style={{
            textAlign: 'center',
            padding: '0 8px',
          }}>
            <div style={{
              color: totalPnL >= 0
                ? '#34d399'
                : '#f87171',
              fontSize: '14px',
              fontWeight: '700',
            }}>
              {totalPnL >= 0 ? '+' : ''}
              {Math.abs(totalPnL) >= 10000
                ? `$${(Math.abs(totalPnL)/1000).toFixed(1)}K`
                : `$${Math.abs(totalPnL).toFixed(0)}`
              }
            </div>
            <div style={{
              color: totalPnL >= 0
                ? 'rgba(52,211,153,0.7)'
                : 'rgba(248,113,113,0.7)',
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginTop: '3px',
              fontWeight: '500',
            }}>
              Total {totalPnL >= 0 ? '+' : ''}
              {totalPnLPct.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* 5. Buy Modal */}
      {showBuySymbol && (
        <BuyModal
          position={showBuySymbol}
          buyingPower={displayAccount?.buyingPower ?? 0}
          onClose={() => setShowBuySymbol(null)}
          onExecute={async (symbol, side, shares, price) => {
            const result = await executeTrade(symbol, side, shares, price);
            return result;
          }}
        />
      )}

      {sellModalPositions && (
        <SellModal
          positions={sellModalPositions}
          onClose={() => setSellModalPositions(null)}
          onConfirm={async () => {
            // Execute sell for each selected position
            if (sellModalPositions) {
              for (const pos of sellModalPositions) {
                await executeTrade(pos.symbol, 'SELL', pos.qty, pos.currentPrice);
              }
            }
            setSellModalPositions(null);
            setSelectedSymbols([]);
            setSelectMode(false);
          }}
        />
      )}

      <style jsx global>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.2s ease-out; }
      `}</style>
    </div>
  );
}
