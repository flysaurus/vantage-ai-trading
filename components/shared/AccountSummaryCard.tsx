'use client';

// ── Shared Account Summary Card ────────────────────────────────
// Used across Portfolio, Orders, and AI tabs

import type { AccountSummary } from '@/types';

export function AccountSummaryCard({ account }: { account: AccountSummary }) {
  const fmt = (n: number) => `$${Math.abs(n).toLocaleString()}`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  return (
    <div className="card">
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 4 }}>
        Account Value
      </div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>
        ${account.equity.toLocaleString()}
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
