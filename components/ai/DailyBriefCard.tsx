'use client';
import { useState, useEffect } from 'react';

interface MarketSummary {
  spy?: { sym: string; price: number; changePct: number };
  qqq?: { sym: string; price: number; changePct: number };
  iwm?: { sym: string; price: number; changePct: number };
}

interface BriefData {
  content?: string;
  marketSummary?: MarketSummary;
  cached?: boolean;
}

export default function DailyBriefCard() {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/ai/daily-brief')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-4 mb-3 bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">📡</span>
          <span className="text-slate-400 text-xs">Loading daily brief...</span>
        </div>
        <div className="h-3 bg-slate-700 rounded w-3/4 mb-2 animate-pulse" />
        <div className="h-3 bg-slate-700 rounded w-1/2 animate-pulse" />
      </div>
    );
  }

  const brief = data?.content;
  if (!brief) return null;

  const lines = brief.split('\n').filter((l) => l.trim());
  const hasMore = lines.length > 2;

  return (
    <div className="mx-4 mb-3">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50 hover:border-slate-600 transition-all"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">📡</span>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">
              Daily Brief
            </span>
            <span className="text-slate-600 text-xs">Today</span>
          </div>
          <span className="text-slate-500 text-xs">
            {expanded ? '▲' : '▼'}
          </span>
        </div>

        {(expanded ? lines : lines.slice(0, 2)).map((line, i) => (
          <p key={i} className="text-slate-300 text-xs leading-relaxed">
            {line}
          </p>
        ))}

        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            {/* Market snapshot row */}
            {data?.marketSummary && (
              <div className="flex gap-3 mb-3">
                {(
                  [
                    { label: 'SPY', d: data.marketSummary.spy, color: 'text-slate-300' },
                    { label: 'QQQ', d: data.marketSummary.qqq, color: 'text-slate-300' },
                    { label: 'IWM', d: data.marketSummary.iwm, color: 'text-slate-300' },
                  ] as const
                ).map(({ label, d }) => {
                  if (!d?.price) return null;
                  const changeColor =
                    d.changePct > 0
                      ? 'text-green-400'
                      : d.changePct < 0
                        ? 'text-red-400'
                        : 'text-slate-400';
                  return (
                    <span key={label} className="text-xs text-slate-400">
                      {label}: <span className="text-white">${d.price.toFixed(2)}</span>{' '}
                      <span className={changeColor}>
                        ({d.changePct > 0 ? '+' : ''}
                        {d.changePct?.toFixed(2)}%)
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
            <p className="text-slate-600 text-xs">
              {data?.cached
                ? 'Cached today · Updates tomorrow'
                : 'Generated now · Updates tomorrow'}
            </p>
          </div>
        )}
      </button>
    </div>
  );
}
