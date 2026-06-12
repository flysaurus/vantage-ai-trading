'use client';

interface QuickActionsProps {
  onAction: (mode: string, message: string) => void;
  onOpenBasket: () => void;
  disabled?: boolean;
}

const ACTIONS = [
  {
    icon: '💡',
    label: 'Strategy Ideas',
    mode: 'strategy_ideas',
    message:
      'Based on my current portfolio and market conditions, what investment strategies should I consider right now? Give me 2-3 specific actionable ideas tailored to my holdings and risk profile.',
  },
  {
    icon: '📡',
    label: 'Market Pulse',
    mode: 'market_pulse',
    message: "Give me today's market pulse briefing for my portfolio",
  },
  {
    icon: '📋',
    label: 'Tax Check',
    mode: 'tax',
    message: 'Run a tax efficiency analysis on my portfolio',
  },
  {
    icon: '⚡',
    label: 'Alerts',
    mode: 'alerts',
    message: 'Scan my portfolio for urgent alerts and items needing attention',
  },
];

export default function QuickActions({
  onAction,
  onOpenBasket,
  disabled = false,
}: QuickActionsProps) {
  return (
    <div className="px-4 pt-2 pb-3">
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action.mode}
            disabled={disabled}
            onClick={() => onAction(action.mode, action.message)}
            className="flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 hover:border-cyan-500/40 hover:bg-slate-700/80 active:scale-95 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl py-2.5 px-4 text-slate-300 text-sm font-medium w-full transition-all duration-150 select-none"
          >
            <span className="text-base leading-none">{action.icon}</span>
            <span className="leading-none">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
