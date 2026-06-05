'use client';

// ── Shared Account Summary Card ────────────────────────────────
// Used across Portfolio, Orders, and AI tabs

import type { AccountSummary } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { INVESTOR_STYLES } from '@/components/onboarding/styles';

export function AccountSummaryCard({ account }: { account: AccountSummary }) {
  const fmt = (n: number) => `$${Math.abs(n).toLocaleString()}`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  // Resolve investor style
  const { user } = useAuth();
  // Resolve investor style
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="flex items-center justify-between mb-1" style={{ gap: 12 }}>
            <p className="text-slate-400 text-xs tracking-wider uppercase" style={{ margin: 0 }}>Account Value</p>
            {styleDef && (
              <div className="flex items-center gap-1.5 bg-slate-700/50 rounded-full px-2.5 py-1">
                <span className="text-xs">{styleDef.emoji}</span>
                <span className="text-cyan-400 text-xs font-medium">{styleDef.title}</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            ${account.equity.toLocaleString()}
          </div>
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
            ${account.buyingPower.toLocaleString()}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
            Cash
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            ${account.cash.toLocaleString()}
          </div>
        </div>
      </div>
      <style jsx>{`
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 12px; }
      `}</style>
    </div>
  );
}
