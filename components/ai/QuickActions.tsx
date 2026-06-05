'use client';
import { useMemo } from 'react';
import { usePortfolioStore, useMarketStore } from '@/store';
import { TrendingUp, Shield, Heart } from 'lucide-react';

interface ActionItem {
  icon: typeof TrendingUp;
  label: string;
  prompt: string;
  mode: string;
}

export function QuickActions() {
  const { account } = usePortfolioStore();
  const { isMarketOpen } = useMarketStore();

  // Dynamic AI suggestions based on portfolio state
  const actions = useMemo(() => {
    const dynamic: ActionItem[] = [];

    if (!account?.positions?.length) {
      dynamic.push({
        icon: TrendingUp,
        label: '📈 Market Trends',
        prompt: 'What are the markets doing today?',
        mode: 'trends',
      });
      return dynamic;
    }

    const hasLosers = account.positions.some((p) => p.totalPnlPercent < -5);
    const hasBigWinners = account.positions.some((p) => p.totalPnlPercent > 20);
    const isConcentrated = account.positions.some((p) => p.portfolioPercent > 25);

    if (hasLosers) {
      dynamic.push({
        icon: Shield,
        label: '🛡 Risk Check',
        prompt: 'Check my portfolio risk',
        mode: 'risk',
      });
    }

    if (hasBigWinners) {
      dynamic.push({
        icon: TrendingUp,
        label: '💡 Opportunities',
        prompt: 'Based on my current portfolio and market conditions, what buying or rebalancing opportunities do you see?',
        mode: 'opportunities',
      });
    }

    if (isConcentrated) {
      dynamic.push({
        icon: Heart,
        label: '🌱 Health Check',
        prompt: 'How healthy is my portfolio right now?',
        mode: 'health',
      });
    }

    return dynamic;
  }, [account, isMarketOpen]);

  if (actions.length === 0) return null;

  return (
    <div style={{
      padding: '0 16px 12px',
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.min(actions.length, 4)}, 1fr)`,
      gap: 8,
    }}>
      {actions.slice(0, 8).map(({ icon: Icon, label, prompt, mode }) => (
        <button
          key={label}
          onClick={() => {
            // Trigger a click on the chat suggestion that matches this prompt
            const event = new CustomEvent('vantage-ai-suggestion', {
              detail: { prompt, mode },
            });
            window.dispatchEvent(event);
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
        .qa-label { font-size: 15px; font-weight: 600; }
      `}</style>
    </div>
  );
}
