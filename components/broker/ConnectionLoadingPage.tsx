// ─── ConnectionLoadingPage ──────────────────────────────────
// Shown when AppState = 'connection-loading' (connection_status
// = 'pending' or 'syncing'). Also rendered inside /welcome for
// the broker path.
//
// Polls /api/connections/status every 5s. Will not auto-advance
// until Phase 5/6 when real broker connections ship. Page is
// fully built now so routing is ready.

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import type { UserProfile } from '@/lib/app-state';

// ── Broker name map ─────────────────────────────────────────

const BROKER_LABELS: Record<string, string> = {
  snaptrade: 'Snaptrade',
  alpaca: 'Alpaca',
  tastytrade: 'Tastytrade',
};

// ── Spinning ring graphic ───────────────────────────────────

function SpinningRing() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      {/* Background ring (subtle) */}
      <circle
        cx="32"
        cy="32"
        r="24"
        fill="none"
        stroke="rgba(34,211,238,0.10)"
        strokeWidth="3"
      />
      {/* Spinning arc */}
      <circle
        cx="32"
        cy="32"
        r="24"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeDasharray="38 113"
        strokeLinecap="round"
        style={{
          animation: 'connectionRingSpin 1.4s linear infinite',
          transformOrigin: '32px 32px',
        }}
      />
      {/* Center dot */}
      <circle cx="32" cy="32" r="5" fill="var(--accent)" opacity="0.8" />
    </svg>
  );
}

// ── Props ───────────────────────────────────────────────────

interface ConnectionLoadingPageProps {
  /** Broker type — primary API (prompt-8 pattern) */
  connectionType?: 'snaptrade' | 'alpaca' | 'tastytrade' | null;
  /** Legacy: UserProfile (app/page.tsx consumer) */
  profile?: UserProfile | null;
  /** Callback when polling detects status=connected */
  onStateChanged?: () => void;
  /** Callback for retry button — routes to connection-options */
  onRetry?: () => void;
}

// ── Component ──────────────────────────────────────────────

export default function ConnectionLoadingPage({
  connectionType,
  profile,
  onStateChanged,
  onRetry,
}: ConnectionLoadingPageProps) {
  // Derive broker from connectionType or profile
  const resolvedType =
    connectionType ?? (profile?.connection_type as string | null) ?? null;

  const brokerName = BROKER_LABELS[resolvedType ?? ''] ?? 'your broker';

  const [status, setLocalStatus] = useState<string | null>(
    profile?.connection_status ?? 'pending',
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── Polling ──────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    // Don't poll if already connected or failed
    if (status === 'connected' || status === 'failed') return;

    const poll = async () => {
      try {
        const res = await fetch('/api/connections/status', {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        const newStatus = data.connection_status as string | null;

        if (!mountedRef.current) return;

        if (newStatus === 'connected') {
          onStateChanged?.();
        } else if (newStatus === 'failed') {
          setLocalStatus('failed');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Network hiccup — silently retry next interval
      }
    };

    // Initial poll after 2s, then every 5s
    const initial = setTimeout(poll, 2000);
    pollRef.current = setInterval(poll, 5000);

    return () => {
      mountedRef.current = false;
      clearTimeout(initial);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status, onStateChanged]);

  // ── Retry ────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    } else {
      // Fallback: reload to connection-options state
      window.location.href = '/?state=connection-options';
    }
  }, [onRetry]);

  // ── Derived ──────────────────────────────────────────────

  const isFailed = status === 'failed';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: '#fff',
        fontFamily: 'var(--font-sans)',
        alignItems: 'center',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60px',
        }}
      >
        <VantageOrb size={44} animate />
      </div>

      {/* ═══ CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          gap: '24px',
        }}
      >
        {/* Animated graphic */}
        <SpinningRing />

        {/* Headline */}
        <h2 style={{ margin: 0, textAlign: 'center', lineHeight: 1.15 }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '34px',
              fontWeight: 800,
              color: '#ffffff',
            }}
          >
            Connecting your
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '34px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: isFailed ? 'var(--loss)' : 'var(--accent)',
            }}
          >
            {brokerName}
          </span>
        </h2>

        {/* Subtext or error */}
        <p
          style={{
            fontSize: '15px',
            fontWeight: 400,
            color: isFailed
              ? 'var(--loss)'
              : 'rgba(255,255,255,0.60)',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.5,
            maxWidth: '300px',
          }}
        >
          {isFailed
            ? 'Connection failed. Please try again.'
            : 'Syncing your portfolio…\nThis may take a few moments.'}
        </p>

        {/* Retry button (only on failure) */}
        {isFailed && (
          <button
            onClick={handleRetry}
            style={{
              width: '100%',
              maxWidth: '300px',
              height: '48px',
              borderRadius: '999px',
              border: 'none',
              background: 'var(--accent)',
              color: '#000',
              fontSize: '16px',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              marginTop: '4px',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Try again
          </button>
        )}
      </div>

      {/* Spin keyframes */}
      <style>{`
        @keyframes connectionRingSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Named export for existing consumers
export { ConnectionLoadingPage };
