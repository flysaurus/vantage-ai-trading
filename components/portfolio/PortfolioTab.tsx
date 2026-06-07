'use client';

import { useState, useEffect } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import DemoBanner from '@/components/shared/DemoBanner';
import { getDemoPortfolio } from '@/lib/demo-data';
import type { Position, AccountSummary } from '@/types';

// ─── Helpers ──────────────────────────────────────────────

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const fmt = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;

const pctStr = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

const gain = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400');

// ─── Account Card ─────────────────────────────────────────

function AccountCard({ account }: { account: AccountSummary }) {
  return (
    <div className="mx-4 mt-4 bg-slate-900 rounded-2xl border border-slate-800 p-5">
      {/* Account Value */}
      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">
        Account Value
      </p>
      <p className="text-4xl font-bold text-white">
        ${account.equity.toLocaleString('en-US', DOLLAR_FMT)}
      </p>
      <p className={`text-sm mt-1 ${gain(account.totalPnl)}`}>
        {fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)}) all time
      </p>

      {/* Divider */}
      <div className="border-t border-slate-800 my-4" />

      {/* Sparkline placeholder */}
      <div className="h-20 w-full bg-slate-800 rounded-xl mt-3 mb-3" />

      {/* Divider */}
      <div className="border-t border-slate-800 my-4" />

      {/* 2-col stats */}
      <div className="grid grid-cols-2 gap-y-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider">Today P&amp;L</p>
          <p className={`text-base font-semibold ${gain(account.dayPnl)}`}>
            {fmt(account.dayPnl)} ({pctStr(account.dayPnlPercent)})
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider">Total P&amp;L</p>
          <p className={`text-base font-semibold ${gain(account.totalPnl)}`}>
            {fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider">Buying Power</p>
          <p className="text-base font-semibold text-white">
            ${account.buyingPower.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider">Cash</p>
          <p className="text-base font-semibold text-white">
            ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Position Card ────────────────────────────────────────

function PositionCard({
  pos,
  isSelectMode,
  isSelected,
  onToggle,
}: {
  pos: Position;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const borderL =
    pos.dayChange > 0
      ? 'border-l-emerald-500'
      : pos.dayChange < 0
        ? 'border-l-red-500'
        : 'border-l-slate-600';

  return (
    <div
      onClick={onToggle}
      className={`mx-4 mb-2 rounded-2xl bg-slate-900 border border-slate-800 px-4 py-4 min-h-[72px] flex justify-between items-center border-l-[3px] ${borderL} transition-colors duration-200 cursor-pointer active:opacity-80 ${isSelected ? 'border-cyan-500' : ''}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {isSelectMode && (
          <div
            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
              isSelected
                ? 'bg-cyan-500 border-cyan-500'
                : 'bg-transparent border-slate-600'
            }`}
          >
            {isSelected && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6l2.5 2.5L10 3.5"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        )}
        <div>
          <p className="text-lg font-bold text-white">{pos.symbol}</p>
          <p className="text-xs text-slate-400 mt-0.5">{pos.qty} shares</p>
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className="text-base font-semibold text-white">
          ${pos.marketValue.toLocaleString('en-US', DOLLAR_FMT)}
        </p>
        <p className={`text-xs mt-0.5 ${gain(pos.totalPnl)}`}>
          {fmt(pos.totalPnl)} ({pctStr(pos.totalPnlPercent)})
        </p>
      </div>
    </div>
  );
}

// ─── Sell Bottom Sheet ────────────────────────────────────

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
  const multi = positions.length > 1;

  const [cfg, setCfg] = useState<SellConfig>({
    mode: 'all',
    shares: single?.qty ?? 0,
    orderType: 'Market',
    tif: 'Day',
    limitPrice: '',
  });
  const [confirmText, setConfirmText] = useState('');

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const proceeds = single && cfg.mode === 'partial'
    ? cfg.shares * single.currentPrice
    : totalValue;

  const canConfirm = multi
    ? confirmText === 'SELL'
    : true;

  // Title
  const title = multi
    ? 'Sell Entire Portfolio'
    : `Sell ${single?.symbol}`;

  const subtitle = multi
    ? `Type SELL to confirm`
    : `${single?.qty} shares · $${single?.currentPrice.toFixed(2)}/share`;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-slate-900 rounded-t-3xl p-6 pb-safe max-h-[85vh] overflow-y-auto border-t border-slate-700">
        {/* Handle */}
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4" />

        {/* Title */}
        <h3 className={`text-xl font-bold ${multi ? 'text-red-400' : 'text-white'}`}>
          {title}
        </h3>
        <p className="text-sm text-slate-400 mt-1">{subtitle}</p>

        {/* Multi-position list */}
        {multi && (
          <div className="space-y-1.5 my-4 max-h-[200px] overflow-y-auto">
            {positions.map(p => (
              <p key={p.symbol} className="text-sm text-slate-400">
                {p.symbol} · {p.qty}sh · ~$
                {p.marketValue.toLocaleString('en-US', DOLLAR_FMT)}
              </p>
            ))}
            <p className="text-xs text-slate-500 mt-2">All at market price</p>
          </div>
        )}

        {/* Single-position options */}
        {single && !multi && (
          <>
            {/* Quantity */}
            <div className="space-y-3 my-4">
              <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  checked={cfg.mode === 'all'}
                  onChange={() => setCfg(p => ({ ...p, mode: 'all' }))}
                  className="accent-cyan-500"
                />
                <div className="flex-1">
                  <p className="text-white text-sm font-semibold">
                    All shares ({single.qty})
                  </p>
                  <p className="text-slate-400 text-xs">
                    Est. $
                    {(single.qty * single.currentPrice).toLocaleString('en-US', DOLLAR_FMT)}
                  </p>
                </div>
              </label>
              <label className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  checked={cfg.mode === 'partial'}
                  onChange={() => setCfg(p => ({ ...p, mode: 'partial' }))}
                  className="accent-cyan-500"
                />
                <div className="flex-1">
                  <p className="text-white text-sm font-semibold">Partial</p>
                  {cfg.mode === 'partial' && (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        min={1}
                        max={single.qty}
                        value={cfg.shares}
                        onChange={e =>
                          setCfg(p => ({
                            ...p,
                            shares: Math.min(single.qty, Math.max(1, parseInt(e.target.value) || 1)),
                          }))
                        }
                        className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm outline-none"
                      />
                      <span className="text-slate-400 text-xs">of {single.qty}</span>
                    </div>
                  )}
                </div>
              </label>
            </div>

            {/* Order Type */}
            <p className="text-xs text-slate-500 uppercase mb-2">Order Type</p>
            <div className="flex gap-2 mb-3">
              {(['Market', 'Limit', 'Stop'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setCfg(p => ({ ...p, orderType: t }))}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    cfg.orderType === t
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Time in Force */}
            <p className="text-xs text-slate-500 uppercase mb-2">Time in Force</p>
            <div className="flex gap-2 mb-3">
              {(['Day', 'GTC'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setCfg(p => ({ ...p, tif: t }))}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    cfg.tif === t ? 'bg-slate-700 text-white' : 'text-slate-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Limit Price */}
            {cfg.orderType === 'Limit' && (
              <div className="mb-4">
                <p className="text-xs text-slate-500 uppercase mb-2">Limit Price</p>
                <div className="flex items-center bg-slate-800 rounded-xl border border-slate-700 px-4 py-3">
                  <span className="text-slate-400 text-lg mr-2">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={cfg.limitPrice}
                    onChange={e => setCfg(p => ({ ...p, limitPrice: e.target.value }))}
                    placeholder="0.00"
                    className="bg-transparent text-white text-lg font-semibold flex-1 outline-none placeholder-slate-600"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Estimated proceeds */}
        <div className="bg-slate-800 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-400">Est. proceeds</p>
          <p className="text-base font-semibold text-cyan-400 mt-1">
            ${proceeds.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>

        {/* Confirm text (portfolio only) */}
        {multi && (
          <div className="mb-4">
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="SELL"
              className="w-full bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 text-white text-sm outline-none mt-2"
            />
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3">
          <button onClick={onClose} className="text-slate-400 text-sm font-medium py-3">
            Cancel
          </button>
          <button
            disabled={!canConfirm}
            onClick={() => {
              console.log('Sell:', positions.map(p => p.symbol), cfg);
              onClose();
            }}
            className="flex-1 ml-3 bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-2xl min-h-[52px] text-base font-semibold"
          >
            Confirm Sell
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Slide-Up Sell Bar ────────────────────────────────────

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

  const sel = positions.filter(p => selected.includes(p.symbol));
  const totalVal = sel.reduce((s, p) => s + p.marketValue, 0);
  const all = selected.length === positions.length && positions.length > 1;
  const one = sel[0];

  let btnLabel = `Sell Selected (${selected.length})`;
  if (all) btnLabel = 'Sell Portfolio';
  else if (selected.length === 1 && one) btnLabel = `Sell ${one.symbol}`;

  return (
    <div className="fixed bottom-[64px] left-0 right-0 z-40 bg-slate-900 border-t border-slate-800 px-4 py-3 flex justify-between items-center animate-slide-up">
      <div>
        <p className="text-sm font-semibold text-white">{selected.length} selected</p>
        <p className="text-xs text-slate-400">
          ~${Math.round(totalVal).toLocaleString('en-US', DOLLAR_FMT)}
        </p>
      </div>
      <div className="flex items-center">
        <button onClick={onDismiss} className="text-sm text-slate-400 mr-3">
          Cancel
        </button>
        <button
          onClick={onSellSelected}
          className="bg-red-500 text-white rounded-xl px-6 py-2.5 text-sm font-semibold"
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Build Demo Account ───────────────────────────────────

type QuoteEntry = {
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
};

function buildDemoAccount(
  demo: ReturnType<typeof getDemoPortfolio>,
  quotes: Record<string, QuoteEntry> | null,
): AccountSummary {
  const positions: Position[] = demo.positions.map(dp => {
    const q = quotes?.[dp.symbol];
    const currentPrice = q?.price ?? dp.avgCost;
    const marketValue = currentPrice * dp.qty;
    const dayChange = q?.change ? q.change * dp.qty : 0;
    const dayChangePercent = q?.changePercent ?? 0;
    const totalPnl = (currentPrice - dp.avgCost) * dp.qty;
    const totalPnlPercent = dp.avgCost > 0 ? (currentPrice / dp.avgCost - 1) * 100 : 0;

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
    };
  });

  const totalEquity = positions.reduce((s, p) => s + p.marketValue, 0);
  positions.forEach(p => {
    p.portfolioPercent = totalEquity > 0 ? (p.marketValue / totalEquity) * 100 : 0;
  });

  const cash = 11617.4;
  const buyingPower = 145217.48;
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

// ─── Main Tab ─────────────────────────────────────────────

export function PortfolioTab() {
  const { account, loading } = usePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [showSellSheet, setShowSellSheet] = useState<Position[] | null>(null);

  const investorStyle = user?.investorStyle || 'lynch';
  const [displayAccount, setDisplayAccount] = useState<AccountSummary | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(false);

  useEffect(() => {
    if (isConnected && account) {
      setDisplayAccount(account);
      return;
    }
    if (isConnected && !account) return;

    const demo = getDemoPortfolio(investorStyle);
    setQuotesLoading(true);
    fetch('/api/market/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: demo.positions.map(p => p.symbol) }),
    })
      .then(r => r.json())
      .then(data => {
        setDisplayAccount(buildDemoAccount(demo, data.quotes || null));
        setQuotesLoading(false);
      })
      .catch(() => {
        setDisplayAccount(buildDemoAccount(demo, null));
        setQuotesLoading(false);
      });
  }, [isConnected, account, investorStyle]);

  // Loading
  if (loading || quotesLoading) {
    return (
      <div className="px-4 pt-4 space-y-3 pb-24">
        <div className="h-10 bg-slate-800 rounded-xl animate-pulse" />
        <div className="h-56 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="h-8 bg-slate-800 rounded-lg animate-pulse w-32" />
        <div className="h-16 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="h-16 bg-slate-800 rounded-2xl animate-pulse" />
        <div className="h-16 bg-slate-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!displayAccount) {
    return <div className="p-8 text-center text-slate-400">Loading portfolio…</div>;
  }

  const positions = displayAccount.positions || [];

  const toggleSelect = (sym: string) => {
    setSelectedSet(prev => {
      const n = new Set(prev);
      n.has(sym) ? n.delete(sym) : n.add(sym);
      return n;
    });
  };

  const selectedArr = [...selectedSet];
  const selectedPositions = positions.filter(p => selectedArr.includes(p.symbol));

  return (
    <div className="pb-24">
      {/* 1. Demo banner */}
      {!isConnected && <DemoBanner />}

      {/* 2. Account Card */}
      <AccountCard account={displayAccount} />

      {/* 4. Core Holdings */}
      {positions.length > 0 && (
        <div className="px-4 mt-6 mb-2 flex justify-between items-center">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Core Holdings
          </span>
          <button
            onClick={() => {
              setIsSelectMode(prev => !prev);
              if (isSelectMode) setSelectedSet(new Set());
            }}
            className={`text-xs ${isSelectMode ? 'text-cyan-400' : 'text-slate-400'}`}
          >
            {isSelectMode ? 'Done' : 'Select'}
          </button>
        </div>
      )}

      {/* 5. Position Cards */}
      {positions.map(pos => (
        <PositionCard
          key={pos.symbol}
          pos={pos}
          isSelectMode={isSelectMode}
          isSelected={selectedSet.has(pos.symbol)}
          onToggle={() => toggleSelect(pos.symbol)}
        />
      ))}

      {/* 6. Sell Entire Portfolio */}
      {positions.length > 0 && (
        <div className="mx-4 mt-6">
          <button
            onClick={() => setShowSellSheet(positions)}
            className="w-full py-3 border border-red-500/20 text-red-400/70 rounded-2xl text-sm text-center"
          >
            Sell Entire Portfolio
          </button>
        </div>
      )}

      {/* 7. Nav spacer */}
      <div className="mb-32" />

      {/* 8. Sell Bar (multi-select) */}
      <SellBar
        selected={selectedArr}
        positions={positions}
        onDismiss={() => {
          setSelectedSet(new Set());
          setIsSelectMode(false);
        }}
        onSellSelected={() => {
          if (selectedPositions.length > 0) {
            setShowSellSheet(selectedPositions);
          }
        }}
      />

      {/* 9. Sell Bottom Sheet */}
      {showSellSheet && (
        <SellBottomSheet
          positions={showSellSheet}
          onClose={() => setShowSellSheet(null)}
        />
      )}

      <style jsx global>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.2s ease-out; }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom, 16px); }
      `}</style>
    </div>
  );
}
