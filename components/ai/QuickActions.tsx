'use client';
import { useMemo } from 'react';
import { useTabStore, usePortfolioStore, useMarketStore } from '@/store';
import {
  DollarSign, LayoutDashboard, ListOrdered,
  Search, Shield, TrendingUp, AlertTriangle, BarChart3,
} from 'lucide-react';

interface ActionItem {
  icon: typeof DollarSign;
  label: string;
  tab: 'ai' | 'trade' | 'portfolio' | 'orders' | 'settings';
  prompt?: string;
}

const BASE_ACTIONS: ActionItem[] = [
  { icon: DollarSign, label: 'Trade', tab: 'trade' },
  { icon: LayoutDashboard, label: 'Positions', tab: 'portfolio' },
  { icon: ListOrdered, label: 'Orders', tab: 'orders' },
  { icon: Search, label: 'Research', tab: 'ai' },
];

export function QuickActions() {
  const { setTab } = useTabStore();
  const { account } = usePortfolioStore();
  const { isMarketOpen } = useMarketStore();

  // Dynamically adjust suggestions based on portfolio state
  const actions = useMemo(() => {
    if (!account?.positions?.length) {
      // No portfolio yet — show exploration-focused actions
      return [
        ...BASE_ACTIONS,
        { icon: TrendingUp, label: 'Markets', tab: 'ai' as const },
      ];
    }

    const hasLosers = account.positions.some((p) => p.totalPnlPercent < -5);
    const hasBigWinners = account.positions.some((p) => p.totalPnlPercent > 20);
    const isConcentrated = account.positions.some((p) => p.portfolioPercent > 25);

    const dynamic: ActionItem[] = [...BASE_ACTIONS];

    if (hasLosers) {
      dynamic.push({
        icon: Shield,
        label: 'Risk Check',
        tab: 'ai',
        prompt: 'Check my portfolio risk',
      });
    }

    if (hasBigWinners) {
      dynamic.push({
        icon: TrendingUp,
        label: 'Take Profit?',
        tab: 'ai',
        prompt: 'Should I take profits on my winning positions?',
      });
    }

    if (isConcentrated) {
      dynamic.push({
        icon: AlertTriangle,
        label: 'Rebalance',
        tab: 'ai',
        prompt: 'How should I rebalance my portfolio?',
      });
    }

    if (!isMarketOpen) {
      dynamic.push({
        icon: BarChart3,
        label: 'Plan Trades',
        tab: 'ai',
        prompt: 'What should I prepare for next market open?',
      });
    }

    return dynamic;
  }, [account, isMarketOpen]);

  return (
    <div style={{
      padding: '0 16px 12px',
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.min(actions.length, 4)}, 1fr)`,
      gap: 8,
    }}>
      {actions.slice(0, 8).map(({ icon: Icon, label, tab, prompt }) => (
        <button
          key={label}
          onClick={() => {
            setTab(tab);
            // If there's a prompt and we're going to AI tab, we could pre-fill the chat
            // This is handled by the AIChat component's suggestion buttons instead
          }}
          className="qa-btn"
        >
          <Icon size={18} style={{ marginBottom: 4 }} />
          <span className="qa-label">{label}</span>
        </button>
      ))}
      <style jsx>{`
        .qa-btn {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 10px 4px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          align-items: center;
          color: #cbd5e1;
        }
        .qa-btn:active { background: #334155; transform: scale(0.97); }
        .qa-label { font-size: 10px; font-weight: 600; }
      `}</style>
    </div>
  );
}
