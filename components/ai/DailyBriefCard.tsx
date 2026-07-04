'use client';

import { apiGet } from '@/lib/api-client';
import { useState, useEffect } from 'react';

interface MarketSnapshot {
  sym: string;
  price: number;
  changePct: number;
}

interface MarketSummary {
  spy?: MarketSnapshot;
  qqq?: MarketSnapshot;
  iwm?: MarketSnapshot;
}

interface BriefData {
  content?: string | null;
  marketSummary?: MarketSummary;
  generatedAt?: string | null;
  cached?: boolean;
}

interface ParsedLine {
  label: string;
  text: string;
}

function parseBrief(content: string): ParsedLine[] {
  const lines = content.split('\n').filter((l) => l.trim());
  return lines
    .map((line) => {
      const match = line.match(/^(MARKET|PORTFOLIO|WATCH|EARNINGS):\s*(.+)/i);
      if (match) return { label: match[1].toUpperCase(), text: match[2].trim() };
      return { label: '', text: line.trim() };
    })
    .filter((l) => l.text);
}

const LABEL_COLORS: Record<string, string> = {
  MARKET: 'text-cyan-400',
  PORTFOLIO: 'text-green-400',
  WATCH: 'text-yellow-400',
  EARNINGS: 'text-purple-400',
};

export default function DailyBriefCard() {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    apiGet('/api/ai/daily-brief')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-4 mb-3 bg-slate-800 rounded-2xl p-4 border border-slate-700">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">📡</span>
          <span className="text-white text-xs font-semibold uppercase tracking-wide">
            Daily Brief
          </span>
          <span className="ml-auto rounded-full bg-slate-700 px-2 py-0.5">
            <span className="text-slate-300 text-[10px]">Loading...</span>
          </span>
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-slate-700 rounded w-3/4 animate-pulse" />
          <div className="h-3 bg-slate-700 rounded w-1/2 animate-pulse" />
        </div>
      </div>
    );
  }

  const brief = data?.content;
  if (!brief) return null;

  const parsed = parseBrief(brief);
  const visibleLines = expanded ? parsed : [];
  const hasMore = parsed.length > 0;

  return (
    <div className="mx-4 mb-3">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left bg-slate-800 rounded-2xl p-4 border border-slate-700 hover:border-slate-600 transition-colors"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">📡</span>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">
              Daily Brief
            </span>
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5">
              <span className="text-cyan-400 text-[10px] font-medium">Today</span>
            </span>
          </div>
          {hasMore && (
            <span className="text-slate-300 text-xs transition-transform">
              {expanded ? '▲ Show less' : '▼ Show more'}
            </span>
          )}
        </div>

        {/* Lines */}
        <div className="space-y-1.5">
          {visibleLines.map((line, i) => (
            <p key={i} className="text-xs leading-relaxed">
              {line.label ? (
                <>
                  <span className={`font-semibold ${LABEL_COLORS[line.label] || 'text-slate-300'}`}>
                    {line.label}:
                  </span>{' '}
                  <span className="text-slate-300">{line.text}</span>
                </>
              ) : (
                <span className="text-slate-300">{line.text}</span>
              )}
            </p>
          ))}
        </div>

        {/* Footer — visible when expanded */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-700/50 flex items-center justify-between">
            <p className="text-slate-400 text-[10px]">
              {data?.cached
                ? 'Cached today · Refreshes tomorrow'
                : 'Generated just now · Refreshes tomorrow'}
            </p>
          </div>
        )}
      </button>
    </div>
  );
}
