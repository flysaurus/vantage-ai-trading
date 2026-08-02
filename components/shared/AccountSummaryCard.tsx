'use client';

// ── Shared Account Summary Card ────────────────────────────────
// Used across Portfolio, Orders, and AI tabs.
// Renders conditionally based on field presence, never broker name:
//   - buyingPower null → hide field (non-margin accounts)
//   - lastSynced → "as of" label (broker only)
//   - accountStatus closed/archived → status badge

import { useRouter } from 'next/navigation';
import type { AccountSummary } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { INVESTOR_STYLES } from '@/components/onboarding/styles';

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

export function AccountSummaryCard({ account, isShowingDemo }: { account: AccountSummary; isShowingDemo?: boolean }) {
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
        <p className="text-slate-300 text-xs tracking-widest uppercase font-medium mb-1">Account Value</p>
        <div className="flex items-center justify-between">
          <p className="text-white font-bold text-4xl tracking-tight">${account.equity.toLocaleString('en-US', DOLLAR_FMT)}</p>
          {styleDef && (
            <span className="text-xs text-slate-300 flex items-center gap-1.5 self-end mb-1">
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

        {/* Account status badge — only for closed/archived, silent for open */}
        {!isShowingDemo && account.accountStatus && account.accountStatus !== 'open' && (
          <div style={{
            display: 'inline-block', marginTop: 4, padding: '2px 8px',
            borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            background: account.accountStatus === 'closed' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
            color: account.accountStatus === 'closed' ? '#ef4444' : '#fbbf24',
          }}>
            {account.accountStatus}
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
        {/* Buying Power — HIDE entirely when null (non-margin account), never render "$0.00" */}
        {account.buyingPower !== null && account.buyingPower !== undefined && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
              Buying Power
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              ${account.buyingPower.toLocaleString('en-US', DOLLAR_FMT)}
            </div>
          </div>
        )}
        <div style={{ flex: account.buyingPower != null ? 1 : undefined }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
            Cash
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            ${account.cash.toLocaleString('en-US', DOLLAR_FMT)}
          </div>
        </div>
      </div>

      {/* "as of" label — broker accounts only, never Demo */}
      {!isShowingDemo && account.lastSynced && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#64748b' }}>
          as of {new Date(account.lastSynced).toLocaleString()}
        </div>
      )}

      <style jsx>{`
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 12px; }
      `}</style>
    </div>
  );
}
