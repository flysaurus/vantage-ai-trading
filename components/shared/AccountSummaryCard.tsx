'use client';

// ── Shared Account Summary Card ────────────────────────────────
// Used across Portfolio, Orders, and AI tabs

import type { AccountSummary } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { INVESTOR_STYLES } from '@/components/onboarding/styles';
import { useTabStore } from '@/store';

export function AccountSummaryCard({ account }: { account: AccountSummary }) {
  const fmt = (n: number) => `$${Math.abs(n).toLocaleString()}`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  // Resolve investor style
  const { user } = useAuth();
  const setTab = useTabStore(s => s.setTab);
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
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 4 }}>
            Account Value
          </div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            ${account.equity.toLocaleString()}
          </div>
        </div>
        {/* Investor Style Badge */}
        {styleDef && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 10px',
            background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)',
            borderRadius: 16,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{styleDef.emoji}</span>
            <div>
              <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 11, lineHeight: 1.3 }}>{styleDef.title}</div>
              <div style={{ color: '#64748b', fontSize: 9, lineHeight: 1.3 }}>{styleDef.timeHorizon}</div>
            </div>
            <span
              onClick={() => setTab('settings')}
              style={{ fontSize: 8, color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Change in Settings
            </span>
          </div>
        )}
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
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 12px; }
      `}</style>
    </div>
  );
}
