'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { getDemoInsight } from '@/lib/demo-data';
import { AIChat } from './AIChat';
import { AccountSummaryCard } from '@/components/shared/AccountSummaryCard';
import DailyBriefCard from '@/components/ai/DailyBriefCard';
import WeeklySnapshotCard from '@/components/ai/WeeklySnapshotCard';
import BuildBasketModal from '@/components/BuildBasketModal';
import DemoBanner from '@/components/shared/DemoBanner';

function generateInsight(account: import('@/types').AccountSummary | null): string | null {
  if (!account || account.positions.length === 0) return null;

  const positions = account.positions;
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);

  // Sector concentration
  const sectors: Record<string, number> = {};
  positions.forEach((p) => {
    const s = p.sector || 'Other';
    sectors[s] = (sectors[s] || 0) + p.marketValue;
  });
  const topSector = Object.entries(sectors).sort((a, b) => b[1] - a[1])[0];
  const topSectorPct = topSector ? ((topSector[1] / totalValue) * 100).toFixed(0) : '0';

  // Biggest mover today
  const sortedByDay = [...positions].sort(
    (a, b) => Math.abs(b.dayChangePercent) - Math.abs(a.dayChangePercent)
  );
  const biggestMover = sortedByDay[0];

  // Biggest position
  const biggestPos = [...positions].sort((a, b) => b.marketValue - a.marketValue)[0];
  const biggestPct = ((biggestPos.marketValue / totalValue) * 100).toFixed(0);

  // Day P&L
  const dayPnlStr =
    account.dayPnl >= 0
      ? `+$${account.dayPnl.toFixed(0)}`
      : `-$${Math.abs(account.dayPnl).toFixed(0)}`;

  // Build insight
  const parts: string[] = [];

  if (topSector && Number(topSectorPct) > 30) {
    parts.push(
      `${topSector[0]} is ${topSectorPct}% of your portfolio — consider diversifying.`
    );
  }

  if (biggestPos && Number(biggestPct) > 20) {
    parts.push(`${biggestPos.symbol} alone is ${biggestPct}% of holdings.`);
  }

  if (biggestMover && Math.abs(biggestMover.dayChangePercent) > 2) {
    const dir = biggestMover.dayChangePercent >= 0 ? 'up' : 'down';
    parts.push(
      `${biggestMover.symbol} is ${dir} ${Math.abs(biggestMover.dayChangePercent).toFixed(1)}% today.`
    );
  }

  if (account.dayPnl !== 0) {
    const pnlDir = account.dayPnl >= 0 ? 'up' : 'down';
    parts.push(
      `Portfolio ${pnlDir} ${dayPnlStr} (${account.dayPnlPercent >= 0 ? '+' : ''}${account.dayPnlPercent.toFixed(1)}%).`
    );
  }

  return parts.length > 0
    ? parts.join(' ')
    : `${positions.length} positions across ${Object.keys(sectors).length} sectors. Portfolio value: $${totalValue.toFixed(0)}.`;
}

export function AITab() {
  const { account } = usePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();

  const insight = useMemo(() => {
    if (account && !isConnected) {
      return getDemoInsight(account);
    }
    return generateInsight(account);
  }, [account, isConnected]);

  const [showBasketModal, setShowBasketModal] = useState(false);

  // Lazy tracking: trigger background refresh of suggestion outcomes
  useEffect(() => {
    fetch('/api/ai/suggestions/track', { method: 'POST' }).catch(() => {});
  }, []);

  // Listen for build-basket-modal open events from child components
  useEffect(() => {
    function handleOpenBasket() {
      setShowBasketModal(true);
    }

    window.addEventListener('vantage-open-basket-modal', handleOpenBasket);
    return () => {
      window.removeEventListener('vantage-open-basket-modal', handleOpenBasket);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <AIChat>
        {/* ── Card stack: Demo Banner → Account → Insight → Daily Brief → Weekly Snapshot ── */}

        {/* Demo Banner */}
        {!isConnected && <DemoBanner />}

        {/* Account Summary */}
        {account && (
          <div className="px-4 pt-3 pb-2">
            <AccountSummaryCard account={account} />
          </div>
        )}

        {/* Today's Key Insight */}
        <div className="mx-4 mb-3">
          <div className="bg-slate-800/40 rounded-2xl border border-slate-700/50 px-4 py-3">
            <p className="text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span>📊</span>
              Today&apos;s Key Insight
            </p>
            <p className="text-slate-300 text-sm leading-relaxed">
              {insight || 'Connect your portfolio to see insights.'}
            </p>
          </div>
        </div>

        {/* Daily Brief — color-coded labeled lines, collapsed by default */}
        <DailyBriefCard />

        {/* Weekly Snapshot — health metrics pills, expandable markdown */}
        <WeeklySnapshotCard />
      </AIChat>

      {/* Build Basket Modal — triggered by custom event from child components */}
      <BuildBasketModal
        isOpen={showBasketModal}
        onClose={() => setShowBasketModal(false)}
        onBasketGenerated={(userMsg, data) => {
          setShowBasketModal(false);
          // Dispatch event so AIChat can receive and display the result
          window.dispatchEvent(
            new CustomEvent('vantage-basket-generated', {
              detail: { userMsg, data },
            })
          );
        }}
      />
    </div>
  );
}
