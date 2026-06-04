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
      {/* Investor Style Chip */}
      {styleDef && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          marginTop: 8, padding: '4px 10px',
          background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)',
          borderRadius: 20,
        }}>
          <span style={{ fontSize: 12 }}>{styleDef.emoji}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#67e8f9' }}>{styleDef.title}</span>
          <span style={{ color: '#475569', fontSize: 10 }}>· {styleDef.timeHorizon}</span>
          <span
            onClick={() => setTab('settings')}
            style={{ fontSize: 9, color: '#475569', cursor: 'pointer', marginLeft: 2 }}
          >
            Change in Settings
          </span>
        </div>
      )}
      <style jsx>{`
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 12px; }
      `}</style>
    </div>
  );
}
