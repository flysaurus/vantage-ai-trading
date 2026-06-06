'use client';
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
  table: ({ children }: { children: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  tbody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr className="border-b border-slate-700/50">{children}</tr>
  ),
  th: ({ children }: { children: React.ReactNode }) => (
    <th className="text-cyan-400 font-medium text-left px-2 py-1.5 text-[10px] uppercase tracking-wide">
      {children}
    </th>
  ),
  td: ({ children }: { children: React.ReactNode }) => (
    <td className="text-white/85 px-2 py-1.5">{children}</td>
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

export default function WeeklySnapshotCard() {
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/ai/weekly-snapshot');
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
      await fetch('/api/ai/weekly-snapshot', { method: 'DELETE' });
    } catch {
      // continue to reload
    }
    await load();
  };

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

  const { healthScore, riskLevel, opportunitiesCount, generatedAt, cached } = data;

  // Health score color
  const healthColor =
    healthScore != null
      ? healthScore >= 7
        ? 'text-green-400'
        : healthScore >= 5
          ? 'text-yellow-400'
          : 'text-red-400'
      : 'text-slate-400';

  // Risk badge color
  const riskBgColor =
    riskLevel === 'LOW'
      ? 'bg-green-500/15 text-green-400'
      : riskLevel === 'HIGH'
        ? 'bg-red-500/15 text-red-400'
        : riskLevel === 'MEDIUM'
          ? 'bg-yellow-500/15 text-yellow-400'
          : 'bg-slate-500/15 text-slate-400';

  return (
    <div className="mx-4 mb-3">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left bg-slate-800/60 rounded-2xl p-4 border border-slate-700/60 hover:border-slate-600/60 transition-colors"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">📊</span>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">
              Weekly Snapshot
            </span>
            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`ml-1 text-xs transition ${
                refreshing
                  ? 'text-slate-600'
                  : 'text-cyan-400 hover:text-cyan-300'
              }`}
              title="Refresh analysis"
            >
              ↻
            </button>
          </div>
          <span className="text-slate-500 text-xs">
            {expanded ? '▲ Hide analysis' : '▼ Full analysis'}
          </span>
        </div>

        {/* Summary row — always visible */}
        <div className="flex items-center gap-3 flex-wrap">
          {healthScore != null && (
            <span className="text-xs text-slate-400">
              Health{' '}
              <span className={`font-semibold ${healthColor}`}>
                {healthScore}/10
              </span>
            </span>
          )}
          {riskLevel && (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${riskBgColor}`}
            >
              Risk: {riskLevel}
            </span>
          )}
          {opportunitiesCount != null && opportunitiesCount > 0 && (
            <span className="text-xs text-slate-400">
              {opportunitiesCount} opportunit{opportunitiesCount === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>

        {/* Expanded markdown analysis */}
        {expanded && (
          <div className="mt-4 pt-3 border-t border-slate-700/50">
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS as any}
              >
                {data.content}
              </ReactMarkdown>
            </div>

            {/* Footer */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-slate-600 text-[10px]">
                {generatedAt
                  ? `Generated ${formatTime(generatedAt)}`
                  : 'Generated just now'}{' '}
                · {cached ? 'Refreshes next week' : 'Fresh analysis'}
              </p>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}
