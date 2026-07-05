'use client';

import { apiDelete, apiGet } from '@/lib/api-client';
import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SnapshotData {
  content?: string | null;
  healthScore?: number | null;
  riskLevel?: string | null;
  opportunitiesCount?: number;
  weekStart?: string;
  generatedAt?: string | null;
  cached?: boolean;
}

interface ParsedSections {
  health: string;
  risk: string;
  opportunities: string;
  summary: string;
}

const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm text-slate-300 mb-1.5 leading-relaxed">{children}</p>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 className="font-semibold text-sm text-white mt-3 mb-1.5">{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 className="font-medium text-xs text-cyan-400 uppercase tracking-wide mt-2 mb-1">{children}</h3>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul className="list-disc pl-4 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li className="text-sm text-slate-300">{children}</li>
  ),
  hr: () => <hr className="border-slate-700/50 my-2" />,
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-2 border-cyan-500/50 pl-3 my-1.5 text-slate-300 text-xs italic">
      {children}
    </blockquote>
  ),
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return 'just now';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

/** Extract risk level from section text as UI fallback */
function extractRiskFromSection(section: string): string | null {
  if (!section) return null;
  const match = section.match(/\b(LOW|MEDIUM|HIGH)\b/i);
  return match ? match[1].toUpperCase() : null;
}

