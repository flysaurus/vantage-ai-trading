'use client';
import { useState, useEffect } from 'react';

interface SnapshotData {
  content?: string;
  healthScore?: number | null;
  riskLevel?: string | null;
  opportunitiesCount?: number;
  weekStart?: string;
  cached?: boolean;
}

export default function WeeklySnapshotCard() {
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/ai/weekly-snapshot')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-4 mb-3 bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
        <div className="h-3 bg-slate-700 rounded w-2/3 mb-2 animate-pulse" />
        <div className="h-3 bg-slate-700 rounded w-1/2 animate-pulse" />
      </div>
    );
  }

  if (!data?.content) return null;

  const riskColor =
    data.riskLevel === 'LOW'
      ? 'text-green-400'
      : data.riskLevel === 'HIGH'
        ? 'text-red-400'
        : 'text-yellow-400';

  const daysAgo = data.weekStart
    ? Math.floor(
        (Date.now() - new Date(data.weekStart).getTime()) / 86400000,
      )
    : 0;

  return (
    <div className="mx-4 mb-3">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50 hover:border-slate-600 transition-all"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">📊</span>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">
              Weekly Snapshot
            </span>
          </div>
          <span className="text-slate-500 text-xs">
            {expanded ? '▲' : '▼'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {data.healthScore != null && (
            <span className="text-slate-300 text-xs">
              Health{' '}
              <span className="text-white font-semibold">
                {data.healthScore}/10
              </span>
            </span>
          )}
          {data.riskLevel && (
            <span className={`text-xs font-medium ${riskColor}`}>
              Risk {data.riskLevel}
            </span>
          )}
          {data.opportunitiesCount != null && data.opportunitiesCount > 0 && (
            <span className="text-slate-300 text-xs">
              {data.opportunitiesCount} opportunities
            </span>
          )}
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            <div className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">
              {data.content}
            </div>
            <div className="flex items-center justify-between mt-4">
              <p className="text-slate-600 text-xs">
                {daysAgo === 0
                  ? 'Generated today'
                  : `Updated ${daysAgo}d ago`}{' '}
                · Refreshes weekly
              </p>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  await fetch('/api/ai/weekly-snapshot', {
                    method: 'DELETE',
                  });
                  window.location.reload();
                }}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                ↻ Refresh
              </button>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}
