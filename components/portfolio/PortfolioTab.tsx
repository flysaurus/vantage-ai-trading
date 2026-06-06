'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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

// Generate sparkline placeholder data
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
        <h3 className="text-lg font-bold text-white mb-1">Sell {position.symbol}</h3>
        <p className="text-sm text-slate-400 mb-4">{position.qty} shares · ${position.currentPrice.toFixed(2)}/share</p>

        <div className="space-y-3 mb-4">
          <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
            <input type="radio" checked={cfg.mode === 'all'} onChange={() => setCfg(p => ({ ...p, mode: 'all' }))} className="accent-cyan-500" />
            <div className="flex-1"><p className="text-white text-sm font-semibold">All shares ({position.qty})</p><p className="text-slate-400 text-xs">Est. ${((cfg.mode === 'all' ? position.qty : cfg.shares) * position.currentPrice).toLocaleString('en-US', DOLLAR_FMT)}</p></div>
          </label>
          <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
            <input type="radio" checked={cfg.mode === 'partial'} onChange={() => setCfg(p => ({ ...p, mode: 'partial' }))} className="accent-cyan-500" />
            <div className="flex-1"><p className="text-white text-sm font-semibold">Partial</p>
              {cfg.mode === 'partial' && (
                <div className="flex items-center gap-2 mt-2">
                  <input type="number" min={1} max={position.qty} value={cfg.shares}
                    onChange={e => setCfg(p => ({ ...p, shares: Math.min(position.qty, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm outline-none" />
                  <span className="text-slate-400 text-xs">of {position.qty}</span>
                </div>
              )}
            </div>
          </label>
        </div>

        <p className="text-xs text-slate-500 uppercase mb-2">Order Type</p>
        <div className="flex gap-2 mb-3">
          {(['Market', 'Limit', 'Stop'] as const).map(t => (
            <button key={t} onClick={() => setCfg(p => ({ ...p, orderType: t }))}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${cfg.orderType === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-400 border border-slate-700'}`}>{t}</button>
          ))}
        </div>

        <p className="text-xs text-slate-500 uppercase mb-2">Time in Force</p>
        <div className="flex gap-2 mb-3">
          {(['Day', 'GTC'] as const).map(t => (
            <button key={t} onClick={() => setCfg(p => ({ ...p, tif: t }))}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${cfg.tif === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-400 border border-slate-700'}`}>{t}</button>
          ))}
        </div>

        {cfg.orderType === 'Limit' && (
          <div className="mb-4">
            <p className="text-xs text-slate-500 uppercase mb-2">Limit Price</p>
            <div className="flex items-center bg-slate-800 rounded-xl border border-slate-700 px-4 py-3">
              <span className="text-slate-400 text-lg mr-2">$</span>
              <input type="number" step="0.01" value={cfg.limitPrice} onChange={e => setCfg(p => ({ ...p, limitPrice: e.target.value }))} placeholder="0.00" className="bg-transparent text-white text-lg font-semibold flex-1 outline-none placeholder-slate-600" />
            </div>
          </div>
        )}

        <div className="bg-slate-800 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-400">Estimated proceeds</p>
          <p className="text-base font-semibold text-cyan-400">${proceeds.toLocaleString('en-US', DOLLAR_FMT)}</p>
        </div>

        <div className="mb-4">
          <p className="text-xs text-slate-400 mb-2">Type &quot;SELL&quot; to confirm</p>
          <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="SELL" className="w-full bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 text-white text-sm outline-none" />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3.5 text-slate-400 text-sm font-medium">Cancel</button>
          <button disabled={!needsConfirm} onClick={() => onConfirm(cfg)} className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-2xl text-sm font-semibold min-h-[52px]">Confirm Sell</button>
        </div>
      </div>
    </>
  );
}

// ─── Market Ticker Strip ──────────────────────────────────────

function MarketTicker() {
  const [quotes, setQuotes] = useState<Record<string, { price: number; change: number; changePercent: number }>>({});
  useMemo(() => {
    fetch('/api/market/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: TICKER_SYMBOLS }) })
      .then(r => r.json())
      .then(data => {
        if (data.quotes) {
          const m: Record<string, any> = {};
          for (const sym of TICKER_SYMBOLS) {
            const q = data.quotes[sym];
            if (q) m[sym] = { price: q.price || 0, change: q.change || 0, changePercent: q.changePercent || 0 };
          }
          setQuotes(m);
        }
      }).catch(() => {});
  }, []);

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 overflow-x-auto whitespace-nowrap hide-scrollbar">
      {TICKER_SYMBOLS.map(sym => {
        const q = quotes[sym];
        const up = (q?.change ?? 0) >= 0;
        return (
          <span key={sym} className="inline-flex items-center gap-2 mr-6">
            <span className="text-sm font-semibold text-white">{sym}</span>
            {q ? (<><span className="text-xs text-slate-400">${q.price.toFixed(2)}</span><span className={`text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>{up ? '+' : ''}{q.change.toFixed(2)} ({up ? '+' : ''}{q.changePercent.toFixed(1)}%)</span></>) : <span className="text-xs text-slate-600">—</span>}
          </span>
        );
      })}
    </div>
  );
}

// ─── Account Card ─────────────────────────────────────────────

function AccountCard({ account }: { account: AccountSummary }) {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState<Timeframe>('1W');
  const isUp = account.totalPnl >= 0;

  const sparkData = useMemo(() => {
    const points = timeframe === '1D' ? 78 : timeframe === '1W' ? 50 : timeframe === '1M' ? 30 : timeframe === '3M' ? 90 : 120;
    return generateSparkline(account.equity * 0.94, points, account.equity * 0.002, isUp ? 0.01 : -0.005);
  }, [timeframe, account.equity, isUp]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 mx-4 mt-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Account Value</p>
      <div className="flex items-center justify-between mb-1">
        <p className="text-4xl font-bold text-white">${account.equity.toLocaleString('en-US', DOLLAR_FMT)}</p>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />Growth Chaser
          </span>
          <button onClick={() => router.push('/investor-style')} className="text-xs text-cyan-400">Change ›</button>
        </div>
      </div>

      <div className="h-20 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <defs>
              <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.2} />
                <stop offset="100%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Line type="monotone" dataKey="v" stroke={isUp ? '#10b981' : '#ef4444'} strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="v" fill="url(#accGrad)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex gap-1 justify-center -mt-1 mb-3">
        {TIMEFRAMES.map(tf => (
          <button key={tf} onClick={() => setTimeframe(tf)}
            className={`rounded-full px-3 py-1 text-xs transition ${timeframe === tf ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}>{tf}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-3">
        <div><p className="text-xs text-slate-500 uppercase">Today P&amp;L</p><p className={`text-xl font-semibold ${account.dayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(account.dayPnl)} ({pctStr(account.dayPnlPercent)})</p></div>
        <div><p className="text-xs text-slate-500 uppercase">Total P&amp;L</p><p className={`text-xl font-semibold ${account.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})</p></div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><p className="text-xs text-slate-500 uppercase">Buying Power</p><p className="text-xl font-semibold text-white">${account.buyingPower.toLocaleString('en-US', DOLLAR_FMT)}</p></div>
        <div><p className="text-xs text-slate-500 uppercase">Cash</p><p className="text-xl font-semibold text-white">${account.cash.toLocaleString('en-US', DOLLAR_FMT)}</p></div>
      </div>
    </div>
  );
}

// ─── Sector Allocation Bars ───────────────────────────────────

function SectorBars({ positions }: { positions: Position[] }) {
  const sectors = useMemo(() => {
    const map: Record<string, number> = {};
    const total = positions.reduce((s, p) => s + p.marketValue, 0);
    positions.forEach(p => { const sec = p.sector || 'Other'; map[sec] = (map[sec] || 0) + p.marketValue; });
    return Object.entries(map).map(([sector, value]) => ({ sector, value, pct: total > 0 ? (value / total) * 100 : 0 })).sort((a, b) => b.pct - a.pct);
  }, [positions]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 mx-4 p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Sector Allocation</p>
      {sectors.map(({ sector, pct }) => (
        <div key={sector} className="flex items-center gap-3 mb-3 last:mb-0">
          <span className="text-base text-white w-28 flex-shrink-0 truncate">{sector}</span>
          <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: getSectorColor(sector) }} />
          </div>
          <span className="text-base text-slate-400 w-10 text-right flex-shrink-0">{pct.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

// ─── 52-Week Range Bar ───────────────────────────────────────

function Week52Bar({ current, low, high }: { current: number; low: number; high: number }) {
  if (!high || !low || high <= low) return <span className="text-slate-600 text-base">—</span>;
  const range = high - low;
  const pct = Math.max(0, Math.min(100, ((current - low) / range) * 100));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <span className="text-xs text-slate-400 w-12 text-right">${low.toFixed(0)}</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded relative">
        <div className="absolute w-3 h-3 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 top-1/2" style={{ left: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-12">${high.toFixed(0)}</span>
    </div>
  );
}

// ─── Expanded Row Drawer ─────────────────────────────────────

function ExpandedDrawer({ position, onBuy, onSell }: { position: Position; onBuy: () => void; onSell: () => void }) {
  const isUp = position.dayChange >= 0;
  const sparkData = useMemo(() => generateSparkline(position.currentPrice, 48, position.currentPrice * 0.02, isUp ? 0.015 : -0.005), [position.symbol, position.currentPrice, isUp]);

  return (
    <div className="px-4 pb-4 border-b border-slate-800/60">
      <div className="h-16 mb-3 ml-[180px]">
        <ResponsiveContainer width="80%" height="100%">
          <LineChart data={sparkData}>
            <defs>
              <linearGradient id={`hg${position.symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.15} />
                <stop offset="100%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Line type="monotone" dataKey="v" stroke={isUp ? '#10b981' : '#ef4444'} strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="v" fill={`url(#hg${position.symbol})`} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-3 ml-[180px]">
        <button onClick={onBuy} className="flex-1 py-3 border border-cyan-500/40 text-cyan-400 rounded-xl text-base font-semibold min-h-[48px]">Buy More</button>
        <button onClick={onSell} className="flex-1 py-3 border border-red-500/40 text-red-400 rounded-xl text-base font-semibold min-h-[48px]">Sell</button>
      </div>
    </div>
  );
}

// ─── Data Table (Core Holdings) ──────────────────────────────

const HOLDING_COLS = [
  { key: 'last', label: 'Last', minW: 'min-w-[110px]' },
  { key: 'change', label: 'Change', minW: 'min-w-[110px]' },
  { key: 'dayGain', label: '$ Today G/L', minW: 'min-w-[120px]' },
  { key: 'dayGainPct', label: '% Today G/L', minW: 'min-w-[110px]' },
  { key: 'totalGain', label: '$ Total G/L', minW: 'min-w-[120px]' },
  { key: 'totalGainPct', label: '% Total G/L', minW: 'min-w-[110px]' },
  { key: 'value', label: '$ Value', minW: 'min-w-[120px]' },
  { key: 'pctOfAcct', label: '% of Acct', minW: 'min-w-[110px]' },
  { key: 'qty', label: 'Qty', minW: 'min-w-[100px]' },
  { key: 'avgCost', label: 'Avg Cost', minW: 'min-w-[110px]' },
  { key: 'totalCost', label: 'Total Cost', minW: 'min-w-[120px]' },
  { key: 'week52', label: '52-Wk Range', minW: 'min-w-[160px]' },
] as const;

function HoldingsTable({
  positions,
  expandedSet,
  onToggle,
  onSell,
  onBuy,
}: {
  positions: Position[];
  expandedSet: Set<string>;
  onToggle: (sym: string) => void;
  onSell: (pos: Position) => void;
  onBuy: (sym: string) => void;
}) {
  const gainColor = (v: number) => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const borderColor = (v: number) => v > 0 ? 'border-l-emerald-500' : v < 0 ? 'border-l-red-500' : 'border-l-slate-600';

  return (
    <div className="overflow-x-auto w-full">
      <div className="min-w-[1450px]">

        {/* Column headers */}
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 flex">
          <div className="sticky left-0 z-20 bg-slate-950 w-[180px] flex-shrink-0 py-4 px-4">
            <span className="text-xs font-bold uppercase text-slate-500">Symbol</span>
          </div>
          {HOLDING_COLS.map(col => (
            <div key={col.key} className={`${col.minW} flex-1 py-4 px-4 text-right`}>
              <span className="text-xs font-bold uppercase text-slate-500">{col.label}</span>
            </div>
          ))}
        </div>

        {/* Data rows */}
        {positions.map((pos, i) => {
          const isExpanded = expandedSet.has(pos.symbol);
          const changePerShare = pos.qty > 0 ? pos.dayChange / pos.qty : 0;
          const totalCost = pos.avgCost * pos.qty;
          return (
            <div key={pos.symbol}>
              {/* Main row */}
              <button
                onClick={() => onToggle(pos.symbol)}
                className={`w-full flex items-center min-h-[72px] border-b border-slate-800/60 ${i % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900'} ${borderColor(pos.totalPnl)}`}
                style={{ borderLeftWidth: '3px' }}
              >
                {/* Frozen symbol cell */}
                <div className="sticky left-0 z-10 bg-inherit w-[180px] flex-shrink-0 py-4 px-4 text-left">
                  <p className="text-xl font-bold text-white">{pos.symbol}</p>
                  <p className="text-sm text-slate-400 max-w-[160px] truncate">{pos.name || pos.symbol}</p>
                  <p className="text-xs text-slate-500">{pos.qty}sh</p>
                </div>

                {/* Last */}
                <div className="min-w-[110px] flex-1 py-4 px-4 text-right">
                  <p className="text-lg font-semibold text-white">${pos.currentPrice.toFixed(2)}</p>
                </div>
                {/* Change */}
                <div className="min-w-[110px] flex-1 py-4 px-4 text-right">
                  <p className={`text-lg font-semibold ${gainColor(changePerShare)}`}>
                    {changePerShare >= 0 ? '+' : ''}${Math.abs(changePerShare).toFixed(2)}
                  </p>
                </div>
                {/* $ Today G/L */}
                <div className="min-w-[120px] flex-1 py-4 px-4 text-right">
                  <p className={`text-lg font-semibold ${gainColor(pos.dayChange)}`}>{fmt(pos.dayChange)}</p>
                </div>
                {/* % Today G/L */}
                <div className="min-w-[110px] flex-1 py-4 px-4 text-right">
                  <p className={`text-base font-medium ${gainColor(pos.dayChangePercent)}`}>{pctStr(pos.dayChangePercent)}</p>
                </div>
                {/* $ Total G/L */}
                <div className="min-w-[120px] flex-1 py-4 px-4 text-right">
                  <p className={`text-lg font-semibold ${gainColor(pos.totalPnl)}`}>{fmt(pos.totalPnl)}</p>
                </div>
                {/* % Total G/L */}
                <div className="min-w-[110px] flex-1 py-4 px-4 text-right">
                  <p className={`text-base font-medium ${gainColor(pos.totalPnlPercent)}`}>{pctStr(pos.totalPnlPercent)}</p>
                </div>
                {/* $ Value */}
                <div className="min-w-[120px] flex-1 py-4 px-4 text-right">
                  <p className="text-lg font-semibold text-white">${pos.marketValue.toLocaleString()}</p>
                </div>
                {/* % of Acct */}
                <div className="min-w-[110px] flex-1 py-4 px-4 text-right">
                  <p className="text-base text-slate-400">{pos.portfolioPercent.toFixed(1)}%</p>
                </div>
                {/* Qty */}
                <div className="min-w-[100px] flex-1 py-4 px-4 text-right">
                  <p className="text-base text-slate-400">{pos.qty.toFixed(0)}</p>
                </div>
                {/* Avg Cost */}
                <div className="min-w-[110px] flex-1 py-4 px-4 text-right">
                  <p className="text-base text-slate-400">${pos.avgCost.toFixed(2)}</p>
                </div>
                {/* Total Cost */}
                <div className="min-w-[120px] flex-1 py-4 px-4 text-right">
                  <p className="text-base text-slate-400">${totalCost.toLocaleString('en-US', DOLLAR_FMT)}</p>
                </div>
                {/* 52-Wk Range */}
                <div className="min-w-[160px] flex-1 py-4 px-4 text-right">
                  <Week52Bar current={pos.currentPrice} low={pos.weekLow52 ?? pos.currentPrice * 0.7} high={pos.weekHigh52 ?? pos.currentPrice * 1.3} />
                </div>
              </button>

              {/* Expanded drawer */}
              {isExpanded && (
                <div className={i % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900'}>
                  <ExpandedDrawer position={pos} onBuy={() => onBuy(pos.symbol)} onSell={() => onSell(pos)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Build AccountSummary from demo + Finnhub ─────────────────

type QuoteEntry = { price: number; change: number; changePercent: number; previousClose: number; high52w?: number; low52w?: number };

function buildDemoAccount(
  demo: ReturnType<typeof getDemoPortfolio>,
  quotes: Record<string, QuoteEntry> | null,
): AccountSummary {
  const positions: Position[] = demo.positions.map((dp) => {
    const q = quotes?.[dp.symbol];
    const currentPrice = q?.price ?? dp.avgCost;
    const marketValue = currentPrice * dp.qty;
    const dayChange = q?.change ? q.change * dp.qty : 0;
    const dayChangePercent = q?.changePercent ?? 0;
    const totalPnl = (currentPrice - dp.avgCost) * dp.qty;
    const totalPnlPercent = dp.avgCost > 0 ? ((currentPrice / dp.avgCost) - 1) * 100 : 0;
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
      portfolioPercent: 0,
      sector: dp.sector,
      weekHigh52: q?.high52w ?? dp.weekHigh52,
      weekLow52: q?.low52w ?? dp.weekLow52,
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

  return { equity: totalEquity + cash, buyingPower, cash, dayPnl, dayPnlPercent, totalPnl, totalPnlPercent, positions };
}

// ─── Main Portfolio Tab ───────────────────────────────────────

export function PortfolioTab() {
  const router = useRouter();
  const { account, loading } = usePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();

  const [showSellAllModal, setShowSellAllModal] = useState(false);
  const [sellAllConfirm, setSellAllConfirm] = useState('');
  const [showSellSheet, setShowSellSheet] = useState<Position | null>(null);
  const [expandedHoldings, setExpandedHoldings] = useState<Set<string>>(new Set());

  const investorStyle = user?.investorStyle || 'lynch';
  const [displayAccount, setDisplayAccount] = useState<AccountSummary | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(false);

  useEffect(() => {
    if (isConnected && account) { setDisplayAccount(account); return; }
    if (isConnected && !account) return;
    const demo = getDemoPortfolio(investorStyle);
    setQuotesLoading(true);
    fetch('/api/market/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: demo.positions.map(p => p.symbol) }) })
      .then(r => r.json())
      .then(data => { setDisplayAccount(buildDemoAccount(demo, data.quotes || null)); setQuotesLoading(false); })
      .catch(() => { setDisplayAccount(buildDemoAccount(demo, null)); setQuotesLoading(false); });
  }, [isConnected, account, investorStyle]);

  if (loading || quotesLoading) {
    return (
      <div className="p-4 space-y-3 pb-24">
        <div className="h-10 bg-slate-800 rounded-xl animate-pulse" />
        <div className="h-48 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="h-32 bg-slate-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!displayAccount) return <div className="p-8 text-center text-slate-400">Loading portfolio…</div>;

  const positions = displayAccount.positions || [];

  const toggleHolding = (sym: string) => {
    setExpandedHoldings(p => { const n = new Set(p); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  };

  return (
    <div className="pb-24">
      <MarketTicker />
      {!isConnected && <div className="mx-4 mt-3"><DemoBanner /></div>}

      {/* ── ACCOUNT CARD ── */}
      <AccountCard account={displayAccount} />

      {/* ── CORE HOLDINGS TABLE ── */}
      {positions.length > 0 && (
        <>
          <div className="flex items-center justify-between px-4 mt-6 mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Core Holdings</span>
            <button onClick={() => {}} className="text-sm text-slate-400">Select &amp; Sell</button>
          </div>
          <HoldingsTable
            positions={positions}
            expandedSet={expandedHoldings}
            onToggle={toggleHolding}
            onSell={(pos) => setShowSellSheet(pos)}
            onBuy={(sym) => router.push('/trade')}
          />
        </>
      )}

      {/* ── SELL ENTIRE PORTFOLIO ── */}
      {positions.length > 0 && (
        <div className="mx-4 my-6">
          <button onClick={() => setShowSellAllModal(true)} className="w-full py-4 border border-red-500/40 text-red-400 rounded-2xl text-base font-semibold min-h-[56px]">
            Sell Entire Portfolio
          </button>
        </div>
      )}

      {/* ── SECTOR ALLOCATION ── */}
      {positions.length > 0 && (
        <div className="mb-32">
          <SectorBars positions={positions} />
        </div>
      )}

      {/* ── Sell Entire Portfolio Confirmation ── */}
      {showSellAllModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setShowSellAllModal(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-slate-900 rounded-t-3xl p-6 pb-safe border-t border-slate-700">
            <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4" />
            <h3 className="text-lg font-bold text-white mb-1">Sell Entire Portfolio</h3>
            <p className="text-sm text-slate-400 mb-4">This will sell all {positions.length} positions for ~${positions.reduce((s, p) => s + p.marketValue, 0).toLocaleString()}.</p>
            <p className="text-xs text-slate-400 mb-2">Type &quot;SELL&quot; to confirm</p>
            <input type="text" value={sellAllConfirm} onChange={e => setSellAllConfirm(e.target.value)} placeholder="SELL" className="w-full bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 text-white text-sm outline-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => { setShowSellAllModal(false); setSellAllConfirm(''); }} className="flex-1 py-3.5 text-slate-400 text-sm font-medium">Cancel</button>
              <button disabled={sellAllConfirm !== 'SELL'} className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-2xl text-sm font-semibold min-h-[52px]">Confirm Sell All</button>
            </div>
          </div>
        </>
      )}

      {/* ── Individual Sell Bottom Sheet ── */}
      {showSellSheet && (
        <SellBottomSheet position={showSellSheet} onClose={() => setShowSellSheet(null)} onConfirm={(cfg) => { console.log('Sell:', showSellSheet.symbol, cfg); setShowSellSheet(null); }} />
      )}

      <style jsx global>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
