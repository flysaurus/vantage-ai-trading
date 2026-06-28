// ─── ConnectionLoadingPage ────────────────────────────────
// Shown when connection_status = 'pending' or 'syncing'.
// AppState = 'connection-loading'.
//
// Spinning ring animation, broker name from connection_type,
// polls /api/connections/status every 5s until connected/failed.
// Error state with retry.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import type { UserProfile } from '@/lib/app-state';

// ── Broker name map ─────────────────────────────────────

const BROKER_LABELS: Record<string, string> = {
  snaptrade: 'Snaptrade',
  alpaca: 'Alpaca',
  tastytrade: 'Tastytrade',
};

// ── Spinning ring graphic ───────────────────────────────

function SpinningRing() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Background ring */}
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="rgba(34,211,238,0.12)"
        strokeWidth="3"
      />
      {/* Spinning arc */}
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeDasharray="40 123"
        strokeLinecap="round"
        style={{
          animation: 'connectionSpin 1.4s linear infinite',
          transformOrigin: '32px 32px',
        }}
      />
      {/* Center dot */}
      <circle
        cx="32"
        cy="32"
        r="5"
        fill="var(--accent)"
        opacity="0.8"
      />
    </svg>
  );
}

// ── Props ───────────────────────────────────────────────

interface ConnectionLoadingPageProps {
  profile: UserProfile | null;
}

// ── Main ────────────────────────────────────────────────

export function ConnectionLoadingPage({
  profile,
  onStateChanged,
}: ConnectionLoadingPageProps & { onStateChanged: () => void }) {
  const [status, setStatus] = useState<string | null>(
    profile?.connection_status ?? 'syncing',
  );
  const brokerName =
    BROKER_LABELS[profile?.connection_type ?? ''] ?? 'your broker';

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ──────────────────────────────────────────

  useEffect(() => {
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

        if (newStatus === 'connected') {
          // State re-evaluation → useAppState sees connected → 'authenticated'
          onStateChanged();
        } else if (newStatus === 'failed') {
          setStatus('failed');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Network hiccup — keep polling
      }
    };

    // Initial poll after 2s, then every 5s
    const initial = setTimeout(poll, 2000);
    pollRef.current = setInterval(poll, 5000);

    return () => {
      clearTimeout(initial);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status, onStateChanged]);

  // ── Retry ────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    // Full reload to reset polling state (connection status unchanged in DB)
    window.location.href = '/';
  }, []);

  // ── Render ───────────────────────────────────────────

  const isFailed = status === 'failed';

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(ellipse 120% 60% at 50% -10%, rgba(34,211,238,0.18), transparent 55%), var(--bg-primary)',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <VantageOrb size={44} animate showEntrance={false} />
      </div>

      {/* ═══ CENTERED CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 32px',
          gap: '28px',
        }}
      >
        {/* Animated graphic */}
        <SpinningRing />

        {/* Headline */}
        <h2 style={{ margin: 0, textAlign: 'center' }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '34px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
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
              lineHeight: 1.2,
            }}
          >
            {brokerName}
          </span>
        </h2>

        {/* Subtext */}
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            fontWeight: 400,
            color: isFailed
              ? 'var(--loss)'
              : 'rgba(255,255,255,0.60)',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.5,
            maxWidth: '280px',
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
              maxWidth: '280px',
              height: '48px',
              borderRadius: 'var(--radius-pill)',
              border: 'none',
              background: 'var(--accent)',
              color: '#000000',
              fontSize: '16px',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              marginTop: '8px',
              WebkitTapHighlightColor: 'transparent',
            }}
            onTouchStart={(e) => {
              (e.currentTarget as HTMLElement).style.transform =
                'scale(0.98)';
            }}
            onTouchEnd={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            }}
          >
            Try again
          </button>
        )}
      </div>

      {/* Keyframes injected inline */}
      <style>{`
        @keyframes connectionSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
