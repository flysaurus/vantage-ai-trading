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
              🐛 Debug Log ({entries.length})
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
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

          {/* Log entries */}
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
            {entries.length === 0 ? (
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
