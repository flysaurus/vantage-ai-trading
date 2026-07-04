'use client';

import { apiGet } from '@/lib/api-client';
import { useState, useEffect } from 'react';

interface Suggestion {
  id: string;
  symbol: string;
  suggested_price: number;
  conviction: 'high' | 'medium' | 'low';
  created_at: string;
  return_30d: number | null;
  outcome_30d: 'outperformed' | 'neutral' | 'underperformed' | null;
}

export default function SuggestionTracker() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    tracked: 0,
    outperformed: 0,
    hitRate: 0
  });

  useEffect(() => {
    apiGet('/api/ai/suggestions')
      .then(r => r.json())
      .then(data => {
        const list: Suggestion[] = data.suggestions || [];
        setSuggestions(list);
        const tracked = list.filter((s) => s.outcome_30d);
        const outperformed = tracked.filter((s) => s.outcome_30d === 'outperformed');
        setStats({
          total: list.length,
          tracked: tracked.length,
          outperformed: outperformed.length,
          hitRate: tracked.length > 0 ? Math.round((outperformed.length / tracked.length) * 100) : 0
        });
      })
      .catch(() => {});
  }, []);

  if (stats.total === 0) return null;

  return (
    <div className="mx-4 mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between bg-slate-800 rounded-2xl px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">📊</span>
          <span className="text-white text-sm font-medium">AI Suggestions</span>
          <span className="text-slate-300 text-xs">{stats.total} tracked</span>
        </div>
        <div className="flex items-center gap-3">
          {stats.tracked > 0 && (
            <span className={`text-xs font-medium ${
              stats.hitRate >= 60 ? 'text-green-400' : stats.hitRate >= 40 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {stats.hitRate}% hit rate
            </span>
          )}
          <span className="text-slate-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="bg-slate-800/50 rounded-b-xl border-t border-slate-700 px-4 py-3">
          {stats.tracked > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <p className="text-white font-semibold">{stats.tracked}</p>
                <p className="text-slate-300 text-xs">Resolved</p>
              </div>
              <div className="text-center">
                <p className="text-green-400 font-semibold">{stats.outperformed}</p>
                <p className="text-slate-300 text-xs">Beat Market</p>
              </div>
              <div className="text-center">
                <p className={`font-semibold ${stats.hitRate >= 60 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {stats.hitRate}%
                </p>
                <p className="text-slate-300 text-xs">Hit Rate</p>
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {suggestions.slice(0, 10).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-700/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">{s.symbol}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      s.conviction === 'high' ? 'bg-green-500/20 text-green-400' :
                      s.conviction === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-slate-600 text-slate-300'
                    }`}>
                      {s.conviction}
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs">
                    Suggested ${s.suggested_price?.toFixed(2)} · {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  {s.return_30d !== null ? (
                    <>
                      <p className={`text-sm font-medium ${s.return_30d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {s.return_30d >= 0 ? '+' : ''}{s.return_30d?.toFixed(1)}%
                      </p>
                      <p className="text-xs text-slate-300">
                        {s.outcome_30d === 'outperformed' ? '✅ Beat market' :
                         s.outcome_30d === 'underperformed' ? '❌ Missed' : '➡️ Neutral'}
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-300 text-xs">Tracking...</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {suggestions.length > 10 && (
            <p className="w-full text-center text-cyan-400 text-xs mt-3">
              View all {suggestions.length} suggestions →
            </p>
          )}

          <p className="text-slate-400 text-xs text-center mt-3">
            30-day performance vs S&amp;P 500
          </p>
        </div>
      )}
    </div>
  );
}
