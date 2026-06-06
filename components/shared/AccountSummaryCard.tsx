'use client';

// ── Shared Account Summary Card ────────────────────────────────
// Used across Portfolio, Orders, and AI tabs

import { useRouter } from 'next/navigation';
import type { AccountSummary } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { INVESTOR_STYLES } from '@/components/onboarding/styles';

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

export function AccountSummaryCard({ account }: { account: AccountSummary }) {
  const router = useRouter();
  const fmt = (n: number) => `$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  // Resolve investor style
  const { user } = useAuth();
  const investorStyle: string = (() => {
    if (user?.investorStyle) return user.investorStyle;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('vantage:investorStyle') || 'buffett';
    }
    return 'buffett';
  })();
  const styleDef = INVESTOR_STYLES.find(s => s.id === investorStyle);

  return (
    <div className="card">
      <div>
        <p className="text-slate-500 text-xs tracking-widest uppercase font-medium mb-1">Account Value</p>
        <div className="flex items-center justify-between">
          <p className="text-white font-bold text-4xl tracking-tight">${account.equity.toLocaleString('en-US', DOLLAR_FMT)}</p>
          {styleDef && (
            <span className="text-xs text-slate-400 flex items-center gap-1.5 self-end mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
              <span>{styleDef.title}</span>
              <button
                onClick={() => router.push('/investor-style')}
                className="text-cyan-400 text-xs hover:text-cyan-300 transition ml-1"
              >
                Change →
              </button>
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 10, borderTop: '1px solid #334155' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
            Today P&amp;L
          </div>
          <div className={account.dayPnl >= 0 ? 'up' : 'down'} style={{ fontSize: 13, fontWeight: 700 }}>
            {fmt(account.dayPnl)} ({pct(account.dayPnlPercent)})
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
            Total P&amp;L
          </div>
          <div className="up" style={{ fontSize: 13, fontWeight: 700 }}>
            {fmt(account.totalPnl)} ({pct(account.totalPnlPercent)})
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
            Buying Power
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            ${account.buyingPower.toLocaleString('en-US', DOLLAR_FMT)}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
            Cash
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
          </div>
        </div>
      </div>
      <style jsx>{`
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 12px; }
      `}</style>
    </div>
  );
}
