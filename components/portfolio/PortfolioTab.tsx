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
    <div className="mt-4 mb-3 bg-[#1a2235] rounded-lg border border-[#2a3448] px-3 py-5" style={{ margin: '16px 16px 0 16px' }}>
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
      <div className="border-t border-[#2a3448] my-3" />

      {/* Sparkline placeholder */}
      <div className="h-20 bg-[#1e2d45] rounded-lg my-3 flex items-center justify-center">
        <span className="text-slate-600 text-xs">
          Chart coming soon
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-[#2a3448] my-3" />

      {/* 2-col stats */}
      <div className="grid grid-cols-2 gap-y-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Today P&amp;L</p>
          <p className={`text-base font-semibold ${gain(account.dayPnl)}`}>
            {fmt(account.dayPnl)} ({pctStr(account.dayPnlPercent)})
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total P&amp;L</p>
          <p className={`text-base font-semibold ${gain(account.totalPnl)}`}>
            {fmt(account.totalPnl)} ({pctStr(account.totalPnlPercent)})
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Buying Power</p>
          <p className="text-base font-semibold text-white">
            ${account.buyingPower.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Cash</p>
          <p className="text-base font-semibold text-white">
            ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Position Card (checkbox + expandable card) ───────────

function PositionCard({
  pos,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onBuy,
}: {
  pos: Position;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onBuy?: () => void;
}) {
  const borderLColor =
    pos.dayChange > 0 ? '#10b981' : pos.dayChange < 0 ? '#ef4444' : '#475569';

  // 52-week range ball position
  const weekPos =
    pos.weekHigh52 != null &&
    pos.weekLow52 != null &&
    pos.weekHigh52 !== pos.weekLow52
      ? Math.min(
          98,
          Math.max(
            2,
            ((pos.currentPrice - pos.weekLow52) /
              (pos.weekHigh52 - pos.weekLow52)) *
              100,
          ),
        )
      : 50;

  return (
    <div className="mb-3" style={{ marginLeft: '16px', marginRight: '16px' }}>
      <div
        className="bg-[#1a2235] border border-[#2a3448] rounded-lg overflow-hidden"
        style={{ borderLeft: `3px solid ${borderLColor}` }}
      >
        {/* Collapsed section */}
        <div
          className="flex items-center pl-4 pr-4 py-3"
          onClick={onToggleExpand}
        >
          {/* LEFT — checkbox */}
          <div
            className="w-8 flex-shrink-0 flex items-center"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          >
            <div
              className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center transition-all duration-150 ${
                isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-slate-600 bg-transparent'
              }`}
            >
              {isSelected && (
                <span className="text-white text-xs leading-none">&#10003;</span>
              )}
            </div>
          </div>

          {/* MIDDLE — symbol + shares */}
          <div className="flex-1 ml-2 min-w-0">
            <p className="text-base font-bold text-white">{pos.symbol}</p>
            <p className="text-xs text-slate-400 mt-0.5">{pos.qty} shares</p>
          </div>

          {/* RIGHT — price + P&amp;L */}
          <div className="text-right flex-shrink-0">
            <p className="text-base font-semibold text-white">
              ${pos.currentPrice.toFixed(2)}
            </p>
            <p className={`text-xs mt-0.5 ${gain(pos.totalPnl)}`}>
              {fmt(pos.totalPnl)} ({pctStr(pos.totalPnlPercent)})
            </p>
          </div>
        </div>

        {/* Expanded section */}
        {isExpanded && (
          <div style={{ paddingLeft: '16px', paddingRight: '16px', paddingBottom: '16px' }}>
            <div className="border-t border-[#2a3448] mb-4" />

            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
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
                  Current Px
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
            </div>

            {/* 52-Week Range */}
            {pos.weekHigh52 != null && pos.weekLow52 != null && (
              <div className="mt-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                  52-Week Range
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">
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
                  <span className="text-xs text-slate-400">
                    ${pos.weekHigh52.toFixed(0)}
                  </span>
                </div>
              </div>
            )}

            {/* Buy More / Sell buttons */}
            <div className="flex gap-3" style={{ margin: '16px 16px 0 16px' }}>
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
  onClose,
}: {
  position: Position;
  onClose: () => void;
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
          Buying Power: $145,217.48
        </p>

        {/* Buttons */}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 border border-slate-700 text-slate-400 rounded-lg py-3 text-sm">
            Cancel
          </button>
          <button className="flex-1 bg-cyan-500 text-white rounded-lg py-3 text-sm font-semibold">
            Confirm Buy
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sell Modal ───────────────────────────────────────────

type StockSellConfig = {
  mode: 'all' | 'partial';
  shares: number;
  orderType: 'Market' | 'Limit' | 'Stop';
  tif: 'Day' | 'GTC';
  limitPrice: string;
};

function SellModal({
  positions,
  totalPositions,
  onClose,
}: {
  positions: Position[];
  totalPositions: number;
  onClose: () => void;
}) {
  const single = positions.length === 1 ? positions[0] : null;
  const multi = positions.length > 1;
  const isPortfolio = positions.length === totalPositions && positions.length > 1;

  // Single-stock state
  const [sellMode, setSellMode] = useState<'all' | 'partial'>('all');
  const [shares, setShares] = useState(single?.qty ?? 0);
  const [orderType, setOrderType] = useState<'Market' | 'Limit' | 'Stop'>('Market');
  const [tif, setTif] = useState<'Day' | 'GTC'>('Day');
  const [limitPrice, setLimitPrice] = useState('');
  const [confirmText, setConfirmText] = useState('');

  // Multi-stock per-stock configs
  const initConfigs = (): Record<string, StockSellConfig> => {
    const configs: Record<string, StockSellConfig> = {};
    for (const p of positions) {
      configs[p.symbol] = {
        mode: 'all',
        shares: p.qty,
        orderType: 'Market',
        tif: 'Day',
        limitPrice: '',
      };
    }
    return configs;
  };
  const [stockConfigs, setStockConfigs] = useState<Record<string, StockSellConfig>>(initConfigs);

  const updateStockConfig = (sym: string, patch: Partial<StockSellConfig>) => {
    setStockConfigs((prev) => ({ ...prev, [sym]: { ...prev[sym], ...patch } }));
  };

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const proceeds =
    single && sellMode === 'partial'
      ? shares * single.currentPrice
      : totalValue;

  // Multi proceeds from per-stock configs
  const multiProceeds = positions.reduce((s, p) => {
    const cfg = stockConfigs[p.symbol];
    if (!cfg) return s;
    return s + (cfg.mode === 'partial' ? cfg.shares * p.currentPrice : p.marketValue);
  }, 0);

  // ── Single position ──
  if (single && !isPortfolio) {
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
              Sell {single.symbol}
            </h3>
            <button onClick={onClose} className="text-slate-400 text-xl leading-none">
              &#10005;
            </button>
          </div>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            {single.qty} shares &middot; ${single.currentPrice.toFixed(2)}/share
          </p>

          {/* Quantity */}
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Quantity</p>
          <label className="flex items-center gap-3 bg-[#0f1829] rounded-lg p-3 border border-[#2a3448] mb-2 cursor-pointer">
            <input type="radio" checked={sellMode === 'all'} onChange={() => setSellMode('all')} className="accent-cyan-500" />
            <div className="flex-1">
              <p className="text-white text-sm font-semibold">All shares ({single.qty})</p>
              <p className="text-slate-400 text-xs">
                Est. ${(single.qty * single.currentPrice).toLocaleString('en-US', DOLLAR_FMT)}
              </p>
            </div>
          </label>
          <label className="flex items-center gap-3 bg-[#0f1829] rounded-lg p-3 border border-[#2a3448] cursor-pointer">
            <input type="radio" checked={sellMode === 'partial'} onChange={() => setSellMode('partial')} className="accent-cyan-500" />
            <div className="flex-1">
              <p className="text-white text-sm font-semibold">Partial</p>
              {sellMode === 'partial' && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number" min={1} max={single.qty} value={shares}
                    onChange={(e) => setShares(Math.min(single.qty, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-24 bg-[#0f1829] border border-[#2a3448] rounded-md px-3 py-2 text-white text-sm outline-none"
                  />
                  <span className="text-slate-400 text-xs">of {single.qty}</span>
                </div>
              )}
            </div>
          </label>

          {/* Order Type */}
          <p className="text-xs text-slate-500 uppercase tracking-wider mt-4 mb-1">Order Type</p>
          <div className="flex gap-2">
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
          <p className="text-xs text-slate-500 uppercase tracking-wider mt-3 mb-1">Time in Force</p>
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
                type="number" step="0.01" value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="$0.00"
                className="bg-[#0f1829] border border-[#2a3448] rounded-md p-2 w-full text-white outline-none placeholder-slate-600 text-sm"
              />
            </div>
          )}

          {/* Est. proceeds */}
          <p className="text-xs text-slate-500 mb-1">Est. proceeds</p>
          <p className="text-base font-semibold text-cyan-400">
            ${proceeds.toLocaleString('en-US', DOLLAR_FMT)}
          </p>

          {/* Buttons */}
          <div className="flex gap-3 mt-4">
            <button onClick={onClose} className="flex-1 border border-slate-700 text-slate-400 rounded-lg py-3 text-sm">
              Cancel
            </button>
            <button className="flex-1 bg-red-500 text-white rounded-lg py-3 text-sm font-semibold">
              Confirm Sell
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Multi or Portfolio ──
  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a2235] rounded-xl w-full max-w-sm border border-[#2a3448] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#1a2235] px-6 pt-6 pb-2 z-10">
          <div className="flex justify-between items-start">
            <h3 className={`text-lg font-bold ${isPortfolio ? 'text-red-400' : 'text-white'}`}>
              {isPortfolio ? 'Sell Entire Portfolio' : `Sell Selected (${positions.length})`}
            </h3>
            <button onClick={onClose} className="text-slate-400 text-xl leading-none">
              &#10005;
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="px-6">
          {isPortfolio ? (
            <>
              {/* Portfolio mode: simple list + confirm */}
              <p className="text-sm text-slate-400 mt-1">
                {positions.length} positions &middot; ~$
                {totalValue.toLocaleString('en-US', DOLLAR_FMT)}
              </p>
              <div className="space-y-1 mt-3 mb-2 max-h-[150px] overflow-y-auto">
                {positions.map((p) => (
                  <p key={p.symbol} className="text-sm text-slate-400">
                    {p.symbol} &middot; {p.qty}sh &middot; ~$
                    {p.marketValue.toLocaleString('en-US', DOLLAR_FMT)}
                  </p>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">All positions at market price</p>
              <p className="text-xs text-slate-500 uppercase tracking-wider mt-4 mb-1">
                Type SELL to confirm
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type SELL"
                className="bg-[#0f1829] border border-[#2a3448] rounded-md p-2 w-full text-white outline-none placeholder-slate-600 text-sm"
              />
            </>
          ) : (
            <>
              {/* Multi mode: per-stock controls */}
              {positions.map((p) => {
                const cfg = stockConfigs[p.symbol];
                if (!cfg) return null;
                return (
                  <div key={p.symbol} className="border-b border-[#2a3448] pb-4 mb-4 last:border-0">
                    <p className="text-sm font-bold text-white uppercase">{p.symbol}</p>
                    <p className="text-xs text-slate-400 mb-3">
                      {p.qty} shares &middot; ${p.currentPrice.toFixed(2)}/share
                    </p>

                    {/* Quantity */}
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Quantity</p>
                    <div className="flex items-center gap-3 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={cfg.mode === 'all'}
                          onChange={() => updateStockConfig(p.symbol, { mode: 'all' })}
                          className="accent-cyan-500"
                        />
                        <span className="text-sm text-white">
                          All ({p.qty}) ~$
                          {p.marketValue.toLocaleString('en-US', DOLLAR_FMT)}
                        </span>
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={cfg.mode === 'partial'}
                          onChange={() => updateStockConfig(p.symbol, { mode: 'partial' })}
                          className="accent-cyan-500"
                        />
                        <span className="text-sm text-white">Partial</span>
                      </label>
                      {cfg.mode === 'partial' && (
                        <input
                          type="number"
                          min={1}
                          max={p.qty}
                          value={cfg.shares}
                          onChange={(e) =>
                            updateStockConfig(p.symbol, {
                              mode: 'partial',
                              shares: Math.min(p.qty, Math.max(1, parseInt(e.target.value) || 1)),
                            })
                          }
                          className="w-16 text-center bg-[#0f1829] border border-[#2a3448] rounded-md px-2 py-1 text-white text-sm outline-none"
                        />
                      )}
                      {cfg.mode === 'partial' && (
                        <span className="text-xs text-slate-400">shares</span>
                      )}
                    </div>

                    {/* Order Type */}
                    <p className="text-xs text-slate-500 uppercase tracking-wider mt-3 mb-1">Order Type</p>
                    <div className="flex gap-2">
                      {(['Market', 'Limit', 'Stop'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => updateStockConfig(p.symbol, { orderType: t })}
                          className={
                            cfg.orderType === t
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 rounded-md px-3 py-1.5 text-xs font-medium'
                              : 'text-slate-400 border border-slate-700 rounded-md px-3 py-1.5 text-xs font-medium'
                          }
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    {/* Time in Force */}
                    <p className="text-xs text-slate-500 uppercase tracking-wider mt-2 mb-1">Time in Force</p>
                    <div className="flex gap-2">
                      {(['Day', 'GTC'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => updateStockConfig(p.symbol, { tif: t })}
                          className={
                            cfg.tif === t
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 rounded-md px-3 py-1.5 text-xs font-medium'
                              : 'text-slate-400 border border-slate-700 rounded-md px-3 py-1.5 text-xs font-medium'
                          }
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    {/* Limit Price */}
                    {cfg.orderType === 'Limit' && (
                      <div className="mt-2">
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Limit Price</p>
                        <input
                          type="number"
                          step="0.01"
                          value={cfg.limitPrice}
                          onChange={(e) => updateStockConfig(p.symbol, { limitPrice: e.target.value })}
                          placeholder="$0.00"
                          className="bg-[#0f1829] border border-[#2a3448] rounded-md p-2 w-full text-sm text-white outline-none placeholder-slate-600"
                        />
                      </div>
                    )}

                    {/* Est */}
                    <p className="text-sm text-cyan-400 mt-2">
                      Est: $
                      {(cfg.mode === 'partial'
                        ? cfg.shares * p.currentPrice
                        : p.marketValue
                      ).toLocaleString('en-US', DOLLAR_FMT)}
                    </p>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#1a2235] border-t border-[#2a3448] px-6 py-4 mt-2">
          <p className="text-base text-cyan-400 mb-3">
            Total est: ${(isPortfolio ? totalValue : multiProceeds).toLocaleString('en-US', DOLLAR_FMT)}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 border border-slate-700 text-slate-400 rounded-lg py-3 text-sm">
              Cancel
            </button>
            <button
              disabled={isPortfolio ? confirmText !== 'SELL' : false}
              className={`flex-1 rounded-lg py-3 text-sm font-semibold ${
                isPortfolio && confirmText !== 'SELL'
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-red-500 text-white'
              }`}
            >
              {isPortfolio ? 'Confirm Sell' : 'Confirm Sell All'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sell Bar ─────────────────────────────────────────────

function SellBar({
  selected,
  positions,
  onDismiss,
  onSell,
}: {
  selected: string[];
  positions: Position[];
  onDismiss: () => void;
  onSell: () => void;
}) {
  if (selected.length === 0) return null;

  const sel = positions.filter((p) => selected.includes(p.symbol));
  const totalVal = sel.reduce((s, p) => s + p.marketValue, 0);
  const isAll = selected.length === positions.length && positions.length > 1;

  let label = `Sell Selected (${selected.length})`;
  if (isAll && positions.length > 1) label = 'Sell Portfolio';
  else if (selected.length === 1 && sel[0]) label = `Sell ${sel[0].symbol}`;

  return (
    <div className="fixed bottom-[64px] left-0 right-0 z-40 bg-[#1a2235] border-t border-[#2a3448] px-4 py-3 flex justify-between items-center animate-slide-up">
      <div>
        <p className="text-sm font-semibold text-white">{selected.length} selected</p>
        <p className="text-xs text-slate-400">
          ~${Math.round(totalVal).toLocaleString('en-US', DOLLAR_FMT)}
        </p>
      </div>
      <div className="flex items-center">
        <button onClick={onDismiss} className="text-sm text-slate-400 mr-4">
          Cancel
        </button>
        <button
          onClick={onSell}
          className="bg-red-500 text-white rounded-lg px-5 py-2.5 text-sm font-semibold"
        >
          {label}
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
  const positions: Position[] = demo.positions.map((dp) => {
    const q = quotes?.[dp.symbol];
    const currentPrice = q?.price ?? dp.avgCost;
    const marketValue = currentPrice * dp.qty;
    const dayChange = q?.change ? q.change * dp.qty : 0;
    const dayChangePercent = q?.changePercent ?? 0;
    const totalPnl = (currentPrice - dp.avgCost) * dp.qty;
    const totalPnlPercent =
      dp.avgCost > 0 ? (currentPrice / dp.avgCost - 1) * 100 : 0;

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
      weekHigh52: dp.weekHigh52,
      weekLow52: dp.weekLow52,
    };
  });

  const totalEquity = positions.reduce((s, p) => s + p.marketValue, 0);
  positions.forEach((p) => {
    p.portfolioPercent =
      totalEquity > 0 ? (p.marketValue / totalEquity) * 100 : 0;
  });

  const cash = 11617.4;
  const buyingPower = 145217.48;
  const dayPnl = positions.reduce((s, p) => s + p.dayChange, 0);
  const dayPnlPercent =
    totalEquity > 0 ? (dayPnl / (totalEquity - dayPnl)) * 100 : 0;
  const totalPnl = positions.reduce((s, p) => s + p.totalPnl, 0);
  const totalPnlPercent =
    totalEquity > 0 ? (totalPnl / (totalEquity - totalPnl)) * 100 : 0;

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

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [showSellModal, setShowSellModal] = useState<Position[] | null>(null);
  const [showBuySymbol, setShowBuySymbol] = useState<Position | null>(null);

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
      body: JSON.stringify({ symbols: demo.positions.map((p) => p.symbol) }),
    })
      .then((r) => r.json())
      .then((data) => {
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

  // Positions to sell
  const sellPositions =
    showSellModal ?? positions.filter((p) => selectedSymbols.includes(p.symbol));

  return (
    <div className="min-h-screen bg-[#060a14] pb-40">
      {/* 1. Demo banner */}
      {!isConnected && <DemoBanner />}

      {/* 2. Account Card */}
      <AccountCard account={displayAccount} />

      {/* 3. Column header */}
      {positions.length > 0 && (
        <div className="flex items-center mb-2" style={{ paddingLeft: '16px', paddingRight: '16px' }}>
          <div className="w-8 flex-shrink-0 flex items-center gap-1.5">
            <button onClick={toggleSelectAll} aria-label="Select all">
              <div
                className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center transition-all duration-150 ${
                  allSelected
                    ? 'bg-cyan-500 border-cyan-500'
                    : someSelected
                      ? 'bg-cyan-500/40 border-cyan-500'
                      : 'border-slate-600 bg-transparent'
                }`}
              >
                {(allSelected || someSelected) && (
                  <span className="text-white text-xs leading-none">
                    {allSelected ? '\u2713' : '\u2013'}
                  </span>
                )}
              </div>
            </button>
          </div>
          <span className="text-xs text-slate-500 uppercase tracking-wider ml-2 flex-1">
            Holdings
          </span>
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            Price / P&amp;L
          </span>
        </div>
      )}

      {/* 4. Position Cards */}
      {positions.map((pos) => (
        <PositionCard
          key={pos.symbol}
          pos={pos}
          isSelected={selectedSymbols.includes(pos.symbol)}
          isExpanded={expandedSymbol === pos.symbol}
          onToggleSelect={() => toggleSelect(pos.symbol)}
          onToggleExpand={() => toggleExpand(pos.symbol)}
          onBuy={() => setShowBuySymbol(pos)}
        />
      ))}
      <div className="h-8" />

      {/* 5. Sell Entire Portfolio button */}
      {positions.length > 0 && (
        <div className="mt-6 mb-32">
          <button
            onClick={() => setShowSellModal(positions)}
            className="w-full py-3 border border-red-500/20 text-red-400/70 rounded-lg text-sm text-center"
          >
            Sell Entire Portfolio
          </button>
        </div>
      )}

      {/* 6. Sell Bar (bottom, always shows when selections exist) */}
      <SellBar
        selected={selectedSymbols}
        positions={positions}
        onDismiss={() => setSelectedSymbols([])}
        onSell={() => {
          const sel = positions.filter((p) => selectedSymbols.includes(p.symbol));
          if (sel.length > 0) setShowSellModal(sel);
        }}
      />

      {/* 7. Sell Modal */}
      {showSellModal && (
        <SellModal
          positions={showSellModal}
          totalPositions={positions.length}
          onClose={() => {
            setShowSellModal(null);
            setSelectedSymbols([]);
          }}
        />
      )}

      {/* 8. Buy Modal */}
      {showBuySymbol && (
        <BuyModal
          position={showBuySymbol}
          onClose={() => setShowBuySymbol(null)}
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
