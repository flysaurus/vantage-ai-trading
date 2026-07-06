'use client';

interface QuickActionsProps {
  onAction: (mode: string, message: string) => void;
  onOpenBasket: () => void;
  disabled?: boolean;
}

interface QuickAction {
  icon: string;
  label: string;
  mode: string;
  message: string;
  live?: boolean;
}

const ACTIONS: QuickAction[] = [
  {
    icon: '💡',
    label: 'Strategy Ideas',
    mode: 'strategy_ideas',
    message:
      'Based on my current portfolio and market conditions, what investment strategies should I consider right now? Give me 2-3 specific actionable ideas — they can involve my current holdings or suggest new positions worth researching.',
  },
  {
    icon: '📡',
    label: 'Market Pulse',
    mode: 'market_pulse',
    live: true,
    message: "Give me a broad market overview right now — major indices, sector moves, and anything worth paying attention to. Tie it back to how these conditions might affect my portfolio, but don't limit the briefing to just my current holdings.",
  },
  {
    icon: '🔍',
    label: 'Find Opportunities',
    mode: 'opportunities',
    live: true,
    message: 'Based on current market conditions and my investor style, are there any stocks or sectors worth researching right now — including ones I don\'t currently hold? Frame recommendations around my risk profile and investment approach.',
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
        {ACTIONS.map((action, i) => (
          <button
            key={action.mode}
            disabled={disabled}
            onClick={() => onAction(action.mode, action.message)}
            className={`flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 hover:border-cyan-500/40 hover:bg-slate-700/80 active:scale-95 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl py-2.5 px-4 text-slate-300 text-sm font-medium transition-all duration-150 select-none ${i === ACTIONS.length - 1 ? 'col-span-2' : ''}`}
          >
            <span className="text-base leading-none">{action.icon}</span>
            <span className="leading-none">{action.label}</span>
            {action.live && (
              <span style={{
                fontSize: '7.5px',
                fontWeight: 700,
                color: '#22d3ee',
                background: 'rgba(34,211,238,0.12)',
                padding: '0px 4px',
                borderRadius: '999px',
                letterSpacing: '0.05em',
                lineHeight: 1.5,
              }}>LIVE</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
