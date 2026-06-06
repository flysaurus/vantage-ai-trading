'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown } from 'lucide-react';
import {
  LineChart, Line, Area, ResponsiveContainer,
} from 'recharts';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import DemoBanner from '@/components/shared/DemoBanner';
import { getDemoPortfolio } from '@/lib/demo-data';
import type { Position, AccountSummary } from '@/types';

// ─── Constants ─────────────────────────────────────────────────

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const TICKER_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLF'];

const TIMEFRAMES = ['1D', '1W', '1M', '3M', '1Y'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const SECTOR_COLORS: Record<string, string> = {
  Technology: '#06b6d4',
  'Financial Services': '#f59e0b',
  Healthcare: '#10b981',
  Consumer: '#f97316',
  Energy: '#ef4444',
  'Media & Entertainment': '#8b5cf6',
  Automotive: '#ec4899',
};

function getSectorColor(sector: string): string {
  return SECTOR_COLORS[sector] || '#6366f1';
}

const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;
const pctStr = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// Generate flat-ish sparkline data (placeholder until real API)
function generateSparkline(base: number, points: number, volatility: number, trend: number) {
  const data: { v: number }[] = [];
  let val = base;
  for (let i = 0; i < points; i++) {
    val += volatility * (Math.random() - 0.45 + trend);
    val = Math.max(val, base * 0.8);
    data.push({ v: val });
  }
  return data;
}

// ─── Individual Sell Bottom Sheet ─────────────────────────────

interface SellConfig {
  mode: 'all' | 'partial';
  shares: number;
  orderType: 'Market' | 'Limit' | 'Stop';
  tif: 'Day' | 'GTC';
  limitPrice: string;
}

function SellBottomSheet({
  position,
  onClose,
  onConfirm,
}: {
  position: Position;
  onClose: () => void;
  onConfirm: (cfg: SellConfig) => void;
}) {
  const [cfg, setCfg] = useState<SellConfig>({
    mode: 'all',
    shares: position.qty,
    orderType: 'Market',
    tif: 'Day',
    limitPrice: '',
  });
  const [confirmText, setConfirmText] = useState('');
  const needsConfirm = confirmText === 'SELL';

  const proceeds = cfg.mode === 'all'
    ? position.qty * position.currentPrice
    : cfg.shares * position.currentPrice;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-slate-900 rounded-t-3xl p-6 pb-safe max-h-[85vh] overflow-y-auto border-t border-slate-700">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4" />

        <h3 className="text-lg font-bold text-white mb-1">
          Sell {position.symbol}
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          {position.qty} shares available · ${position.currentPrice.toFixed(2)}/share
        </p>

        {/* Radio: All / Partial */}
        <div className="space-y-3 mb-4">
          <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
            <input type="radio" checked={cfg.mode === 'all'} onChange={() => setCfg(p => ({ ...p, mode: 'all' }))}
              className="accent-cyan-500" />
            <div className="flex-1">
              <p className="text-white text-sm font-semibold">All shares ({position.qty})</p>
              <p className="text-slate-400 text-xs">Est. ${proceeds.toLocaleString('en-US', DOLLAR_FMT)}</p>
            </div>
          </label>
          <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
            <input type="radio" checked={cfg.mode === 'partial'} onChange={() => setCfg(p => ({ ...p, mode: 'partial' }))}
              className="accent-cyan-500" />
            <div className="flex-1">
              <p className="text-white text-sm font-semibold">Partial</p>
              {cfg.mode === 'partial' && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min={1}
                    max={position.qty}
                    value={cfg.shares}
                    onChange={e => setCfg(p => ({ ...p, shares: Math.min(position.qty, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm outline-none"
                  />
                  <span className="text-slate-400 text-xs">of {position.qty}</span>
                </div>
              )}
            </div>
          </label>
        </div>

        {/* Order type pills */}
        <p className="text-xs text-slate-500 uppercase mb-2">Order Type</p>
        <div className="flex gap-2 mb-3">
          {(['Market', 'Limit', 'Stop'] as const).map(t => (
            <button key={t} onClick={() => setCfg(p => ({ ...p, orderType: t }))}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${
                cfg.orderType === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-400 border border-slate-700'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* TIF */}
        <p className="text-xs text-slate-500 uppercase mb-2">Time in Force</p>
        <div className="flex gap-2 mb-3">
          {(['Day', 'GTC'] as const).map(t => (
            <button key={t} onClick={() => setCfg(p => ({ ...p, tif: t }))}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${
                cfg.tif === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-400 border border-slate-700'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* Limit price */}
        {cfg.orderType === 'Limit' && (
          <div className="mb-4">
            <p className="text-xs text-slate-500 uppercase mb-2">Limit Price</p>
            <div className="flex items-center bg-slate-800 rounded-xl border border-slate-700 px-4 py-3">
              <span className="text-slate-400 text-lg mr-2">$</span>
              <input
                type="number" step="0.01" value={cfg.limitPrice}
                onChange={e => setCfg(p => ({ ...p, limitPrice: e.target.value }))}
                placeholder="0.00"
                className="bg-transparent text-white text-lg font-semibold flex-1 outline-none placeholder-slate-600"
              />
            </div>
          </div>
        )}

        {/* Est. proceeds */}
        <div className="bg-slate-800 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-400">Estimated proceeds</p>
          <p className="text-base font-semibold text-cyan-400">
            ${proceeds.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>

        {/* Type to confirm */}
        <div className="mb-4">
          <p className="text-xs text-slate-400 mb-2">Type &quot;SELL&quot; to confirm</p>
          <input
            type="text" value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="SELL"
            className="w-full bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 text-white text-sm outline-none"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3.5 text-slate-400 text-sm font-medium">
            Cancel
          </button>
          <button
            disabled={!needsConfirm}
            onClick={() => onConfirm(cfg)}
            className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-2xl text-sm font-semibold min-h-[52px]">
            Confirm Sell
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Market Ticker Strip ──────────────────────────────────────

function MarketTicker() {
  const [quotes, setQuotes] = useState<Record<string, { price: number; change: number; changePercent: number }>>({});

  // Fetch on mount
  useMemo(() => {
    fetch('/api/market/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: TICKER_SYMBOLS }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.quotes) {
          const m: Record<string, any> = {};
          for (const sym of TICKER_SYMBOLS) {
            const q = data.quotes[sym];
            if (q) m[sym] = { price: q.last || q.price || 0, change: q.change || 0, changePercent: q.changePercent || 0 };
          }
          setQuotes(m);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 overflow-x-auto whitespace-nowrap hide-scrollbar">
      {TICKER_SYMBOLS.map((sym, i) => {
        const q = quotes[sym];
        const isUp = (q?.change ?? 0) >= 0;
        return (
          <span key={sym} className="inline-flex items-center gap-2 mr-6">
            <span className="text-sm font-semibold text-white">{sym}</span>
            {q ? (
              <>
                <span className="text-xs text-slate-400">${q.price.toFixed(2)}</span>
                <span className={`text-xs font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isUp ? '+' : ''}{q.change.toFixed(2)} ({isUp ? '+' : ''}{q.changePercent.toFixed(1)}%)
                </span>
              </>
            ) : (
              <span className="text-xs text-slate-600">—</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ─── Account Card ─────────────────────────────────────────────

function AccountCard({ account, investorStyle }: { account: AccountSummary; investorStyle: string }) {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState<Timeframe>('1W');
  const isUp = account.totalPnl >= 0;

  // Generate placeholder sparkline data
  const sparkData = useMemo(() => {
    const points = timeframe === '1D' ? 78 : timeframe === '1W' ? 50 : timeframe === '1M' ? 30 : timeframe === '3M' ? 90 : 120;
    const vol = account.equity * 0.002;
    const trend = isUp ? 0.01 : -0.005;
    return generateSparkline(account.equity * 0.94, points, vol, trend);
  }, [timeframe, account.equity, isUp]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 mx-4 mt-4">
      {/* ACCOUNT VALUE */}
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
        Account Value
      </p>
      <div className="flex items-center justify-between mb-1">
        <p className="text-4xl font-bold text-white">
          ${account.equity.toLocaleString('en-US', DOLLAR_FMT)}
        </p>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Growth Chaser
          </span>
          <button onClick={() => router.push('/investor-style')}
            className="text-xs text-cyan-400">
            Change ›
          </button>
        </div>
      </div>

      {/* Sparkline */}
      <div className="h-20 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <defs>
              <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.2} />
                <stop offset="100%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Line type="monotone" dataKey="v" stroke={isUp ? '#10b981' : '#ef4444'}
              strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="v" fill="url(#accGrad)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Timeframe pills */}
      <div className="flex gap-1 justify-center -mt-1 mb-3">
        {TIMEFRAMES.map(tf => (
          <button key={tf} onClick={() => setTimeframe(tf)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              timeframe === tf
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'text-slate-400'
            }`}>
            {tf}
          </button>
        ))}
      </div>

      {/* Today P&L / Total P&L */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <p className="text-xs text-slate-500 uppercase">Today P&amp;L</p>
          <p className={`text-base font-semibold ${account.dayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmt(account.dayPnl)} ({pctStr(account.dayPnlPercent)})
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase">Total P&amp;L</p>
          <p className={`text-base font-semibold ${account.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})
          </p>
        </div>
      </div>

      {/* Buying Power / Cash */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-500 uppercase">Buying Power</p>
          <p className="text-base font-semibold text-white">
            ${account.buyingPower.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase">Cash</p>
          <p className="text-base font-semibold text-white">
            ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>
      </div>

      {/* Bottom bar: investor style + Change link */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <span className="text-xs text-slate-400">Growth Chaser</span>
        </div>
        <button onClick={() => router.push('/investor-style')}
          className="text-xs text-cyan-400">
          Change ›
        </button>
      </div>
    </div>
  );
}

// ─── Basket Card ──────────────────────────────────────────────

function BasketCard({
  id, name, emoji, positions, expanded, onToggle, onSellPosition, onSellEntire,
}: {
  id: string;
  name: string;
  emoji?: string;
  positions: Position[];
  expanded: boolean;
  onToggle: () => void;
  onSellPosition: (pos: Position) => void;
  onSellEntire: () => void;
}) {
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalPnl = positions.reduce((s, p) => s + p.totalPnl, 0);
  const totalPnlPct = totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;
  const isUp = totalPnl >= 0;

  const symbols = positions.map(p => p.symbol).join(' · ');

  return (
    <div className={`bg-slate-900 rounded-2xl border border-slate-800 mx-4 mb-3 overflow-hidden ${isUp ? 'border-l-[3px] border-l-emerald-500' : 'border-l-[3px] border-l-red-500'}`}>
      {/* Header */}
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left">
        <div>
          <p className="text-base font-semibold text-white flex items-center gap-1.5">
            {emoji || '🧺'} {name}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{symbols}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold text-white">${totalValue.toLocaleString()}</p>
          <p className={`text-xs ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{Math.round(totalPnl).toLocaleString()} ({pctStr(totalPnlPct)})
          </p>
        </div>
      </button>

      {/* Expanded positions */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {positions.map(pos => (
            <div key={pos.symbol} className={`flex items-center justify-between py-2 border-l-[3px] pl-3 ${pos.dayChange >= 0 ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
              <div>
                <p className="text-sm font-semibold text-white">{pos.symbol}</p>
                <p className="text-xs text-slate-400">{pos.qty}sh · ${pos.marketValue.toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <p className={`text-xs font-medium ${pos.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmt(pos.totalPnl)} ({pctStr(pos.totalPnlPercent)})
                </p>
                <button onClick={e => { e.stopPropagation(); onSellPosition(pos); }}
                  className="text-xs text-red-400 px-3 py-1 rounded-lg border border-red-500/30">
                  Sell
                </button>
              </div>
            </div>
          ))}
          <button onClick={onSellEntire}
            className="w-full py-2.5 text-sm text-red-400 border border-red-500/40 rounded-xl mt-2 font-medium">
            Sell Entire Basket
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Position Row (Core Holdings) ─────────────────────────────

function HoldingRow({
  position, expanded, onToggle, onBuy, onSell,
}: {
  position: Position;
  expanded: boolean;
  onToggle: () => void;
  onBuy: () => void;
  onSell: () => void;
}) {
  const isUp = position.dayChange >= 0;
  const sparkData = useMemo(() => {
    const base = position.marketValue * 0.9 + Math.random() * position.marketValue * 0.08;
    return generateSparkline(base, 48, position.currentPrice * 0.5, isUp ? 0.015 : -0.005);
  }, [position.marketValue, position.currentPrice, isUp]);

  return (
    <div className={`bg-slate-900 rounded-2xl border border-slate-800 mx-4 mb-3 overflow-hidden ${isUp ? 'border-l-[3px] border-l-emerald-500' : 'border-l-[3px] border-l-red-500'}`}>
      {/* Header */}
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left">
        <div>
          <p className="text-base font-semibold text-white">{position.symbol}</p>
          <p className="text-xs text-slate-400">{position.qty}sh · {position.sector || '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold text-white">${position.marketValue.toLocaleString()}</p>
          <p className={`text-sm ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmt(position.dayChange)} ({pctStr(position.dayChangePercent)})
          </p>
        </div>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* 7-day sparkline */}
          <div className="h-16 mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <defs>
                  <linearGradient id={`hg${position.symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Line type="monotone" dataKey="v" stroke={isUp ? '#10b981' : '#ef4444'}
                  strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="v" fill={`url(#hg${position.symbol})`} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <p className="text-xs text-slate-500">Avg Cost</p>
              <p className="text-sm font-semibold text-white">${position.avgCost.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Current</p>
              <p className="text-sm font-semibold text-white">${position.currentPrice.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total P&amp;L</p>
              <p className={`text-sm font-semibold ${position.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(position.totalPnl)} ({pctStr(position.totalPnlPercent)})
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Today</p>
              <p className={`text-sm font-semibold ${position.dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(position.dayChange)}
              </p>
            </div>
          </div>

          {/* Buy / Sell buttons */}
          <div className="flex gap-2">
            <button onClick={onBuy}
              className="flex-1 py-2.5 border border-cyan-500/40 text-cyan-400 rounded-xl text-sm font-semibold min-h-[48px]">
              Buy More
            </button>
            <button onClick={onSell}
              className="flex-1 py-2.5 border border-red-500/40 text-red-400 rounded-xl text-sm font-semibold min-h-[48px]">
              Sell
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sector Allocation ────────────────────────────────────────

function SectorBars({ positions }: { positions: Position[] }) {
  const sectors = useMemo(() => {
    const map: Record<string, number> = {};
    const total = positions.reduce((s, p) => s + p.marketValue, 0);
    positions.forEach(p => {
      const sec = p.sector || 'Other';
      map[sec] = (map[sec] || 0) + p.marketValue;
    });
    return Object.entries(map)
      .map(([sector, value]) => ({ sector, value, pct: total > 0 ? (value / total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [positions]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 mx-4 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">
        Sector Allocation
      </p>
      {sectors.map(({ sector, pct }) => {
        const color = getSectorColor(sector);
        return (
          <div key={sector} className="flex items-center gap-3 mb-2 last:mb-0">
            <span className="text-sm text-white w-28 flex-shrink-0 truncate">{sector}</span>
            <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }} />
            </div>
            <span className="text-sm text-slate-400 w-10 text-right flex-shrink-0">
              {pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Build AccountSummary from demo positions ──────────────────

function buildDemoAccount(demo: ReturnType<typeof getDemoPortfolio>): AccountSummary {
  const seed = 42; // deterministic pseudorandom
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

  const positions: Position[] = demo.positions.map((dp, i) => {
    const jitter = (rand() - 0.5) * 0.15;
    const currentPrice = dp.avgCost * (1 + jitter);
    const marketValue = currentPrice * dp.qty;
    const dayChange = marketValue * (rand() - 0.5) * 0.04;
    const dayChangePercent = (dayChange / (marketValue - dayChange)) * 100;
    const totalPnl = (currentPrice - dp.avgCost) * dp.qty;
    const totalPnlPercent = ((currentPrice / dp.avgCost) - 1) * 100;
    const totalValue = marketValue;
    return {
      symbol: dp.symbol,
      name: dp.name,
      qty: dp.qty,
      avgCost: dp.avgCost,
      currentPrice,
      marketValue,
      dayChange,
      dayChangePercent,
      totalPnl,
      totalPnlPercent,
      profitLossPct: totalPnlPercent,
      portfolioPercent: 0, // filled below
      sector: dp.sector,
    };
  });

  const totalEquity = positions.reduce((sum, p) => sum + p.marketValue, 0);
  positions.forEach(p => { p.portfolioPercent = totalEquity > 0 ? (p.marketValue / totalEquity) * 100 : 0; });

  const cash = 14373.61;
  const buyingPower = 179670.15;
  const dayPnl = positions.reduce((s, p) => s + p.dayChange, 0);
  const dayPnlPercent = totalEquity > 0 ? (dayPnl / (totalEquity - dayPnl)) * 100 : 0;
  const totalPnl = positions.reduce((s, p) => s + p.totalPnl, 0);
  const totalPnlPercent = totalEquity > 0 ? (totalPnl / (totalEquity - totalPnl)) * 100 : 0;

  return {
    equity: totalEquity + cash,
    buyingPower,
    cash,
    dayPnl,
    dayPnlPercent,
    totalPnl,
    totalPnlPercent,
    positions,
  };
}

// ─── Main Portfolio Tab ───────────────────────────────────────

export function PortfolioTab() {
  const router = useRouter();
  const { account, loading } = usePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();

  const [showSellBasketModal, setShowSellBasketModal] = useState<string | null>(null);
  const [showSellAllModal, setShowSellAllModal] = useState(false);
  const [sellAllConfirm, setSellAllConfirm] = useState('');
  const [showSellSheet, setShowSellSheet] = useState<Position | null>(null);
  const [expandedBaskets, setExpandedBaskets] = useState<Set<string>>(new Set());
  const [expandedHoldings, setExpandedHoldings] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());

  const investorStyle = user?.investorStyle || 'lynch';

  // Use real account if connected, else demo data
  const displayAccount = useMemo(() => {
    if (isConnected && account) return account;
    return buildDemoAccount(getDemoPortfolio(investorStyle));
  }, [isConnected, account, investorStyle]);

  if (loading && !isConnected) {
    return (
      <div className="p-4 space-y-3 pb-24">
        <div className="h-10 bg-slate-800 rounded-xl animate-pulse" />
        <div className="h-48 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="h-32 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="h-24 bg-slate-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!displayAccount) {
    return <div className="p-8 text-center text-slate-400">Loading portfolio…</div>;
  }

  // For now: all positions are core holdings (no basket data from API yet)
  // Later: wire real basket data
  const positions = displayAccount.positions || [];

  // Mock baskets (to be replaced with real API data)
  const mockBaskets = positions.length > 3 ? [
    {
      id: 'basket-1',
      name: 'AI Infrastructure',
      emoji: '🤖',
      positions: positions.slice(0, 3),
    },
    {
      id: 'basket-2',
      name: 'Clean Energy',
      emoji: '🌱',
      positions: positions.slice(3, 5).length > 0 ? positions.slice(3, 5) : [positions[0]],
    },
  ] : [];

  const coreHoldings = positions.filter((_, i) => {
    const basketSyms = new Set(mockBaskets.flatMap(b => b.positions.map(p => p.symbol)));
    return !basketSyms.has(positions[i].symbol);
  });

  const toggleBasket = (id: string) => {
    setExpandedBaskets(p => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleHolding = (sym: string) => {
    setExpandedHoldings(p => {
      const n = new Set(p);
      n.has(sym) ? n.delete(sym) : n.add(sym);
      return n;
    });
  };

  const toggleSelectSymbol = (sym: string) => {
    setSelectedSymbols(p => {
      const n = new Set(p);
      n.has(sym) ? n.delete(sym) : n.add(sym);
      return n;
    });
  };

  const selectedValue = positions
    .filter(p => selectedSymbols.has(p.symbol))
    .reduce((s, p) => s + p.marketValue, 0);

  return (
    <div className="pb-24">

      {/* ── 1. MARKET TICKER ── */}
      <MarketTicker />

      {/* ── Demo Banner ── */}
      {!isConnected && <div className="mx-4 mt-3"><DemoBanner /></div>}

      {/* ── 2. ACCOUNT CARD ── */}
      <AccountCard account={displayAccount} investorStyle={investorStyle} />

      {/* ── 3. BASKETS ── */}
      {mockBaskets.length > 0 && (
        <>
          <div className="flex items-center justify-between px-4 mt-6 mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Baskets</span>
            {!selectMode && (
              <button onClick={() => setSelectMode(true)}
                className="text-xs text-slate-400">
                Select &amp; Sell
              </button>
            )}
            {selectMode && (
              <button onClick={() => { setSelectMode(false); setSelectedSymbols(new Set()); }}
                className="text-xs text-cyan-400">
                Done
              </button>
            )}
          </div>

          {mockBaskets.map(basket => (
            <div key={basket.id} className="relative">
              {selectMode && (
                <button onClick={() => toggleSelectSymbol(basket.positions[0]?.symbol)}
                  className={`absolute left-6 top-4 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedSymbols.has(basket.positions[0]?.symbol)
                      ? 'border-cyan-500 bg-cyan-500/20' : 'border-slate-600'
                  }`}>
                  {selectedSymbols.has(basket.positions[0]?.symbol) && <span className="text-cyan-400 text-xs">✓</span>}
                </button>
              )}
              <BasketCard
                key={basket.id}
                id={basket.id}
                name={basket.name}
                emoji={basket.emoji}
                positions={basket.positions}
                expanded={expandedBaskets.has(basket.id)}
                onToggle={() => toggleBasket(basket.id)}
                onSellPosition={(pos) => setShowSellSheet(pos)}
                onSellEntire={() => setShowSellBasketModal(basket.id)}
              />
            </div>
          ))}
        </>
      )}

      {/* ── 4. CORE HOLDINGS ── */}
      {coreHoldings.length > 0 && (
        <>
          <div className="flex items-center justify-between px-4 mt-6 mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Core Holdings ({coreHoldings.length})</span>
            {!selectMode && (
              <button onClick={() => setSelectMode(true)}
                className="text-xs text-slate-400">
                Select &amp; Sell
              </button>
            )}
          </div>

          {coreHoldings.map(pos => (
            <div key={pos.symbol} className="relative">
              {selectMode && (
                <button onClick={() => toggleSelectSymbol(pos.symbol)}
                  className={`absolute left-6 top-4 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedSymbols.has(pos.symbol)
                      ? 'border-cyan-500 bg-cyan-500/20' : 'border-slate-600'
                  }`}>
                  {selectedSymbols.has(pos.symbol) && <span className="text-cyan-400 text-xs">✓</span>}
                </button>
              )}
              <HoldingRow
                position={pos}
                expanded={expandedHoldings.has(pos.symbol)}
                onToggle={() => toggleHolding(pos.symbol)}
                onBuy={() => router.push('/trade')}
                onSell={() => setShowSellSheet(pos)}
              />
            </div>
          ))}
        </>
      )}

      {/* ── 5. SECTOR ALLOCATION ── */}
      {positions.length > 0 && (
        <div className="mt-6 mb-3">
          <SectorBars positions={positions} />
        </div>
      )}

      {/* ── 6. SELL ENTIRE PORTFOLIO ── */}
      {!selectMode && positions.length > 0 && (
        <div className="mx-4 mt-4 mb-8">
          <button onClick={() => setShowSellAllModal(true)}
            className="w-full py-4 border border-red-500/40 text-red-400 rounded-2xl text-base font-semibold">
            Sell Entire Portfolio
          </button>
        </div>
      )}

      {/* ── Multi-select bottom bar ── */}
      {selectMode && selectedSymbols.size > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-40 bg-slate-900 border-t border-slate-800 p-4 flex items-center gap-3">
          <p className="text-sm text-white flex-1">
            <span className="text-cyan-400 font-semibold">{selectedSymbols.size}</span> selected · ~${selectedValue.toLocaleString()}
          </p>
          <button onClick={() => { setSelectedSymbols(new Set()); setSelectMode(false); }}
            className="text-slate-400 text-sm px-4 py-2">
            Cancel
          </button>
          <button
            className="bg-red-500 text-white text-sm font-semibold px-6 py-2 rounded-xl">
            Sell Selected
          </button>
        </div>
      )}

      {/* ── Sell Entire Portfolio Confirmation ── */}
      {showSellAllModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setShowSellAllModal(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-slate-900 rounded-t-3xl p-6 pb-safe border-t border-slate-700">
            <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4" />
            <h3 className="text-lg font-bold text-white mb-1">Sell Entire Portfolio</h3>
            <p className="text-sm text-slate-400 mb-4">
              This will sell all {positions.length} positions for ~${positions.reduce((s, p) => s + p.marketValue, 0).toLocaleString()}.
            </p>
            <p className="text-xs text-slate-400 mb-2">Type &quot;SELL&quot; to confirm</p>
            <input
              type="text" value={sellAllConfirm}
              onChange={e => setSellAllConfirm(e.target.value)}
              placeholder="SELL"
              className="w-full bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 text-white text-sm outline-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowSellAllModal(false); setSellAllConfirm(''); }}
                className="flex-1 py-3.5 text-slate-400 text-sm font-medium">
                Cancel
              </button>
              <button
                disabled={sellAllConfirm !== 'SELL'}
                className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-2xl text-sm font-semibold min-h-[52px]">
                Confirm Sell All
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Individual Sell Bottom Sheet ── */}
      {showSellSheet && (
        <SellBottomSheet
          position={showSellSheet}
          onClose={() => setShowSellSheet(null)}
          onConfirm={(cfg) => {
            console.log('Sell confirmed:', showSellSheet.symbol, cfg);
            setShowSellSheet(null);
          }}
        />
      )}

      {/* Hide scrollbar CSS */}
      <style jsx global>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
