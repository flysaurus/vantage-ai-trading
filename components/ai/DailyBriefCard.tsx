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
      if (match) return { label: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase(), text: match[2].trim() };
      return { label: '', text: line.trim() };
    })
    .filter((l) => l.text);
}

/** Pull a one-line summary from the brief content — use first non-label line or first sentence */
function extractSummary(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    // Skip label-prefixed lines to get a real content snippet
    if (!/^(MARKET|PORTFOLIO|WATCH|EARNINGS):/i.test(line)) {
      const clean = line.replace(/^[-•*]\s*/, '').trim();
      const firstSentence = clean.split(/[.!?]\s/)[0].trim();
      if (firstSentence.length > 10) return firstSentence.length > 80 ? firstSentence.slice(0, 77) + '…' : firstSentence;
    }
  }
  // Fallback: use first label line without the label
  for (const line of lines) {
    const match = line.match(/^(MARKET|PORTFOLIO|WATCH|EARNINGS):\s*(.+)/i);
    if (match) {
      const t = match[2].trim();
      return t.length > 80 ? t.slice(0, 77) + '…' : t;
    }
  }
  return 'Today\'s brief';
}

const LABEL_COLORS: Record<string, string> = {
  Market: 'text-cyan-400',
  Portfolio: 'text-green-400',
  Watch: 'text-yellow-400',
  Earnings: 'text-purple-400',
};

export default function DailyBriefCard() {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    apiGet(`/api/ai/daily-brief?tz=${encodeURIComponent(tz)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ─── Chevron icon ───
  const Chevron = ({ open }: { open: boolean }) => (
    <svg
      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
        open ? 'rotate-180' : ''
      }`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  // ─── Loading skeleton (pill) ───
  if (loading) {
    return (
      <div className="mx-4">
        <div className="bg-slate-800/60 rounded-full border border-slate-700/60 px-4 py-2.5 flex items-center gap-2.5">
          <span className="text-sm">📡</span>
          <span className="text-white text-xs font-semibold uppercase tracking-wide">
            Daily Brief ✦
          </span>
          <span className="ml-auto">
            <span className="text-slate-300 text-[10px]">Loading…</span>
          </span>
        </div>
      </div>
    );
  }

  const brief = data?.content;
  if (!brief) return null;

  const parsed = parseBrief(brief);
  const summary = extractSummary(brief);

  // ─── Collapsed pill ───
  if (!expanded) {
    return (
      <div className="mx-4">
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-left bg-slate-800/60 rounded-full border border-slate-700/60 hover:border-cyan-500/40 transition-all duration-200 px-4 py-2.5 flex items-center gap-2.5"
        >
          <span className="text-sm shrink-0">📡</span>
          <span className="text-white text-xs font-semibold uppercase tracking-wide shrink-0">
            Daily Brief ✦
          </span>
          <span className="text-slate-400 text-[11px] truncate flex-1 min-w-0">
            · {data?.cached ? 'Cached' : 'Generated'} today · {summary}
          </span>
          <Chevron open={false} />
        </button>
      </div>
    );
  }

  // ─── Expanded card ───
  return (
    <div className="mx-4">
      <div className="bg-slate-800/60 rounded-xl border border-slate-700/60 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">📡</span>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">
              Daily Brief ✦
            </span>
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5">
              <span className="text-cyan-400 text-[10px] font-medium">Today</span>
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="text-slate-400 hover:text-slate-300 text-[11px] transition-colors"
          >
            Show less ▲
          </button>
        </div>

        {/* Body — labeled lines */}
        <div className="px-4 pb-3 space-y-2.5">
          {parsed.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed">
              {line.label ? (
                <>
                  <span className={`font-semibold ${LABEL_COLORS[line.label] || 'text-slate-300'}`}>
                    {line.label}
                  </span>{' '}
                  <span className="text-slate-300">{line.text}</span>
                </>
              ) : (
                <span className="text-slate-300">{line.text}</span>
              )}
            </p>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-700/50">
          <p className="text-slate-400 text-[10px]">
            {data?.cached
              ? 'Cached today · Refreshes tomorrow'
              : 'Generated just now · Refreshes tomorrow'}
          </p>
        </div>
      </div>
    </div>
  );
}
