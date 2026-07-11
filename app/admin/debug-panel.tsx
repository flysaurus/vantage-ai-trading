'use client';

import { useState, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────

interface ResolvedRef { id: string; claim: string; }

interface Fact {
  id: string;
  user_id: string;
  subject: string;
  fact_type: string;
  claim: string;
  confidence: string;
  based_on: string[] | null;
  based_on_resolved: ResolvedRef[];
  source: string;
  created_at: string;
  expires_at: string | null;
  status: string;
  superseded_by: string | null;
}

interface GenLogEntry {
  id: string;
  user_id: string;
  surface: string;
  facts_read: Array<{ id: string; subject: string; fact_type: string; claim: string; confidence: string; source: string; status: string }>;
  prompt_context: string;
  facts_written: Array<{ subject: string; claim: string; fact_type: string; id?: string }>;
  created_at: string;
}

// ─── Components ─────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    superseded: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    resolved: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    stale: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>{status}</span>;
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    confirmed: 'bg-green-500 text-white',
    tentative: 'bg-amber-500 text-white',
    unconfirmed: 'bg-red-400 text-white',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[confidence] || 'bg-gray-400 text-white'}`}>{confidence}</span>;
}

// ─── Facts Table ────────────────────────────────────────────────

function FactsTable({ facts, filter, onFilter }: {
  facts: Fact[];
  filter: { subject: string; source: string };
  onFilter: (f: { subject: string; source: string }) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const subjects = [...new Set(facts.map(f => f.subject))].sort();
  const sources = [...new Set(facts.map(f => f.source))].sort();

  const filtered = facts.filter(f => {
    if (filter.subject && f.subject !== filter.subject) return false;
    if (filter.source && f.source !== filter.source) return false;
    return true;
  });

  return (
    <div>
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          className="px-3 py-1.5 border rounded text-sm dark:bg-gray-800 dark:border-gray-600"
          value={filter.subject}
          onChange={e => onFilter({ ...filter, subject: e.target.value })}
        >
          <option value="">All Subjects</option>
          {subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="px-3 py-1.5 border rounded text-sm dark:bg-gray-800 dark:border-gray-600"
          value={filter.source}
          onChange={e => onFilter({ ...filter, source: e.target.value })}
        >
          <option value="">All Sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-sm text-gray-500 self-center">
          Showing {filtered.length} of {facts.length} facts
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-sm py-8 text-center">No facts found.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(f => (
            <div key={f.id} className="border rounded dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => toggle(f.id)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-xs text-gray-400 w-4">{expanded.has(f.id) ? '▼' : '▶'}</span>
                <StatusBadge status={f.status} />
                <span className="font-mono text-xs text-gray-500">{f.fact_type}</span>
                <span className="font-semibold text-sm truncate flex-1">{f.subject}</span>
                <ConfidenceBadge confidence={f.confidence} />
                <span className="text-xs text-gray-400 whitespace-nowrap">{f.source}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(f.created_at).toLocaleDateString()}
                </span>
              </button>
              {expanded.has(f.id) && (
                <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/50 text-sm border-t dark:border-gray-700 space-y-2">
                  <div>
                    <span className="font-medium text-gray-500">Claim:</span>{' '}
                    <span className="text-gray-900 dark:text-gray-100">{f.claim}</span>
                  </div>
                  {f.based_on_resolved && f.based_on_resolved.length > 0 && (
                    <div>
                      <span className="font-medium text-gray-500">Based On:</span>
                      <ul className="list-disc ml-5 mt-1 space-y-1">
                        {f.based_on_resolved.map(ref => (
                          <li key={ref.id} className="text-gray-700 dark:text-gray-300 text-xs">{ref.claim}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {f.superseded_by && (
                    <div>
                      <span className="font-medium text-gray-500">Superseded By:</span>{' '}
                      <code className="text-xs">{f.superseded_by}</code>
                    </div>
                  )}
                  {f.expires_at && (
                    <div>
                      <span className="font-medium text-gray-500">Expires:</span>{' '}
                      <span className="text-xs">{new Date(f.expires_at).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="text-xs text-gray-400">
                    ID: <code>{f.id}</code>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Generation Log View ────────────────────────────────────────

function GenLogView({ logs }: { logs: GenLogEntry[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  if (logs.length === 0) {
    return <p className="text-gray-500 text-sm py-8 text-center">No generation logs yet. Trigger a Weekly Snapshot or greeting generation to populate.</p>;
  }

  return (
    <div className="space-y-3">
      {logs.map(log => (
        <div key={log.id} className="border rounded dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => toggle(log.id)}
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <span className="text-xs text-gray-400 w-4">{expanded.has(log.id) ? '▼' : '▶'}</span>
            <span className="text-sm font-semibold">{log.surface}</span>
            <span className="text-xs text-gray-400">
              {new Date(log.created_at).toLocaleString()}
            </span>
            <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-2 py-0.5 rounded ml-auto">
              {log.facts_read.length} read / {log.facts_written.length} written
            </span>
          </button>
          {expanded.has(log.id) && (
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/50 text-sm border-t dark:border-gray-700 space-y-4">
              {/* Facts Read */}
              <div>
                <h4 className="font-bold text-gray-700 dark:text-gray-300 mb-2">
                  📖 Facts Read ({log.facts_read.length})
                </h4>
                {log.facts_read.length === 0 ? (
                  <p className="text-gray-400 italic text-xs">No active facts at generation time.</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {log.facts_read.map((f, i) => (
                      <div key={i} className="text-xs flex gap-2 py-0.5 border-b border-gray-100 dark:border-gray-700">
                        <span className="font-mono text-gray-400 w-20 truncate">{f.subject}</span>
                        <span className="text-gray-600 dark:text-gray-400">[{f.fact_type}]</span>
                        <span className="truncate flex-1">{f.claim}</span>
                        <span className={`font-medium ${f.confidence === 'confirmed' ? 'text-green-600' : f.confidence === 'tentative' ? 'text-amber-600' : 'text-red-500'}`}>
                          {f.confidence}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Prompt Context */}
              <div>
                <h4 className="font-bold text-gray-700 dark:text-gray-300 mb-2">
                  📝 Prompt Context Injected
                </h4>
                {log.prompt_context ? (
                  <pre className="text-xs bg-gray-900 text-green-300 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
                    {log.prompt_context}
                  </pre>
                ) : (
                  <p className="text-gray-400 italic text-xs">No facts were injected into the prompt.</p>
                )}
              </div>

              {/* Facts Written */}
              <div>
                <h4 className="font-bold text-gray-700 dark:text-gray-300 mb-2">
                  ✍️ Facts Written Back ({log.facts_written.length})
                </h4>
                {log.facts_written.length === 0 ? (
                  <p className="text-gray-400 italic text-xs">No facts written back.</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {log.facts_written.map((f, i) => (
                      <div key={i} className="text-xs flex gap-2 py-0.5 border-b border-gray-100 dark:border-gray-700">
                        <span className="font-mono text-gray-400 w-20 truncate">{f.subject}</span>
                        <span className="text-gray-500">[{f.fact_type}]</span>
                        <span className="truncate flex-1">{f.claim}</span>
                        {f.id && <code className="text-gray-400 text-xs">{f.id.slice(0, 8)}</code>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Debug Panel ──────────────────────────────────────────

export function AdminDebugPanel() {
  const [userId, setUserId] = useState('');
  const [tab, setTab] = useState<'facts' | 'logs'>('facts');
  const [facts, setFacts] = useState<Fact[]>([]);
  const [logs, setLogs] = useState<GenLogEntry[]>([]);
  const [filter, setFilter] = useState({ subject: '', source: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [lastUser, setLastUser] = useState('');

  const loadFacts = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/facts?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setFacts(data.facts);
      setStatusCounts(data.statusCounts || {});
      setLastUser(userId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadLogs = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/generation-log?userId=${encodeURIComponent(userId)}&limit=50`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setLogs(data.logs || []);
      setLastUser(userId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-6 font-sans">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🔍 Vantage AI — Admin Debug</h1>
          <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 px-2 py-1 rounded">
            DEBUG TOOL
          </span>
        </div>

        {/* Query controls — no more code field, auth is via requireAdmin() */}
        <div className="flex gap-3 mb-6 flex-wrap items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">User ID</label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="e.g. 58ffa82a-2b14-4a5d-9662-5c48f105031f"
              className="px-3 py-2 border rounded text-sm w-80 font-mono dark:bg-gray-800 dark:border-gray-600"
            />
          </div>
          <button
            onClick={() => { if (tab === 'facts') loadFacts(); else loadLogs(); }}
            disabled={loading || !userId}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {lastUser && (
          <div className="text-xs text-gray-400 mb-4">
            Viewing data for <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{lastUser}</code>
            {Object.keys(statusCounts).length > 0 && (
              <span className="ml-3">
                {Object.entries(statusCounts).map(([s, c]) => (
                  <span key={s} className="ml-2">{s}: <b>{c}</b></span>
                ))}
              </span>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b dark:border-gray-700">
          <button
            onClick={() => { setTab('facts'); loadFacts(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'facts' ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            📊 Facts Table
          </button>
          <button
            onClick={() => { setTab('logs'); loadLogs(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'logs' ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            📝 Generation Log
          </button>
        </div>

        {/* Content */}
        {tab === 'facts' ? (
          <FactsTable facts={facts} filter={filter} onFilter={setFilter} />
        ) : (
          <GenLogView logs={logs} />
        )}
      </div>
    </div>
  );
}
