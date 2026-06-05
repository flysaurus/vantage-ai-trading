'use client';
import { useState } from 'react';

const PRIMARY_PROMPTS = [
  { label: 'Health', icon: '📊', mode: 'health' },
  { label: 'Risk', icon: '🛡️', mode: 'risk' },
  { label: 'Opportunities', icon: '💡', mode: 'opportunities' },
  { label: 'Build Basket', icon: '🧺', action: 'openBasketModal' },
];

const SECONDARY_PROMPTS = [
  { label: 'Market Pulse', icon: '📡', mode: 'market_pulse' },
  { label: 'Tax Check', icon: '📋', mode: 'tax' },
  { label: 'Research', icon: '🔍', mode: 'research' },
  { label: 'Market Trends', icon: '📈', mode: 'trends' },
];

export function QuickActions() {
  const [showMore, setShowMore] = useState(false);

  const handleModeSelect = (mode: string) => {
    if (mode === 'openBasketModal') {
      window.dispatchEvent(new CustomEvent('vantage-open-basket-modal'));
      return;
    }
    window.dispatchEvent(new CustomEvent('vantage-ai-suggestion', {
      detail: { prompt: '', mode },
    }));
  };

  return (
    <div style={{ padding: '0 16px 12px' }}>
      {/* Primary row: always visible, flex-wrap */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {PRIMARY_PROMPTS.map((p) => (
          <button
            key={p.label}
            onClick={() => handleModeSelect(p.mode || p.action || '')}
            className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-slate-300 text-sm font-medium px-3 py-2 rounded-full whitespace-nowrap transition"
          >
            <span>{p.icon}</span>
            <span>{p.label}</span>
          </button>
        ))}
        <button
          onClick={() => setShowMore(true)}
          className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-slate-300 text-sm font-medium px-3 py-2 rounded-full whitespace-nowrap transition"
        >
          More ▾
        </button>
      </div>

      {/* Bottom sheet: secondary prompts */}
      {showMore && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50"
          onClick={() => setShowMore(false)}
        >
          <div
            className="bg-slate-900 rounded-t-2xl w-full p-4 pb-8 border-t border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-slate-400 text-xs text-center mb-4 uppercase tracking-wide">
              More Analysis
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SECONDARY_PROMPTS.map((p) => (
                <button
                  key={p.mode}
                  onClick={() => {
                    handleModeSelect(p.mode);
                    setShowMore(false);
                  }}
                  className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-300 font-medium"
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
