'use client';

import { useState, useEffect, useRef } from 'react';
import {
  getDebugEntries,
  clearDebugLog,
  copyDebugLog,
  subscribeDebugLog,
  type DebugEntry,
} from '@/lib/debug-log';

export default function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'log' | 'errors'>('log');
  const listRef = useRef<HTMLDivElement>(null);

  // TEMPORARY: always show during diagnosis
  // if (!isDebugEnabled()) return null;

  // Subscribe to log store updates
  useEffect(() => {
    setEntries(getDebugEntries());
    const unsub = subscribeDebugLog(() => {
      setEntries([...getDebugEntries()]);
    });
    return unsub;
  }, []);

  // Load captured error logs from sessionStorage
  useEffect(() => {
    const loadErrors = () => {
      try {
        const raw = sessionStorage.getItem('vantage_error_log');
        if (raw) setErrorLogs(JSON.parse(raw));
      } catch {}
    };
    loadErrors();
    const interval = setInterval(loadErrors, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom when new entries and panel is open
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length, open]);

  const handleCopy = () => {
    copyDebugLog();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    clearDebugLog();
    setEntries([]);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          bottom: '100px',
          right: '16px',
          zIndex: 999999,
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid rgba(34, 211, 238, 0.5)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#22d3ee' }}>
          {open ? '✕' : '🐛'}
        </span>
      </button>

      {/* Slide-up panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 999998,
            height: '50vh',
            maxHeight: '50dvh',
            background: 'rgba(15, 23, 42, 0.98)',
            borderTop: '2px solid rgba(34, 211, 238, 0.3)',
            borderTopLeftRadius: '16px',
            borderTopRightRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideUpDebug 250ms ease-out',
          }}
        >
          {/* Header bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#22d3ee' }}>
              🐛 Debug
            </span>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                onClick={() => setActiveTab('log')}
                style={{
                  background: activeTab === 'log' ? 'rgba(34, 211, 238, 0.15)' : 'transparent',
                  border: activeTab === 'log' ? '1px solid rgba(34, 211, 238, 0.3)' : '1px solid transparent',
                  borderRadius: '6px',
                  color: activeTab === 'log' ? '#22d3ee' : '#64748b',
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '3px 8px',
                  cursor: 'pointer',
                }}
              >
                Log ({entries.length})
              </button>
              <button
                onClick={() => setActiveTab('errors')}
                style={{
                  background: activeTab === 'errors' ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
                  border: activeTab === 'errors' ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid transparent',
                  borderRadius: '6px',
                  color: activeTab === 'errors' ? '#f87171' : '#64748b',
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                Errors ({errorLogs.length})
                {errorLogs.length > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '-3px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#f87171',
                  }} />
                )}
              </button>
              <div style={{ display: 'flex', gap: '8px', marginLeft: '4px' }}>
                <button
                onClick={handleCopy}
                style={{
                  background: 'rgba(34, 211, 238, 0.15)',
                  border: '1px solid rgba(34, 211, 238, 0.3)',
                  borderRadius: '8px',
                  color: '#22d3ee',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                {copied ? '✓ Copied!' : 'Copy all'}
              </button>
              <button
                onClick={handleClear}
                style={{
                  background: 'rgba(248, 113, 113, 0.15)',
                  border: '1px solid rgba(248, 113, 113, 0.3)',
                  borderRadius: '8px',
                  color: '#f87171',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Content */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              padding: '8px 16px',
              fontFamily: "'SF Mono', 'Fira Code', monospace",
            }}
          >
            {activeTab === 'errors' ? (
              /* ── Errors tab ── */
              errorLogs.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', paddingTop: '40px' }}>
                  No errors captured yet.
                </div>
              ) : (
                errorLogs.map((err, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ color: '#f87171', fontSize: '10px', marginBottom: '4px' }}>
                      {new Date(err.time).toISOString().slice(11, 23)}
                      {' · '}
                      <span style={{ color: '#94a3b8' }}>{err.url?.split('/').slice(-2).join('/')}</span>
                    </div>
                    <div style={{ color: '#fca5a5', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
                      {err.message}
                    </div>
                    {err.componentStack && (
                      <details>
                        <summary style={{ color: '#64748b', fontSize: '10px', cursor: 'pointer' }}>Component Stack</summary>
                        <pre style={{ color: '#94a3b8', fontSize: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '4px', background: 'rgba(0,0,0,0.3)', padding: '6px', borderRadius: '4px' }}>
                          {err.componentStack}
                        </pre>
                      </details>
                    )}
                    {err.stack && (
                      <details>
                        <summary style={{ color: '#64748b', fontSize: '10px', cursor: 'pointer' }}>JS Stack</summary>
                        <pre style={{ color: '#94a3b8', fontSize: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '4px', background: 'rgba(0,0,0,0.3)', padding: '6px', borderRadius: '4px' }}>
                          {err.stack.slice(0, 2000)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )
            ) : (
              entries.length === 0 ? (
              <div
                style={{
                  color: '#64748b',
                  fontSize: '12px',
                  textAlign: 'center',
                  paddingTop: '40px',
                }}
              >
                No log entries yet. Run a test sequence.
              </div>
            ) : (
              entries.map((entry, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                  }}
                >
                  <span style={{ color: '#64748b', fontSize: '10px', marginRight: '8px' }}>
                    {entry.timestamp}
                  </span>
                  <span style={{ color: '#22d3ee', fontSize: '11px', fontWeight: 600, marginRight: '6px' }}>
                    {entry.label}
                  </span>
                  <span
                    style={{
                      color: '#94a3b8',
                      fontSize: '11px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {entry.value}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUpDebug {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
