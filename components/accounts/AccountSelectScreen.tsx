// ─── Account Select Screen ──────────────────────────────────
// Full-screen card-based account selector shown after auth.
// Reuses /api/accounts for data + /api/connections/snaptrade-brokerages for logos.
//
// Flow:
//   - Shows on first login (unless "don't show again" was checked)
//   - Always reachable from Settings
//   - "Add a broker" card → existing SnapTrade connection flow

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccounts } from '@/context/AccountContext';
import type { AccountEntry } from '@/app/api/accounts/route';
import { PlusCircle, Check, X } from 'lucide-react';

const SKIP_KEY = 'vantage:skipAccountSelect';

// ─── Broker logo cache ───────────────────────────────────────

interface BrokerLogo {
  slug: string;
  logoUrl: string;
  displayName: string;
}

function useBrokerLogos() {
  const [logos, setLogos] = useState<Map<string, BrokerLogo>>(new Map());
  useEffect(() => {
    fetch('/api/connections/snaptrade-brokerages', { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(data => {
        const map = new Map<string, BrokerLogo>();
        for (const b of [...(data.trading || []), ...(data.readOnly || [])]) {
          map.set(b.slug, { slug: b.slug, logoUrl: b.logoUrl, displayName: b.displayName });
        }
        setLogos(map);
      })
      .catch(() => { /* logos will be empty — fallback to initials */ });
  }, []);
  return logos;
}

// ─── Props ────────────────────────────────────────────────────

interface AccountSelectScreenProps {
  /** Called when user selects an account. */
  onSelect: (accountId: string) => void;
  /** Called when user wants to add a broker. */
  onAddBroker: () => void;
  /** Called when user dismisses the screen (either by selecting or skipping). */
  onDismiss: () => void;
}

// ─── Main component ──────────────────────────────────────────

export default function AccountSelectScreen({
  onSelect,
  onAddBroker,
  onDismiss,
}: AccountSelectScreenProps) {
  const { accounts, isLoading } = useAccounts();
  const brokerLogos = useBrokerLogos();
  const [dontShow, setDontShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [visible, setVisible] = useState(false);

  // Fade-in on mount
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleSelect = (accountId: string) => {
    if (dontShow) localStorage.setItem(SKIP_KEY, 'true');
    onSelect(accountId);
  };

  const handleDismiss = () => {
    if (dontShow) {
      setShowConfirm(true);
    } else {
      onDismiss();
    }
  };

  const handleConfirmDismiss = () => {
    localStorage.setItem(SKIP_KEY, 'true');
    onDismiss();
  };

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#06060b] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
          <p className="text-sm text-white/30">Loading accounts…</p>
        </div>
      </div>
    );
  }

  // Sort: Demo first, then live/paper brokers
  const sorted: AccountEntry[] = useMemo(() => {
    const demo = accounts.filter(a => a.isDemo);
    const live = accounts.filter(a => !a.isDemo && a.environment !== 'paper');
    const paper = accounts.filter(a => !a.isDemo && a.environment === 'paper');
    return [...demo, ...live, ...paper];
  }, [accounts]);

  // ── Dismiss confirmation dialog ──
  if (showConfirm) {
    return (
      <DismissConfirmDialog
        visible={visible}
        onConfirm={handleConfirmDismiss}
        onCancel={() => setShowConfirm(false)}
      />
    );
  }

  return (
    <div
      className={`fixed inset-0 z-[100] bg-[#06060b] overflow-y-auto transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="min-h-full flex flex-col max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 border border-white/10 mb-5">
            <span className="text-2xl">🦊</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
            Welcome to Vantage
          </h1>
          <p className="text-sm text-white/40 max-w-md mx-auto">
            Choose which account you&apos;d like to view. You can switch or add brokers
            anytime from Settings.
          </p>
        </div>

        {/* Account cards */}
        <div className="space-y-3 flex-1">
          {sorted.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              logo={brokerLogos.get(account.brokerageSlug || '')}
              onSelect={() => handleSelect(account.id)}
            />
          ))}

          {/* Add broker card */}
          <button
            onClick={onAddBroker}
            className="w-full rounded-2xl border border-dashed border-white/15
                       bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25
                       p-5 flex items-center gap-4 transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20
                            flex items-center justify-center shrink-0
                            group-hover:bg-emerald-500/15 group-hover:border-emerald-500/30
                            transition-all">
              <PlusCircle className="h-6 w-6 text-emerald-400" strokeWidth={1.5} />
            </div>
            <div className="text-left">
              <p className="font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">
                Add a broker
              </p>
              <p className="text-xs text-white/30 mt-0.5">
                Connect Alpaca, Tastytrade, E*TRADE, or others
              </p>
            </div>
          </button>
        </div>

        {/* Footer: "Don't show again" + dismiss */}
        <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
          <label className="flex items-center gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/5 accent-emerald-500 cursor-pointer"
            />
            <span className="text-sm text-white/40 group-hover:text-white/60 transition-colors">
              Don&apos;t show this again
            </span>
          </label>

          <button
            onClick={handleDismiss}
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Account Card ────────────────────────────────────────────

function AccountCard({
  account,
  logo,
  onSelect,
}: {
  account: AccountEntry;
  logo: BrokerLogo | undefined;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full rounded-2xl border border-white/10 bg-white/[0.03]
                 hover:bg-white/[0.07] hover:border-white/20
                 p-5 flex items-center gap-4 text-left transition-all
                 active:scale-[0.985] group"
    >
      {/* Logo / icon */}
      {account.isDemo ? (
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20
                        flex items-center justify-center shrink-0">
          <span className="text-xl">🎮</span>
        </div>
      ) : logo?.logoUrl ? (
        <div className="w-12 h-12 rounded-xl bg-white p-2 shrink-0 flex items-center justify-center">
          <img
            src={logo.logoUrl}
            alt={account.broker}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      ) : (
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center
                        text-lg font-bold shrink-0 text-white/50
                        group-hover:bg-white/15 group-hover:text-white/70 transition-all">
          {account.broker.charAt(0)}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white truncate">{account.name}</span>
          {account.isDemo && (
            <span className="text-[10px] px-1.5 py-px rounded-md bg-amber-500/15 border border-amber-500/20 text-amber-400 shrink-0 uppercase tracking-wide font-semibold">
              Demo
            </span>
          )}
          {!account.isDemo && account.environment === 'paper' && (
            <span className="text-[10px] px-1.5 py-px rounded-md bg-amber-500/15 border border-amber-500/20 text-amber-400 shrink-0 uppercase tracking-wide font-semibold">
              Paper
            </span>
          )}
          {!account.tradingEnabled && !account.isDemo && (
            <span className="text-[10px] px-1.5 py-px rounded-md bg-slate-500/15 border border-slate-500/20 text-slate-400 shrink-0 uppercase tracking-wide font-semibold">
              Read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-sm text-white/60 font-mono">
            {formatCurrency(account.totalValue)}
          </span>
          <span className="text-[11px] text-white/20">·</span>
          <span className="text-[11px] text-white/25">{account.broker}</span>
          {account.tradingEnabled && !account.isDemo && (
            <>
              <span className="text-[11px] text-white/20">·</span>
              <span className="text-[11px] text-emerald-400/70">Trading</span>
            </>
          )}
        </div>
      </div>

      {/* Select arrow */}
      <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center
                      shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

// ─── Dismiss confirmation ────────────────────────────────────

function DismissConfirmDialog({
  visible,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [fade, setFade] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setFade(true)); }, []);

  return (
    <div className={`fixed inset-0 z-[110] bg-[#06060b]/80 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${fade ? 'opacity-100' : 'opacity-0'}`}>
      <div className="bg-[#0e0e16] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Check className="h-5 w-5 text-emerald-400" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">Got it!</h3>
            <p className="text-sm text-white/50 mt-1">
              You can always switch or add brokers from <strong className="text-white/70">Settings</strong>.
              This screen won&apos;t appear on future logins.
            </p>
          </div>
        </div>
        <button
          onClick={onConfirm}
          className="w-full py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm font-medium text-white hover:bg-white/15 transition-all active:scale-[0.98]"
        >
          Enter Vantage
        </button>
        <button
          onClick={onCancel}
          className="w-full py-2.5 rounded-xl mt-2 text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          Never mind, show every time
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
