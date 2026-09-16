'use client';

// ─── Public Test Runner (client) ──────────────────────────────
// One case at a time, big thumbs for Pass/Fail, optional notes and a
// camera screenshot. The tester's name is remembered in sessionStorage so
// it's typed once. Mobile-first, dark-mode safe, no UI library.

import React, { useEffect, useMemo, useRef, useState } from 'react';

const TESTER_KEY = 'vantage:test-runner:tester';

interface CaseItem {
  id: string;
  tc_number: string;
  title: string;
  steps: string | null;
  expected_result: string | null;
  area: string | null;
}

interface RecordedResult {
  result: 'pass' | 'fail';
  tester_name: string | null;
  notes: string | null;
  screenshot_url: string | null;
  created_at: string;
}

interface GitHubOutcome {
  ok: boolean;
  action?: string;
  issueNumber?: number;
  issueUrl?: string;
  reason?: string;
  skipped?: boolean;
}

export function TestRunner({ cycleId }: { cycleId: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cycleName, setCycleName] = useState('');
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [results, setResults] = useState<Record<string, RecordedResult>>({});

  const [index, setIndex] = useState(0);
  const [screen, setScreen] = useState<'run' | 'summary'>('run');

  const [testerName, setTesterName] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  const [lastGithub, setLastGithub] = useState<GitHubOutcome | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load the cycle ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/test-runner/cycle/${cycleId}`);
        const data = await res.json();
        if (!alive) return;
        if (res.status === 404) {
          setStatus('notfound');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          setErrorMsg(data.error || 'Failed to load cycle');
          return;
        }
        setCycleName(data.cycle?.name || 'Test cycle');
        setCases(data.cases || []);
        setResults(data.results || {});
        setStatus('ready');
      } catch (e: any) {
        if (alive) {
          setStatus('error');
          setErrorMsg(e.message);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [cycleId]);

  // ── Restore tester name from sessionStorage ──
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TESTER_KEY);
      if (saved) setTesterName(saved);
    } catch {
      /* sessionStorage unavailable — ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (testerName) sessionStorage.setItem(TESTER_KEY, testerName);
    } catch {
      /* ignore */
    }
  }, [testerName]);

  // Revoke the preview object URL when it changes / unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const current = cases[index];

  const tally = useMemo(() => {
    let pass = 0;
    let fail = 0;
    for (const c of cases) {
      const r = results[c.id]?.result;
      if (r === 'pass') pass++;
      else if (r === 'fail') fail++;
    }
    return { pass, fail, notRun: cases.length - pass - fail };
  }, [cases, results]);

  const pickFile = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const removeFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (result: 'pass' | 'fail') => {
    if (!current) return;
    if (!testerName.trim()) {
      setErrorMsg('Please enter your name before recording a result.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    setLastOutcome(null);
    setLastGithub(null);

    try {
      const fd = new FormData();
      fd.append('caseId', current.id);
      fd.append('cycleId', cycleId);
      fd.append('testerName', testerName.trim());
      fd.append('result', result);
      fd.append('notes', notes);
      if (file) fd.append('screenshot', file);

      const res = await fetch('/api/test-runner/run', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to record result');
        setSubmitting(false);
        return;
      }

      // Merge the fresh result locally so the UI advances immediately.
      const recorded: RecordedResult = {
        result,
        tester_name: testerName.trim(),
        notes: notes || null,
        screenshot_url: data.screenshot_url || null,
        created_at: data.run?.created_at || new Date().toISOString(),
      };
      setResults((prev) => ({ ...prev, [current.id]: recorded }));

      setLastOutcome(
        result === 'pass' ? `✓ ${current.tc_number} passed` : `✗ ${current.tc_number} failed`,
      );
      if (data.github && typeof data.github === 'object') setLastGithub(data.github);
      if (data.upload_error) setErrorMsg(`Screenshot upload failed: ${data.upload_error}`);

      // Reset per-case inputs and advance.
      setNotes('');
      removeFile();
      setSubmitting(false);

      // Brief pause so the outcome + issue link is visible, then advance.
      setTimeout(() => {
        setLastOutcome(null);
        setLastGithub(null);
        if (index + 1 >= cases.length) setScreen('summary');
        else setIndex(index + 1);
      }, 1800);
    } catch (e: any) {
      setErrorMsg(e.message);
      setSubmitting(false);
    }
  };

  const restart = () => {
    setIndex(0);
    setScreen('run');
    setNotes('');
    removeFile();
    setLastOutcome(null);
    setLastGithub(null);
  };

  // ── Loading / error shells ──
  if (status === 'loading') {
    return <Centered>Loading test cycle…</Centered>;
  }
  if (status === 'notfound') {
    return <Centered>🚫 This test cycle was not found. Check the link with whoever sent it.</Centered>;
  }
  if (status === 'error') {
    return <Centered>Something went wrong: {errorMsg}</Centered>;
  }
  if (cases.length === 0) {
    return <Centered>This cycle has no test cases yet.</Centered>;
  }

  // ── Summary ──
  if (screen === 'summary') {
    return (
      <Shell>
        <h1 style={h1}>{cycleName}</h1>
        <div style={card}>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f0f6fc', marginBottom: 12 }}>
            Done — {tally.pass} of {cases.length} passing
          </div>
          <Row label="Passed" value={tally.pass} color="#3fb950" />
          <Row label="Failed" value={tally.fail} color="#f85149" />
          <Row label="Not run" value={tally.notRun} color="#8b949e" />
          <div style={{ marginTop: 16 }}>
            <button onClick={restart} style={btnMuted}>
              ↻ Run again from the start
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const recorded = results[current.id];

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '0.8rem', color: '#8b949e' }}>{cycleName}</span>
        <span style={{ fontSize: '0.8rem', color: '#8b949e' }}>
          {index + 1} of {cases.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: '#21262d', borderRadius: 2, marginBottom: 16, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${((index + 1) / cases.length) * 100}%`,
            background: '#58a6ff',
            transition: 'width .2s',
          }}
        />
      </div>

      {/* Name */}
      <label style={lbl}>Your name</label>
      <input
        value={testerName}
        onChange={(e) => setTesterName(e.target.value)}
        placeholder="e.g. Em"
        style={{ ...input, marginBottom: 14 }}
      />

      {/* Case card */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: '#58a6ff', fontSize: '0.85rem' }}>
            {current.tc_number}
          </span>
          {current.area && (
            <span style={{ fontSize: '0.7rem', color: '#8b949e', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px' }}>
              {current.area}
            </span>
          )}
          {recorded && (
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                marginLeft: 'auto',
                color: recorded.result === 'pass' ? '#3fb950' : '#f85149',
              }}
            >
              Recorded: {recorded.result}
              {recorded.tester_name ? ` · ${recorded.tester_name}` : ''}
            </span>
          )}
        </div>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f0f6fc', margin: '8px 0 14px' }}>
          {current.title || '(untitled)'}
        </h2>

        <label style={lbl}>Steps</label>
        <div style={pre}>{current.steps || 'No steps provided.'}</div>

        <label style={{ ...lbl, marginTop: 14 }}>Expected result</label>
        <div style={pre}>{current.expected_result || 'No expected result provided.'}</div>
      </div>

      {/* Notes */}
      <label style={lbl}>Notes (optional)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="What actually happened?"
        style={{ ...input, marginBottom: 14, resize: 'vertical' }}
      />

      {/* Screenshot */}
      <label style={lbl}>Screenshot (optional)</label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => pickFile(e.target.files?.[0] || null)}
        style={{ ...input, padding: 8, marginBottom: 10 }}
      />
      {preview && (
        <div style={{ marginBottom: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="preview" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #30363d' }} />
          <div style={{ marginTop: 6 }}>
            <button onClick={removeFile} style={btnMuted}>
              Remove screenshot
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div style={{ background: 'rgba(218,54,51,0.1)', border: '1px solid #da3633', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: '0.82rem', color: '#f85149' }}>
          {errorMsg}
        </div>
      )}

      {lastOutcome && (
        <div style={{ background: 'rgba(88,166,255,0.1)', border: '1px solid #58a6ff', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: '0.85rem', color: '#c9d1d9' }}>
          <div style={{ fontWeight: 600 }}>{lastOutcome}</div>
          {lastGithub && lastGithub.ok && lastGithub.issueUrl && (
            <div style={{ marginTop: 4 }}>
              GitHub issue #{lastGithub.issueNumber}{' '}
              {lastGithub.action === 'created' ? 'created' : 'updated'} —{' '}
              <a href={lastGithub.issueUrl} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>
                open ↗
              </a>
            </div>
          )}
          {lastGithub && !lastGithub.ok && (
            <div style={{ marginTop: 4, color: '#8b949e', fontSize: '0.78rem' }}>
              GitHub not updated: {lastGithub.skipped ? 'not configured' : lastGithub.reason}
            </div>
          )}
        </div>
      )}

      {/* Pass / Fail */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={() => submit('pass')} disabled={submitting} style={{ ...btnPass, opacity: submitting ? 0.6 : 1 }}>
          ✓ Pass
        </button>
        <button onClick={() => submit('fail')} disabled={submitting} style={{ ...btnFail, opacity: submitting ? 0.6 : 1 }}>
          ✗ Fail
        </button>
      </div>

      {/* Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} style={btnMuted}>
          ← Prev
        </button>
        <button
          onClick={() => (index + 1 >= cases.length ? setScreen('summary') : setIndex(index + 1))}
          style={btnMuted}
        >
          {index + 1 >= cases.length ? 'Finish →' : 'Next →'}
        </button>
      </div>
    </Shell>
  );
}

// ─── Small presentational helpers ─────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0d1117',
        color: '#c9d1d9',
        padding: '1.25rem',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <div style={{ textAlign: 'center', padding: '3rem 0', color: '#8b949e', fontSize: '0.95rem' }}>
        {children}
      </div>
    </Shell>
  );
}

function Row({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.9rem' }}>
      <span style={{ color: '#8b949e' }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

const h1: React.CSSProperties = { fontSize: '1.3rem', fontWeight: 700, color: '#f0f6fc', margin: '0 0 14px' };
const card: React.CSSProperties = { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '16px 18px', marginBottom: 14 };
const lbl: React.CSSProperties = { display: 'block', fontSize: '0.78rem', color: '#8b949e', marginBottom: 6 };
const input: React.CSSProperties = { width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9', padding: '12px', fontSize: '0.9rem', boxSizing: 'border-box' };
const pre: React.CSSProperties = { whiteSpace: 'pre-wrap', fontSize: '0.88rem', color: '#c9d1d9', background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: '10px 12px', margin: 0 };
const btnPass: React.CSSProperties = { flex: 1, background: '#238636', border: 'none', color: '#fff', borderRadius: 10, padding: '16px', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer' };
const btnFail: React.CSSProperties = { flex: 1, background: '#da3633', border: 'none', color: '#fff', borderRadius: 10, padding: '16px', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer' };
const btnMuted: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 8, padding: '8px 14px', fontSize: '0.82rem', cursor: 'pointer' };
