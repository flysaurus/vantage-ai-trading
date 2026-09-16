'use client';

// ─── Admin: Test Cases & Cycles (client) ──────────────────────
// Bulk-paste test cases, browse them, and assemble cycles from a
// checkbox multi-select. No external UI lib — inline styles + CSS vars.

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, Plus, ClipboardList, Layers } from 'lucide-react';

interface TestCase {
  id: string;
  tc_number: string;
  title: string;
  area: string | null;
}

interface TestCycle {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  case_count?: number;
}

const PLACEHOLDER = `TC-014: Login with a valid email
Steps:
1. Open /login
2. Enter a valid email + password
Expected: User lands on the dashboard
Area: Auth

TC-015: Session survives a hard refresh
Steps:
1. Log in
2. Reload the page
Expected: Still authenticated
Area: Auth`;

export function TestCasesAdmin() {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [cycles, setCycles] = useState<TestCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paste, setPaste] = useState('');
  const [adding, setAdding] = useState(false);
  const [addSummary, setAddSummary] = useState<string | null>(null);

  const [cycleName, setCycleName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, cyRes] = await Promise.all([
        fetch('/api/admin/test-cases'),
        fetch('/api/admin/test-cycles'),
      ]);
      const cData = await cRes.json();
      const cyData = await cyRes.json();
      if (cRes.ok) setCases(cData.cases || []);
      else setError(cData.error || 'Failed to load test cases');
      if (cyRes.ok) setCycles(cyData.cycles || []);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddCases = async () => {
    setAdding(true);
    setAddSummary(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/test-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: paste }),
      });
      const data = await res.json();
      if (res.ok) {
        setAddSummary(
          `Added — ${data.inserted} new, ${data.updated} updated, ${data.skipped} skipped.`,
        );
        setPaste('');
        load();
      } else {
        setError(data.error || 'Failed to add cases');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setAdding(false);
  };

  const toggleCase = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateCycle = async () => {
    if (!cycleName.trim()) {
      setError('Cycle name is required.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/test-cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cycleName.trim(), caseIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (res.ok) {
        setCycleName('');
        setSelected(new Set());
        load();
      } else {
        setError(data.error || 'Failed to create cycle');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setCreating(false);
  };

  const card: React.CSSProperties = {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 10,
    padding: '16px 18px',
    marginBottom: '1.25rem',
  };
  const input: React.CSSProperties = {
    width: '100%',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#c9d1d9',
    padding: '10px 12px',
    fontSize: '0.85rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    boxSizing: 'border-box',
  };
  const primaryBtn = (busy: boolean): React.CSSProperties => ({
    background: '#238636',
    border: 'none',
    color: '#fff',
    borderRadius: 6,
    padding: '9px 16px',
    cursor: busy ? 'wait' : 'pointer',
    fontWeight: 600,
    fontSize: '0.85rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    opacity: busy ? 0.6 : 1,
  });

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto', color: '#c9d1d9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#f0f6fc' }}>
          Test Cases
        </h1>
        <button
          onClick={load}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid #30363d',
            color: '#8b949e',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.8rem',
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(218,54,51,0.1)', border: '1px solid #da3633', borderRadius: 8, padding: '10px 14px', marginBottom: '1rem', fontSize: '0.85rem', color: '#f85149' }}>
          {error}
        </div>
      )}

      {/* Bulk paste */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ClipboardList size={16} color="#58a6ff" />
          <strong style={{ color: '#f0f6fc', fontSize: '0.95rem' }}>Bulk add cases</strong>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: '#8b949e' }}>
          Separate blocks with a blank line. Each starts with a TC number
          (<code>TC-014: title</code>), followed by optional <code>Steps:</code>,{' '}
          <code>Expected:</code> and <code>Area:</code> sections.
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={10}
          style={{ ...input, resize: 'vertical', minHeight: 160, lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <button onClick={handleAddCases} disabled={adding || !paste.trim()} style={primaryBtn(adding)}>
            {adding ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
            Add cases
          </button>
          {addSummary && <span style={{ fontSize: '0.8rem', color: '#3fb950' }}>{addSummary}</span>}
        </div>
      </div>

      {/* Case list */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <strong style={{ color: '#f0f6fc', fontSize: '0.95rem' }}>Existing cases ({cases.length})</strong>
        </div>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem', color: '#8b949e' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : cases.length === 0 ? (
          <p style={{ color: '#8b949e', fontSize: '0.85rem', margin: 0 }}>No test cases yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cases.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  background: '#0d1117',
                  border: '1px solid #21262d',
                  borderRadius: 6,
                }}
              >
                <span style={{ fontFamily: 'ui-monospace, monospace', color: '#58a6ff', fontSize: '0.8rem', minWidth: 64 }}>
                  {c.tc_number}
                </span>
                <span style={{ flex: 1, fontSize: '0.85rem', color: '#c9d1d9' }}>{c.title || '(untitled)'}</span>
                {c.area && (
                  <span style={{ fontSize: '0.7rem', color: '#8b949e', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px' }}>
                    {c.area}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create cycle */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Layers size={16} color="#58a6ff" />
          <strong style={{ color: '#f0f6fc', fontSize: '0.95rem' }}>New cycle</strong>
        </div>
        <input
          value={cycleName}
          onChange={(e) => setCycleName(e.target.value)}
          placeholder="Cycle name (e.g. Pre-release smoke)"
          style={{ ...input, fontFamily: 'inherit', marginBottom: 10 }}
        />
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #21262d', borderRadius: 6, padding: 6, marginBottom: 10 }}>
          {cases.length === 0 ? (
            <p style={{ color: '#8b949e', fontSize: '0.8rem', margin: 6 }}>Add cases first.</p>
          ) : (
            cases.map((c) => (
              <label
                key={c.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: '0.83rem', cursor: 'pointer' }}
              >
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleCase(c.id)} />
                <span style={{ fontFamily: 'ui-monospace, monospace', color: '#58a6ff', fontSize: '0.78rem' }}>{c.tc_number}</span>
                <span style={{ color: '#c9d1d9' }}>{c.title || '(untitled)'}</span>
              </label>
            ))
          )}
        </div>
        <button onClick={handleCreateCycle} disabled={creating || !cycleName.trim()} style={primaryBtn(creating)}>
          {creating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
          Create cycle ({selected.size} selected)
        </button>
      </div>

      {/* Cycle list */}
      <div style={card}>
        <strong style={{ color: '#f0f6fc', fontSize: '0.95rem' }}>Cycles ({cycles.length})</strong>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {cycles.length === 0 ? (
            <p style={{ color: '#8b949e', fontSize: '0.85rem', margin: 0 }}>No cycles yet.</p>
          ) : (
            cycles.map((cy) => (
              <div
                key={cy.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 10px',
                  background: '#0d1117',
                  border: '1px solid #21262d',
                  borderRadius: 6,
                }}
              >
                <span style={{ fontSize: '0.85rem', color: '#c9d1d9' }}>
                  {cy.name}
                  {!cy.active && <span style={{ color: '#8b949e', fontSize: '0.75rem' }}> · inactive</span>}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>{cy.case_count ?? 0} cases</span>
                  <a
                    href={`/test/${cy.id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: '0.78rem', color: '#58a6ff' }}
                  >
                    Open runner ↗
                  </a>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
