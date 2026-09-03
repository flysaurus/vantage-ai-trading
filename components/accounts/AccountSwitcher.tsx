// ─── Account Switcher ────────────────────────────────────────
// Persistent account selector — always visible near Portfolio/AI tabs.
// Shows Demo + all connected brokers, with trading/read-only indicators.

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAccounts } from '@/context/AccountContext';
import type { AccountEntry } from '@/app/api/accounts/route';

export function AccountSwitcher() {
  const { accounts, activeAccountId, activeAccount, setActiveAccount, isLoading } = useAccounts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (isLoading || accounts.length === 0) return null;

  const showReadOnlyBadge = activeAccount && !activeAccount.isDemo && !activeAccount.tradingEnabled;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium
                   bg-white/5 border border-white/10 hover:bg-white/10
                   text-white/90 transition-all duration-200"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {/* Account indicator dot */}
        <span className={`
          w-2 h-2 rounded-full flex-shrink-0
          ${activeAccount?.isDemo ? 'bg-amber-400' : 'bg-emerald-400'}
        `} />

        <span className="max-w-[140px] truncate">
          {activeAccount?.name || 'Demo Portfolio'}
        </span>

        {/* Read-only badge */}
        {showReadOnlyBadge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold tracking-wide">
            VIEW ONLY
          </span>
        )}

        {/* Chevron */}
        <svg
          className={`w-3.5 h-3.5 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-2 left-0 w-[260px] rounded-xl
                        bg-[#0a0a0f]/95 backdrop-blur-xl border border-white/10
                        shadow-2xl shadow-black/50 z-50 overflow-hidden"
             role="listbox"
        >
          <div className="px-3 pt-3 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2">
              Active Account
            </p>
          </div>

          {accounts.map((account) => (
            <AccountOption
              key={account.id}
              account={account}
              isActive={account.id === activeAccountId}
              onSelect={() => {
                setActiveAccount(account.id);
                setOpen(false);
              }}
            />
          ))}

          {/* Footer */}
          <div className="px-3 py-2 border-t border-white/5">
            <p className="text-[10px] text-white/25 leading-relaxed">
              Changes which account Portfolio data is shown for.
              All trades execute against your Demo account.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountOption({
  account,
  isActive,
  onSelect,
}: {
  account: AccountEntry;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      role="option"
      aria-selected={isActive}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
        ${isActive
          ? 'bg-white/10 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white/80'}
      `}
    >
      {/* Icon */}
      <div className={`
        w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0
        ${account.isDemo
          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          : account.tradingEnabled
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}
      `}>
        {account.isDemo ? '🎮' : account.tradingEnabled ? '📈' : '👁️'}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{account.name}</span>
          {isActive && (
            <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-white/30">{account.broker}</span>
          <span className="text-[11px] text-white/20">·</span>
          <span className="text-[11px] text-white/30">
            {formatCurrency(account.totalValue)}
          </span>
          {!account.tradingEnabled && !account.isDemo && (
            <>
              <span className="text-[11px] text-white/20">·</span>
              <span className="text-[10px] text-amber-400/70">Read-only</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}
