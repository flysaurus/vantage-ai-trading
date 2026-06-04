'use client';
import { useEffect, useMemo } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useMarketStore } from '@/store';
import { useAuth } from '@/components/providers/AuthProvider';
import { useBroker } from '@/components/providers/BrokerProvider';
import { getDemoInsight } from '@/lib/demo-data';
import { INVESTOR_STYLES } from '@/components/onboarding/styles';

import { QuickActions } from './QuickActions';
import { AIChat } from './AIChat';
import SuggestionTracker from '@/components/SuggestionTracker';
import { AccountSummaryCard } from '@/components/shared/AccountSummaryCard';
import { DemoBanner } from '@/components/shared/DemoBanner';

function generateInsight(account: import('@/types').AccountSummary | null): string | null {
  if (!account || account.positions.length === 0) return null;

  const positions = account.positions;
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);

  // Sector concentration
  const sectors: Record<string, number> = {};
  positions.forEach(p => {
    const s = p.sector || 'Other';
    sectors[s] = (sectors[s] || 0) + p.marketValue;
  });
  const topSector = Object.entries(sectors).sort((a, b) => b[1] - a[1])[0];
  const topSectorPct = topSector ? ((topSector[1] / totalValue) * 100).toFixed(0) : '0';

  // Biggest mover today
  const sortedByDay = [...positions].sort((a, b) => Math.abs(b.dayChangePercent) - Math.abs(a.dayChangePercent));
  const biggestMover = sortedByDay[0];

  // Biggest position
  const biggestPos = [...positions].sort((a, b) => b.marketValue - a.marketValue)[0];
  const biggestPct = ((biggestPos.marketValue / totalValue) * 100).toFixed(0);

  // Day P&L
  const dayPnlStr = account.dayPnl >= 0 ? `+$${account.dayPnl.toFixed(0)}` : `-$${Math.abs(account.dayPnl).toFixed(0)}`;

  // Build insight
  const parts: string[] = [];

  if (topSector && Number(topSectorPct) > 30) {
    parts.push(`${topSector[0]} is ${topSectorPct}% of your portfolio — consider diversifying.`);
  }

  if (biggestPos && Number(biggestPct) > 20) {
    parts.push(`${biggestPos.symbol} alone is ${biggestPct}% of holdings.`);
  }

  if (biggestMover && Math.abs(biggestMover.dayChangePercent) > 2) {
    const dir = biggestMover.dayChangePercent >= 0 ? 'up' : 'down';
    parts.push(`${biggestMover.symbol} is ${dir} ${Math.abs(biggestMover.dayChangePercent).toFixed(1)}% today.`);
  }

  if (account.dayPnl !== 0) {
    const pnlDir = account.dayPnl >= 0 ? 'up' : 'down';
    parts.push(`Portfolio ${pnlDir} ${dayPnlStr} (${account.dayPnlPercent >= 0 ? '+' : ''}${account.dayPnlPercent.toFixed(1)}%).`);
  }

  return parts.length > 0 ? parts.join(' ') : `${positions.length} positions across ${Object.keys(sectors).length} sectors. Portfolio value: $${totalValue.toFixed(0)}.`;
}

export function AITab() {
  const { account } = usePortfolio();
  const { isMarketOpen } = useMarketStore();
  const { user } = useAuth();
  const { isConnected } = useBroker();

  const insight = useMemo(() => {
    if (account && !isConnected) {
      return getDemoInsight(account);
    }
    return generateInsight(account);
  }, [account, isConnected]);

  // Resolve investor style from auth (fallback to localStorage if sessionStorage missing)
  const investorStyle: string = (() => {
    if (user?.investorStyle) return user.investorStyle;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('vantage:investorStyle') || 'buffett';
    }
    return 'buffett';
  })();
  const styleDef = INVESTOR_STYLES.find(s => s.id === investorStyle);

  // Lazy tracking: trigger background refresh of suggestion outcomes
  useEffect(() => {
    fetch('/api/ai/suggestions/track', { method: 'POST' }).catch(() => {});
  }, []);

  return (
    <>
      {!isConnected && <div style={{ padding: '0 16px' }}><DemoBanner /></div>}
      {/* Investor Style Badge */}
      {styleDef && (
        <div style={{ padding: '0 16px', marginBottom: 4 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)',
            borderRadius: 20, padding: '4px 12px', fontSize: 11,
          }}>
            <span style={{ fontSize: 14 }}>{styleDef.emoji}</span>
            <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{styleDef.title}</span>
            <span style={{ color: '#64748b' }}>·</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              {styleDef.timeHorizon}
            </span>
          </div>
          <span style={{ fontSize: 9, color: '#475569', marginLeft: 8 }}>
            Change in{' '}
            <span
              onClick={() => {
                // Switch to Settings tab (via store)
                const { useTabStore } = require('@/store');
                useTabStore.getState().setTab('settings');
              }}
              style={{ color: '#06b6d4', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Settings
            </span>
          </span>
        </div>
      )}
      <div style={{ padding: '12px 16px 0' }}>
        {/* Account Summary */}
        {account && (
          <div style={{ marginBottom: 12 }}>
            <AccountSummaryCard account={account} />
          </div>
        )}

        {/* Key Insight */}
        <div className="key-insight">
          <div className="insight-title">🎯 Today&apos;s Key Insight</div>
          <div className="insight-text">
            {insight || 'Connect your portfolio to see insights.'}
          </div>
        </div>
      </div>
      <QuickActions />
      <SuggestionTracker />
      <div className="disclaimer">
        <strong>⚠️ Disclaimer:</strong> AI suggestions are not financial advice. Always do your own research.
      </div>
      <AIChat />

      <style jsx>{`
        .key-insight {
          background: rgba(15,23,42,0.8);
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 12px;
        }
        .insight-title {
          font-size: 10px;
          color: #06b6d4;
          font-weight: 700;
          margin-bottom: 4px;
          text-transform: uppercase;
        }
        .insight-text {
          font-size: 12px;
          color: #cbd5e1;
          line-height: 1.4;
        }
        .disclaimer {
          background: rgba(251,191,36,0.1);
          border: 1px solid rgba(251,191,36,0.3);
          border-radius: 8px;
          padding: 9px;
          font-size: 10px;
          color: #cbd5e1;
          margin: 12px 16px;
          line-height: 1.4;
        }
        .disclaimer strong { color: #fbbf24; }
      `}</style>
    </>
  );
}
