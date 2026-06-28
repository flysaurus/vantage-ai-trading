// ─── BrokerChoicePage ─────────────────────────────────────
// CLEAR TWO-CHOICE DECISION after onboarding.
// Rendered when state = 'broker-selection' (no demo, no broker).
//
// Two frosted glass cards:
//   1. Demo — $100k paper portfolio → POST /api/demo/start
//   2. Connect Broker — sync real portfolio → connection-options
//
// No back button. This is the final decision.

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { VantageOrb } from '@/components/brand/VantageOrb';

// ── Spinner sub-component ─────────────────────────────────

function Spinner() {
  return (
    <div
      style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: '2.5px solid rgba(255,255,255,0.15)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.6s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

// ── Main ──────────────────────────────────────────────────

export function BrokerChoicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState<'demo' | 'connect' | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  // ── Demo start ──────────────────────────────────────────

  const handleDemoStart = useCallback(async () => {
    setLoading('demo');
    setDemoError(null);

    try {
      const res = await fetch('/api/demo/start', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setDemoError(data.error || 'Failed to start demo. Try again.');
        setLoading(null);
        return;
      }

      // Hard navigation forces full remount → useAppState re-evaluates
      // from fresh DB data (router.refresh preserves React state, stale).
      window.location.href = '/';
    } catch {
      setDemoError('Network error. Check your connection.');
      setLoading(null);
    }
  }, [router]);

  // ── Connect broker ──────────────────────────────────────

  const handleConnectBroker = useCallback(() => {
    // TODO: When connection infrastructure is ready,
    // call /api/connections/start with connection_type,
    // then router.refresh() to trigger 'connection-options' state
    router.push('/');
  }, [router]);

  const demoLoading = loading === 'demo';
  const connectLoading = loading === 'connect';

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(ellipse 120% 60% at 50% -10%, rgba(34,211,238,0.18), transparent 55%), var(--bg-primary)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
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

      {/* ═══ HEADLINE ═══ */}
      <div style={{ padding: '0 24px', flexShrink: 0 }}>
        <h2 style={{ margin: 0, textAlign: 'center' }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '34px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.15,
            }}
          >
            How do you want
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '34px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-primary)',
              lineHeight: 1.15,
            }}
          >
            to get started?
          </span>
        </h2>

        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.60)',
            textAlign: 'center',
            margin: '12px 0 0',
            lineHeight: 1.5,
          }}
        >
          Start with a $100k demo portfolio,
          <br />
          or connect your real broker.
        </p>
      </div>

      {/* ═══ CARDS ═══ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '28px 24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          scrollbarWidth: 'none',
        }}
        className="hide-scrollbar"
      >
        {/* ── Card 1: Demo ── */}
        <button
          onClick={demoLoading ? undefined : handleDemoStart}
          disabled={demoLoading}
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '28px 24px',
            background: demoLoading
              ? 'rgba(255,255,255,0.03)'
              : 'rgba(255,255,255,0.05)',
            border: demoLoading
              ? '1px solid rgba(255,255,255,0.04)'
              : '1px solid var(--border-card)',
            borderRadius: '20px',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            cursor: demoLoading ? 'default' : 'pointer',
            transition: 'all 200ms var(--ease-out)',
            WebkitTapHighlightColor: 'transparent',
            fontFamily: 'var(--font-sans)',
            color: 'var(--text-primary)',
            gap: 0,
            opacity: connectLoading ? 0.5 : 1,
            pointerEvents: connectLoading ? 'none' : 'auto',
          }}
          onTouchStart={
            demoLoading
              ? undefined
              : (e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
                }
          }
          onTouchEnd={
            demoLoading
              ? undefined
              : (e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                }
          }
        >
          {/* Icon */}
          {demoLoading ? (
            <div style={{ marginBottom: '12px' }}>
              <Spinner />
            </div>
          ) : (
            <span
              style={{
                fontSize: '32px',
                marginBottom: '12px',
                lineHeight: 1,
                display: 'block',
              }}
            >
              🎮
            </span>
          )}

          {/* Title */}
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '19px',
              fontWeight: 700,
              color: demoLoading
                ? 'rgba(255,255,255,0.40)'
                : 'var(--text-primary)',
              lineHeight: 1.3,
            }}
          >
            {demoLoading ? 'Starting demo…' : 'Start with demo'}
          </span>

          {/* Subtitle */}
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              fontWeight: 400,
              color: 'rgba(255,255,255,0.60)',
              marginTop: '4px',
              lineHeight: 1.4,
            }}
          >
            $100,000 paper portfolio · Free · 30 days
          </span>

          {/* Inline error */}
          {demoError && (
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--loss)',
                marginTop: '10px',
                lineHeight: 1.3,
              }}
            >
              {demoError}
            </span>
          )}
        </button>

        {/* ── Card 2: Connect Broker ── */}
        <button
          onClick={connectLoading ? undefined : handleConnectBroker}
          disabled={connectLoading}
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '28px 24px',
            background: connectLoading
              ? 'rgba(255,255,255,0.03)'
              : 'rgba(255,255,255,0.05)',
            border: connectLoading
              ? '1px solid rgba(255,255,255,0.04)'
              : '1px solid var(--border-card)',
            borderRadius: '20px',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            cursor: connectLoading ? 'default' : 'pointer',
            transition: 'all 200ms var(--ease-out)',
            WebkitTapHighlightColor: 'transparent',
            fontFamily: 'var(--font-sans)',
            color: 'var(--text-primary)',
            gap: 0,
            opacity: demoLoading ? 0.5 : 1,
            pointerEvents: demoLoading ? 'none' : 'auto',
          }}
          onTouchStart={
            connectLoading
              ? undefined
              : (e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
                }
          }
          onTouchEnd={
            connectLoading
              ? undefined
              : (e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                }
          }
        >
          {/* Icon */}
          {connectLoading ? (
            <div style={{ marginBottom: '12px' }}>
              <Spinner />
            </div>
          ) : (
            <span
              style={{
                fontSize: '32px',
                marginBottom: '12px',
                lineHeight: 1,
                display: 'block',
              }}
            >
              🔗
            </span>
          )}

          {/* Title */}
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '19px',
              fontWeight: 700,
              color: connectLoading
                ? 'rgba(255,255,255,0.40)'
                : 'var(--text-primary)',
              lineHeight: 1.3,
            }}
          >
            Connect your broker
          </span>

          {/* Subtitle */}
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              fontWeight: 400,
              color: 'rgba(255,255,255,0.60)',
              marginTop: '4px',
              lineHeight: 1.4,
            }}
          >
            Sync your real portfolio · Requires upgrade
          </span>
        </button>
      </div>

      {/* ═══ BOTTOM NOTE ═══ */}
      <div
        style={{
          flexShrink: 0,
          padding: '0 24px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.40)',
            lineHeight: 1.5,
          }}
        >
          You can always connect a broker later from Settings.
        </span>
      </div>
    </div>
  );
}