/** Parse markdown content into separate sections */
function parseSections(content: string): ParsedSections {
  const healthMatch = content.match(/(?:^#*\s*)?(?:OVERALL HEALTH|PORTFOLIO HEALTH).*\n([\s\S]*?)(?=^#*\s*(?:RISKS?|OVERALL RISK|RISK LEVEL)|\Z)/im);
  const riskMatch = content.match(/(?:^#*\s*)?(?:RISKS?|OVERALL RISK|RISK LEVEL).*\n([\s\S]*?)(?=^#*\s*(?:OPPORTUNITIES?|SUMMARY)|\Z)/im);
  const oppMatch = content.match(/(?:^#*\s*)?OPPORTUNITIES?.*\n([\s\S]*?)(?=^#*\s*SUMMARY|\Z)/im);
  const summaryMatch = content.match(/(?:^#*\s*)?SUMMARY.*\n?([\s\S]*?)$/im);

  return {
    health: (healthMatch?.[1] || '').trim(),
    risk: (riskMatch?.[1] || '').trim(),
    opportunities: (oppMatch?.[1] || '').trim(),
    summary: (summaryMatch?.[1] || '').trim(),
  };
}

const SUB_CARD_ICONS: Record<string, string> = {
  health: '❤️',
  risk: '🛡️',
  opportunities: '💡',
};

const SUB_CARD_TITLES: Record<string, string> = {
  health: 'Portfolio Health',
  risk: 'Risk Assessment',
  opportunities: 'Opportunities',
};

const SUB_CARD_ORDER = ['health', 'risk', 'opportunities'] as const;

export default function WeeklySnapshotCard() {
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [parentExpanded, setParentExpanded] = useState(false);
  const [expandedCard, setExpandedCard] = useState<'health' | 'risk' | 'opportunities' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      const r = await apiGet(`/api/ai/weekly-snapshot?tz=${encodeURIComponent(tz)}`);
      const d = await r.json();
      setData(d);
    } catch {
      // keep existing data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    try {
      await apiDelete('/api/ai/weekly-snapshot');
    } catch {
      // continue to reload
    }
    await load();
  };

  const toggleParent = () => {
    setParentExpanded((prev) => {
      if (prev) setExpandedCard(null);
      return !prev;
    });
  };

  const toggleCard = (card: 'health' | 'risk' | 'opportunities') => {
    setExpandedCard((prev) => (prev === card ? null : card));
  };

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
  if (loading && !data) {
    return (
      <div className="mx-4">
        <div className="bg-slate-800/60 rounded-full border border-slate-700/60 px-4 py-2.5 flex items-center gap-2.5">
          <span className="text-sm">📊</span>
          <span className="text-white text-xs font-semibold uppercase tracking-wide">
            Weekly Snapshot
          </span>
          <span className="ml-auto">
            <span className="text-slate-300 text-[10px]">Loading…</span>
          </span>
        </div>
      </div>
    );
  }

  if (!data?.content) return null;

  const {
    healthScore,
    riskLevel: apiRiskLevel,
    opportunitiesCount,
    generatedAt,
  } = data;

  const sections = parseSections(data.content);
  const riskLevel = apiRiskLevel || extractRiskFromSection(sections.risk);

  // ─── Compute real opportunities count ───
  const realOppCount = (() => {
    if (opportunitiesCount != null && opportunitiesCount > 0) return opportunitiesCount;
    const bullets = sections.opportunities.match(/^[\s]*[-•*]\s|\n[\s]*[-•*]\s/gm);
    return bullets ? bullets.length : 0;
  })();

  // ─── Health score colors ───
  const healthColor =
    healthScore != null
      ? healthScore >= 7
        ? 'text-green-400'
        : healthScore >= 5
          ? 'text-yellow-400'
          : 'text-red-400'
      : 'text-slate-400';

  const healthBg =
    healthScore != null
      ? healthScore >= 7
        ? 'bg-green-500/10 text-green-400'
        : healthScore >= 5
          ? 'bg-yellow-500/10 text-yellow-400'
          : 'bg-red-500/10 text-red-400'
      : 'bg-slate-500/10 text-slate-400';

  // ─── Risk badge ───
  const riskColor =
    riskLevel === 'LOW'
      ? 'text-green-400'
      : riskLevel === 'HIGH'
        ? 'text-red-400'
        : riskLevel === 'MEDIUM'
          ? 'text-yellow-400'
          : 'text-slate-400';

  const riskBadgeBg =
    riskLevel === 'LOW'
      ? 'bg-green-500/15 text-green-400'
      : riskLevel === 'HIGH'
        ? 'bg-red-500/15 text-red-400'
        : riskLevel === 'MEDIUM'
          ? 'bg-yellow-500/15 text-yellow-400'
      : 'bg-slate-500/15 text-slate-400';

  // ─── Sub-card summary value getter ───
  const subCardValue = (card: 'health' | 'risk' | 'opportunities'): { text: string; colorClass: string; badgeClass?: string } | null => {
    switch (card) {
      case 'health':
        if (healthScore != null) return { text: `${healthScore}/10`, colorClass: healthColor };
        return { text: 'Calculating…', colorClass: 'text-slate-400' };
      case 'risk':
        if (riskLevel) return { text: riskLevel, colorClass: riskColor, badgeClass: riskBadgeBg };
        return { text: 'Calculating…', colorClass: 'text-slate-400' };
      case 'opportunities':
        if (realOppCount > 0) return { text: `${realOppCount}`, colorClass: 'text-cyan-400' };
        return { text: '0', colorClass: 'text-slate-400' };
    }
  };

  // ─── Collapsed pill ───
  if (!parentExpanded) {
    return (
      <div className="mx-4">
        <button
          onClick={toggleParent}
          className="w-full text-left bg-slate-800/60 rounded-full border border-slate-700/60 hover:border-cyan-500/40 transition-all duration-200 px-4 py-2.5 flex items-center gap-2"
        >
          <span className="text-sm shrink-0">📊</span>
          <span className="text-white text-xs font-semibold uppercase tracking-wide shrink-0">
            Weekly Snapshot
          </span>
          <span className="text-slate-400 text-[11px] truncate flex-1 min-w-0">
            · Updated {generatedAt ? formatTime(generatedAt) : 'just now'}
          </span>
          {healthScore != null && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${healthBg}`}>
              {healthScore}/10
            </span>
          )}
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
            <span className="text-sm">📊</span>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">
              Weekly Snapshot
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-[11px]">
              {generatedAt ? formatTime(generatedAt) : 'just now'}
            </span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`text-xs transition shrink-0 ${
                refreshing
                  ? 'text-slate-400'
                  : 'text-cyan-400 hover:text-cyan-300'
              }`}
            >
              ↻
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); toggleParent(); }}
              className="text-slate-400 hover:text-slate-300 text-[11px] transition-colors shrink-0"
            >
              Show less ▲
            </button>
          </div>
        </div>

        {/* Sub-pills */}
        <div className="px-3 pb-3 space-y-2">
          {SUB_CARD_ORDER.map((key) => {
            const value = subCardValue(key as 'health' | 'risk' | 'opportunities');
            const isExpanded = expandedCard === key;
            const sectionContent = sections[key as keyof ParsedSections];

            return (
              <div key={key}>
                {/* Sub-pill button (collapsed state) */}
                <button
                  onClick={() => toggleCard(key as 'health' | 'risk' | 'opportunities')}
                  className={`w-full text-left border transition-all duration-200 ${
                    isExpanded
                      ? 'bg-slate-800/80 rounded-xl border-slate-700/60'
                      : 'bg-slate-800/40 rounded-full border-slate-700/40 hover:border-cyan-500/40'
                  } px-4 py-2.5 flex items-center gap-2.5`}
                >
                  <span className="text-sm shrink-0">{SUB_CARD_ICONS[key]}</span>
                  <span className="text-white text-xs font-medium flex-1">
                    {SUB_CARD_TITLES[key]}
                  </span>
                  {value && (
                    <span className="shrink-0 mr-1">
                      {key === 'risk' && value.badgeClass ? (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${value.badgeClass}`}>
                          {value.text}
                        </span>
                      ) : (
                        <span className={`text-xs font-semibold ${value.colorClass}`}>
                          {value.text}
                        </span>
                      )}
                    </span>
                  )}
                  <Chevron open={isExpanded} />
                </button>

                {/* Expanded content */}
                {isExpanded && sectionContent && (
                  <div className="px-4 py-3 border-t border-slate-700/50 mx-3">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={MARKDOWN_COMPONENTS as any}
                    >
                      {sectionContent}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            );
          })}

          {/* Footer */}
          <p className="text-slate-400 text-[10px] px-1 pt-1">
            {data.cached ? 'Refreshes next week' : 'Fresh analysis'} · Tap any card to expand
          </p>
        </div>
      </div>
    </div>
  );
}
