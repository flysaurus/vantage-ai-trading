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

const SPARKLINE_WEEK: { date: string; value: number }[] = [
  { date: 'Mon', value: 118000 },
  { date: 'Tue', value: 122000 },
  { date: 'Wed', value: 119500 },
  { date: 'Thu', value: 124800 },
  { date: 'Fri', value: 126200 },
  { date: 'Sat', value: 125100 },
  { date: 'Sun', value: 127000 },
];

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
function generateSparkline(base: number, points: number) {
  const data: { v: number }[] = [];
  let val = base;
  for (let i = 0; i < points; i++) {
    val += base * 0.008 * (Math.random() - 0.45);
    val = Math.max(val, base * 0.75);
    data.push({ v: val });
  }
  return data;
}

// ─── Sell Bottom Sheet (checkbox-driven) ──────────────────────

interface SellConfig {
  mode: 'all' | 'partial';
  shares: number;
  orderType: 'Market' | 'Limit' | 'Stop';
  tif: 'Day' | 'GTC';
  limitPrice: string;
}

function SellBottomSheet({
  positions,
  onClose,
}: {
  positions: Position[];
  onClose: () => void;
}) {
  const single = positions.length === 1 ? positions[0] : null;
  const isAll = positions.length > 1;
  const [cfg, setCfg] = useState<SellConfig>({
    mode: 'all',
    shares: single?.qty ?? 0,
    orderType: 'Market',
    tif: 'Day',
    limitPrice: '',
  });
  const [confirmText, setConfirmText] = useState('');

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const needsConfirm = isAll ? confirmText === 'SELL' : true;
  const proceeds = single && cfg.mode !== 'all'
    ? cfg.shares * single.currentPrice
    : totalValue;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-slate-900 rounded-t-3xl p-6 pb-safe max-h-[85vh] overflow-y-auto border-t border-slate-700">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4" />

        {/* Title */}
        <h3 className={`text-lg font-bold mb-1 ${isAll ? 'text-red-400' : 'text-white'}`}>
          {isAll ? 'Sell Entire Portfolio' : `Sell ${single?.symbol}`}
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          {isAll
            ? `${positions.length} positions · ~$${totalValue.toLocaleString('en-US', DOLLAR_FMT)}`
            : `${single?.qty} shares · $${single?.currentPrice.toFixed(2)}/share`}
        </p>

        {/* Multi-position list */}
        {isAll && (
          <div className="space-y-1.5 mb-4 max-h-[200px] overflow-y-auto">
            {positions.map(p => (
              <p key={p.symbol} className="text-sm text-slate-400">{p.symbol} · {p.qty}sh · ~${p.marketValue.toLocaleString()}</p>
            ))}
          </div>
        )}

        {/* Single-position options */}
        {single && !isAll && (
          <div className="space-y-3 mb-4">
            <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
              <input type="radio" checked={cfg.mode === 'all'} onChange={() => setCfg(p => ({ ...p, mode: 'all' }))} className="accent-cyan-500" />
              <div className="flex-1"><p className="text-white text-sm font-semibold">All shares ({single.qty})</p><p className="text-slate-400 text-xs">Est. ${(single.qty * single.currentPrice).toLocaleString('en-US', DOLLAR_FMT)}</p></div>
            </label>
            <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
              <input type="radio" checked={cfg.mode === 'partial'} onChange={() => setCfg(p => ({ ...p, mode: 'partial' }))} className="accent-cyan-500" />
              <div className="flex-1"><p className="text-white text-sm font-semibold">Partial</p>
                {cfg.mode === 'partial' && (
                  <div className="flex items-center gap-2 mt-2">
                    <input type="number" min={1} max={single.qty} value={cfg.shares}
                      onChange={e => setCfg(p => ({ ...p, shares: Math.min(single.qty, Math.max(1, parseInt(e.target.value) || 1)) }))}
                      className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm outline-none" />
                    <span className="text-slate-400 text-xs">of {single.qty}</span>
                  </div>
                )}
              </div>
            </label>
          </div>
        )}

        {!isAll && (
          <>
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
          </>
        )}

        <div className="bg-slate-800 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-400">Estimated proceeds</p>
          <p className="text-base font-semibold text-cyan-400">${proceeds.toLocaleString('en-US', DOLLAR_FMT)}</p>
        </div>

        {isAll && (
          <div className="mb-4">
            <p className="text-xs text-slate-400 mb-2">Type &quot;SELL&quot; to confirm</p>
            <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="SELL" className="w-full bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 text-white text-sm outline-none" />
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3.5 text-slate-400 text-sm font-medium">Cancel</button>
          <button disabled={!needsConfirm} onClick={() => { console.log('Sell:', positions.map(p => p.symbol), cfg); onClose(); }} className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-2xl text-sm font-semibold min-h-[52px]">Confirm Sell</button>
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
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 overflow-x-auto whitespace-nowrap hide-scrollbar">
      {TICKER_SYMBOLS.map(sym => {
        const q = quotes[sym];
        const up = (q?.change ?? 0) >= 0;
        return (
          <span key={sym} className="inline-flex items-center gap-4 mr-6 text-base font-semibold">
            <span className="text-white">{sym}</span>
            {q ? (<><span className="text-slate-400 font-normal">${q.price.toFixed(2)}</span><span className={`font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>{up ? '+' : ''}{q.change.toFixed(2)} ({up ? '+' : ''}{q.changePercent.toFixed(1)}%)</span></>) : <span className="text-slate-600 font-normal">—</span>}
          </span>
        );
      })}
    </div>
  );
}

// ─── Account Card ─────────────────────────────────────────────

function AccountCard({ account, styleLabel }: { account: AccountSummary; styleLabel: string }) {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState<Timeframe>('1W');
  const isUp = account.totalPnl >= 0;

  const sparkData = useMemo(() => {
    // Use flat placeholder data for the sparkline
    const mult = account.equity / 127000;
    return SPARKLINE_WEEK.map(d => ({ v: d.value * mult }));
  }, [account.equity]);

  return (
    <div className="px-4 mt-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Account Value</p>
      <p className="text-3xl font-bold text-white mb-2">${account.equity.toLocaleString('en-US', DOLLAR_FMT)}</p>

      {/* Growth Chaser - stacked */}
      <div className="mb-2">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <span className="text-base text-slate-400">{styleLabel}</span>
        </div>
        <button onClick={() => router.push('/investor-style')} className="text-sm text-cyan-400 ml-3.5">Change ›</button>
      </div>

      {/* Sparkline */}
      <div className="h-40 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <defs>
              <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Line type="monotone" dataKey="v" stroke="#10b981" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="v" fill="url(#accGrad)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex gap-1 justify-center -mt-1 mb-4">
        {TIMEFRAMES.map(tf => (
          <button key={tf} onClick={() => setTimeframe(tf)}
            className={`rounded-full px-3 py-1 text-xs transition ${timeframe === tf ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}>{tf}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-3">
        <div><p className="text-xs text-slate-500 uppercase">Today P&amp;L</p><p className={`text-xl font-semibold ${account.dayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(account.dayPnl)} ({pctStr(account.dayPnlPercent)})</p></div>
        <div><p className="text-xs text-slate-500 uppercase">Total P&amp;L</p><p className={`text-xl font-semibold ${account.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})</p></div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-2">
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
    <div className="px-4">
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
  const rawPct = range > 0 ? ((current - low) / range) * 100 : 50;
  const pct = Math.min(98, Math.max(2, rawPct));
  return (
    <div className="min-w-[160px] overflow-hidden">
      <p className="text-xs text-slate-400 text-right mb-1">${high.toFixed(0)}</p>
      <div className="w-full h-1.5 bg-slate-700 rounded-full relative">
        <div className="absolute w-2.5 h-2.5 bg-white rounded-full" style={{ left: `${pct}%`, top: '-4px' }} />
      </div>
      <p className="text-xs text-slate-400 text-left mt-1">${low.toFixed(0)}</p>
    </div>
  );
}

// ─── Expanded Row Drawer ─────────────────────────────────────

function ExpandedDrawer({ position, onBuy, onSell }: { position: Position; onBuy: () => void; onSell: () => void }) {
  const sparkData = useMemo(() => generateSparkline(position.currentPrice, 48), [position.symbol, position.currentPrice]);

  return (
    <div className="px-4 pb-4 border-b border-slate-800/60">
      <div className="h-16 mb-3 ml-[144px]">
        <ResponsiveContainer width="80%" height="100%">
          <LineChart data={sparkData}>
            <defs>
              <linearGradient id={`hg${position.symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Line type="monotone" dataKey="v" stroke="#10b981" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="v" fill={`url(#hg${position.symbol})`} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-3 ml-[144px]">
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
  selectedSet,
  onToggle,
  onToggleSelect,
  onSell,
  onBuy,
}: {
  positions: Position[];
  expandedSet: Set<string>;
  selectedSet: Set<string>;
  onToggle: (sym: string) => void;
  onToggleSelect: (sym: string) => void;
  onSell: (pos: Position) => void;
  onBuy: (sym: string) => void;
}) {
  const gainColor = (v: number) => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const borderColor = (v: number) => v > 0 ? 'border-l-emerald-500' : v < 0 ? 'border-l-red-500' : 'border-l-slate-600';

  return (
    <div className="overflow-x-auto w-full px-4">
      <div className="min-w-[1470px]">

        {/* Column headers */}
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 flex">
          <div className="sticky left-0 z-20 bg-slate-950 w-[144px] flex-shrink-0 py-4 pl-4">
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
          const isSelected = selectedSet.has(pos.symbol);
          const changePerShare = pos.qty > 0 ? pos.dayChange / pos.qty : 0;
          const totalCost = pos.avgCost * pos.qty;

          return (
            <div key={pos.symbol}>
              {/* Main row */}
              <div className={`w-full flex items-center min-h-[68px] border-b border-slate-800/60 ${i % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900'} ${borderColor(pos.totalPnl)}`}
                style={{ borderLeftWidth: '3px' }}
              >
                {/* Frozen symbol cell with checkbox */}
                <div className="sticky left-0 z-10 bg-inherit w-[144px] flex-shrink-0 py-3 pl-4 text-left flex items-center gap-2">
                  {/* Checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(pos.symbol); }}
                    className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 transition ${isSelected ? 'bg-cyan-500 border-cyan-500' : 'bg-transparent border-slate-600'}`}
                  >
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5L10 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                  </button>
                  {/* Symbol info (tappable for expand) */}
                  <button onClick={() => onToggle(pos.symbol)} className="text-left min-w-0">
                    <p className="text-xl font-bold text-white">{pos.symbol}</p>
                    <p className="text-sm text-slate-400 max-w-[100px] truncate">{pos.name || pos.symbol}</p>
                  </button>
                </div>

                {/* Last */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[110px] flex-1 py-3 px-4 text-right">
                  <p className="text-lg font-semibold text-white">${pos.currentPrice.toFixed(2)}</p>
                </button>
                {/* Change */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[110px] flex-1 py-3 px-4 text-right">
                  <p className={`text-lg font-semibold ${gainColor(changePerShare)}`}>
                    {changePerShare >= 0 ? '+' : ''}${Math.abs(changePerShare).toFixed(2)}
                  </p>
                </button>
                {/* $ Today G/L */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[120px] flex-1 py-3 px-4 text-right">
                  <p className={`text-lg font-semibold ${gainColor(pos.dayChange)}`}>{fmt(pos.dayChange)}</p>
                </button>
                {/* % Today G/L */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[110px] flex-1 py-3 px-4 text-right">
                  <p className={`text-base font-medium ${gainColor(pos.dayChangePercent)}`}>{pctStr(pos.dayChangePercent)}</p>
                </button>
                {/* $ Total G/L */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[120px] flex-1 py-3 px-4 text-right">
                  <p className={`text-lg font-semibold ${gainColor(pos.totalPnl)}`}>{fmt(pos.totalPnl)}</p>
                </button>
                {/* % Total G/L */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[110px] flex-1 py-3 px-4 text-right">
                  <p className={`text-base font-medium ${gainColor(pos.totalPnlPercent)}`}>{pctStr(pos.totalPnlPercent)}</p>
                </button>
                {/* $ Value */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[120px] flex-1 py-3 px-4 text-right">
                  <p className="text-lg font-semibold text-white">${pos.marketValue.toLocaleString()}</p>
                </button>
                {/* % of Acct */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[110px] flex-1 py-3 px-4 text-right">
                  <p className="text-base text-slate-400">{pos.portfolioPercent.toFixed(1)}%</p>
                </button>
                {/* Qty */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[100px] flex-1 py-3 px-4 text-right">
                  <p className="text-base text-slate-400">{pos.qty.toFixed(0)}</p>
                </button>
                {/* Avg Cost */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[110px] flex-1 py-3 px-4 text-right">
                  <p className="text-base text-slate-400">${pos.avgCost.toFixed(2)}</p>
                </button>
                {/* Total Cost */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[120px] flex-1 py-3 px-4 text-right">
                  <p className="text-base text-slate-400">${totalCost.toLocaleString('en-US', DOLLAR_FMT)}</p>
                </button>
                {/* 52-Wk Range */}
                <button onClick={() => onToggle(pos.symbol)} className="min-w-[160px] flex-1 py-3 px-4">
                  <Week52Bar current={pos.currentPrice} low={pos.weekLow52 ?? pos.currentPrice * 0.7} high={pos.weekHigh52 ?? pos.currentPrice * 1.3} />
                </button>
              </div>

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

// ─── Slide-Up Sell Bar ────────────────────────────────────────

function SellBar({
  selected,
  positions,
  onDismiss,
  onSellSelected,
}: {
  selected: string[];
  positions: Position[];
  onDismiss: () => void;
  onSellSelected: () => void;
}) {
  if (selected.length === 0) return null;
  const selectedPositions = positions.filter(p => selected.includes(p.symbol));
  const totalValue = selectedPositions.reduce((s, p) => s + p.marketValue, 0);
  const single = selected.length === 1 ? selectedPositions[0] : null;

  let label = `${selected.length} selected · ~$${Math.round(totalValue).toLocaleString()}`;
  if (selected.length === positions.length) {
    label = `All ${selected.length} selected · ~$${Math.round(totalValue).toLocaleString()}`;
  }

  let buttonText = `Sell Selected (${selected.length})`;
  if (selected.length === positions.length && positions.length > 1) {
    buttonText = 'Sell Portfolio';
  } else if (selected.length === 1 && single) {
    buttonText = `Sell ${single.symbol}`;
  }

  return (
    <div className="fixed bottom-[64px] left-0 right-0 z-40 bg-slate-900 border-t border-slate-800 px-4 py-4 flex items-center justify-between">
      <button onClick={onDismiss} className="text-base text-white font-medium">{label}</button>
      <button onClick={onSellSelected} className="bg-red-500 text-white rounded-xl px-6 py-3 text-base font-semibold">{buttonText}</button>
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

  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [showSellSheet, setShowSellSheet] = useState<Position[] | null>(null);
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
      <div className="px-4 pt-4 space-y-3 pb-24">
        <div className="h-10 bg-slate-800 rounded-xl animate-pulse" />
        <div className="h-48 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="h-32 bg-slate-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!displayAccount) return <div className="p-8 text-center text-slate-400">Loading portfolio…</div>;

  const positions = displayAccount.positions || [];
  const styleLabel = getDemoPortfolio(investorStyle).name.replace(/.*· /, '');

  const toggleHolding = (sym: string) => {
    setExpandedHoldings(p => { const n = new Set(p); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  };

  const toggleSelectSymbol = (sym: string) => {
    setSelectedSet(p => { const n = new Set(p); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  };

  const selectedArr = [...selectedSet];
  const selectedPositions = positions.filter(p => selectedArr.includes(p.symbol));

  return (
    <div className="pb-24">
      <MarketTicker />
      {!isConnected && <div className="mt-3"><DemoBanner /></div>}

      {/* ── ACCOUNT CARD ── */}
      <AccountCard account={displayAccount} styleLabel={styleLabel} />

      {/* ── CORE HOLDINGS TABLE ── */}
      {positions.length > 0 && (
        <>
          <div className="flex items-center justify-between px-4 mt-6 mb-2">
            <span className="text-sm font-bold text-white uppercase tracking-wider">Core Holdings</span>
          </div>
          <HoldingsTable
            positions={positions}
            expandedSet={expandedHoldings}
            selectedSet={selectedSet}
            onToggle={toggleHolding}
            onToggleSelect={toggleSelectSymbol}
            onSell={(pos) => { setShowSellSheet([pos]); setSelectedSet(new Set()); }}
            onBuy={(sym) => router.push('/trade')}
          />
        </>
      )}

      {/* ── SELL ENTIRE PORTFOLIO ── */}
      {positions.length > 0 && (
        <div className="px-4 my-6">
          <button onClick={() => setShowSellSheet(positions)} className="w-full py-4 border border-red-500/40 text-red-400 rounded-2xl text-base font-semibold min-h-[56px]">
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

      {/* ── Slide-up Sell Bar ── */}
      <SellBar
        selected={selectedArr}
        positions={positions}
        onDismiss={() => setSelectedSet(new Set())}
        onSellSelected={() => {
          if (selectedPositions.length > 0) {
            setShowSellSheet(selectedPositions);
          }
        }}
      />

      {/* ── Sell Bottom Sheet ── */}
      {showSellSheet && (
        <SellBottomSheet positions={showSellSheet} onClose={() => setShowSellSheet(null)} />
      )}

      <style jsx global>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
