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
    <p className="text-xs text-slate-300 mb-1.5 leading-relaxed">{children}</p>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 className="font-semibold text-sm text-white mt-4 mb-2">{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 className="font-medium text-xs text-cyan-400 uppercase tracking-wide mt-3 mb-1">{children}</h3>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li className="text-xs text-slate-300">{children}</li>
  ),
  hr: () => <hr className="border-slate-700/50 my-2" />,
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-2 border-cyan-500/50 pl-3 my-2 text-slate-400 text-[11px] italic">
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

/** Parse markdown content into separate sections */
function parseSections(content: string): ParsedSections {
  // Match sections by ## headings
  const healthMatch = content.match(/##\s*OVERALL HEALTH\s*\n([\s\S]*?)(?=##\s*RISKS|$)/i);
  const riskMatch = content.match(/##\s*RISKS\s*\n([\s\S]*?)(?=##\s*OPPORTUNITIES|##\s*SUMMARY|$)/i);
  const oppMatch = content.match(/##\s*OPPORTUNITIES\s*\n([\s\S]*?)(?=##\s*SUMMARY|$)/i);
  const summaryMatch = content.match(/##\s*SUMMARY\s*\n([\s\S]*?)$/i);

  return {
    health: (healthMatch?.[1] || '').trim(),
    risk: (riskMatch?.[1] || '').trim(),
    opportunities: (oppMatch?.[1] || '').trim(),
    summary: (summaryMatch?.[1] || '').trim(),
  };
}

export default function WeeklySnapshotCard() {
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Track which card is expanded — only one at a time
  const [expandedCard, setExpandedCard] = useState<
    'health' | 'risk' | 'opportunities' | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await await apiGet('/api/ai/weekly-snapshot');
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
      await await apiDelete('/api/ai/weekly-snapshot');
    } catch {
      // continue to reload
    }
    await load();
  };

  const toggleCard = (card: 'health' | 'risk' | 'opportunities') => {
    setExpandedCard((prev) => (prev === card ? null : card));
  };

  // ─── Loading skeleton ───
  if (loading && !data) {
    return (
      <div className="mx-4 mb-3 bg-slate-800/60 rounded-2xl p-4 border border-slate-700/60">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">📊</span>
          <span className="text-white text-xs font-semibold uppercase tracking-wide">
            Weekly Snapshot
          </span>
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-slate-700 rounded w-2/3 animate-pulse" />
          <div className="h-3 bg-slate-700 rounded w-1/2 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data?.content) return null;

  const {
    healthScore,
    riskLevel,
    opportunitiesCount,
    generatedAt,
    cached,
  } = data;

  const sections = parseSections(data.content);

  // ─── Health score color ───
  const healthColor =
    healthScore != null
      ? healthScore >= 7
        ? 'text-green-400'
        : healthScore >= 5
          ? 'text-yellow-400'
          : 'text-red-400'
      : 'text-slate-400';

  const healthBgColor =
    healthScore != null
      ? healthScore >= 7
        ? 'bg-green-500/10'
        : healthScore >= 5
          ? 'bg-yellow-500/10'
          : 'bg-red-500/10'
      : 'bg-slate-500/10';

  // ─── Risk badge color ───
  const riskColor =
    riskLevel === 'LOW'
      ? 'text-green-400'
      : riskLevel === 'HIGH'
        ? 'text-red-400'
        : riskLevel === 'MEDIUM'
          ? 'text-yellow-400'
          : 'text-slate-400';

  const riskBg =
    riskLevel === 'LOW'
      ? 'bg-green-500/15'
      : riskLevel === 'HIGH'
        ? 'bg-red-500/15'
        : riskLevel === 'MEDIUM'
          ? 'bg-yellow-500/15'
          : 'bg-slate-500/15';

  // ─── Chevron icon (reusable) ───
  const Chevron = ({ open }: { open: boolean }) => (
    <svg
      className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${
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

  return (
    <div className="mx-4 mb-3">
      {/* Section header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">📊</span>
          <span className="text-white text-xs font-semibold uppercase tracking-wide">
            Weekly Snapshot
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`text-xs transition ${
              refreshing
                ? 'text-slate-600'
                : 'text-cyan-400 hover:text-cyan-300'
            }`}
            title="Refresh analysis"
          >
            ↻
          </button>
          <span className="text-slate-500 text-[10px]">
            {generatedAt ? formatTime(generatedAt) : 'just now'}
            {cached ? ' · cached' : ''}
          </span>
        </div>
      </div>

      {/* ─── Three cards grid ─── */}
      <div className="grid grid-cols-1 gap-2">
        {/* ── Portfolio Health Card ── */}
        <button
          onClick={() => toggleCard('health')}
          className="w-full text-left bg-slate-800/60 rounded-xl border border-slate-700/60 hover:border-cyan-500/40 transition-all duration-200 overflow-hidden"
        >
          <div className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-lg ${healthBgColor} flex items-center justify-center text-sm`}
                >
                  ❤️
                </div>
                <div>
                  <p className="text-white text-xs font-semibold">
                    Portfolio Health
                  </p>
                  {healthScore != null && (
                    <p className={`text-xs font-bold ${healthColor}`}>
                      {healthScore}/10
                    </p>
                  )}
                </div>
              </div>
              <Chevron open={expandedCard === 'health'} />
            </div>

            {/* Expanded detail */}
            {expandedCard === 'health' && sections.health && (
              <div className="mt-3 pt-3 border-t border-slate-700/50">
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS as any}
                  >
                    {sections.health}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </button>

        {/* ── Risk Card ── */}
        <button
          onClick={() => toggleCard('risk')}
          className="w-full text-left bg-slate-800/60 rounded-xl border border-slate-700/60 hover:border-cyan-500/40 transition-all duration-200 overflow-hidden"
        >
          <div className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-sm">
                  🛡️
                </div>
                <div>
                  <p className="text-white text-xs font-semibold">Risk Assessment</p>
                  {riskLevel ? (
                    <span
                      className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${riskBg} ${riskColor}`}
                    >
                      {riskLevel}
                    </span>
                  ) : (
                    <p className="text-xs text-slate-500">No data</p>
                  )}
                </div>
              </div>
              <Chevron open={expandedCard === 'risk'} />
            </div>

            {expandedCard === 'risk' && sections.risk && (
              <div className="mt-3 pt-3 border-t border-slate-700/50">
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS as any}
                  >
                    {sections.risk}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </button>

        {/* ── Opportunities Card ── */}
        <button
          onClick={() => toggleCard('opportunities')}
          className="w-full text-left bg-slate-800/60 rounded-xl border border-slate-700/60 hover:border-cyan-500/40 transition-all duration-200 overflow-hidden"
        >
          <div className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">
                  💡
                </div>
                <div>
                  <p className="text-white text-xs font-semibold">Opportunities</p>
                  {opportunitiesCount != null && opportunitiesCount > 0 ? (
                    <p className="text-xs text-cyan-400 font-medium">
                      {opportunitiesCount} identified
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">None flagged</p>
                  )}
                </div>
              </div>
              <Chevron open={expandedCard === 'opportunities'} />
            </div>

            {expandedCard === 'opportunities' && sections.opportunities && (
              <div className="mt-3 pt-3 border-t border-slate-700/50">
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS as any}
                  >
                    {sections.opportunities}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </button>
      </div>

      {/* Footer */}
      <p className="mt-2 text-slate-600 text-[10px] px-1">
        {cached ? 'Refreshes next week' : 'Fresh analysis'} · Tap any card to expand
      </p>
    </div>
  );
}
