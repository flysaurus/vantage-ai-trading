// ─── DemoCounterPage ──────────────────────────────────────
// Shows on EVERY login for demo users (demo_start_at set, not expired).
// AppState = 'demo-counter'.
//
// Displays days remaining, upgrade prompt, and enter-app CTA.
// Dismissible — tapping "Enter Vantage" calls onEnter which
// tells the routing layer to show MainApp.

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { VantageOrb } from '@/components/brand/VantageOrb';
import type { UserProfile } from '@/lib/app-state';

// ── Spinner ─────────────────────────────────────────────

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
      }}
    />
  );
}

// ── Props ──────────────────────────────────────────────

interface DemoCounterPageProps {
  profile: UserProfile | null;
  onEnter: () => void;
}

// ── Main ───────────────────────────────────────────────

export function DemoCounterPage({ profile, onEnter }: DemoCounterPageProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // ── Days remaining (robust: total minus elapsed) ─────

  const daysLeft = useMemo(() => {
    if (!profile?.demo_start_at || !profile?.demo_expires_at) return null;
    const now = Date.now();
    const start = new Date(profile.demo_start_at).getTime();
    const totalDays = 30;
    const elapsedMs = now - start;
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    const remaining = Math.max(0, Math.ceil(totalDays - elapsedDays));
    return remaining;
  }, [profile?.demo_start_at, profile?.demo_expires_at]);

  // ── Error handling ────────────────────────────────────

  useEffect(() => {
    if (!profile) {
      // Profile not loaded yet — give it a moment
      const timer = setTimeout(() => {
        if (!retrying) {
          setRetrying(true);
          // Force re-render by triggering state change
          setError(null);
        } else {
          setError('Something went wrong. Please refresh.');
        }
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setError(null);
      setRetrying(false);
    }
  }, [profile, retrying]);

  // ── Connect broker ────────────────────────────────────

  const handleConnectBroker = useCallback(() => {
    // TODO: When connection API is ready, call /api/connections/start
    // then router.refresh() to trigger 'connection-options' state
    router.push('/');
  }, [router]);

  // ── Loading state ─────────────────────────────────────

  if (!profile && !error) {
    return (
      <div
        style={{
          width: '100%',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(ellipse 120% 60% at 50% -10%, rgba(34,211,238,0.18), transparent 55%), var(--bg-primary)',
          gap: '16px',
        }}
      >
        <VantageOrb size={56} animate showEntrance />
        <Spinner />
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            color: 'rgba(255,255,255,0.50)',
          }}
        >
          Loading your demo…
        </span>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────

  if (error) {
    return (
      <div
        style={{
          width: '100%',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(ellipse 120% 60% at 50% -10%, rgba(34,211,238,0.18), transparent 55%), var(--bg-primary)',
          padding: '0 24px',
          gap: '16px',
        }}
      >
        <VantageOrb size={56} animate showEntrance={false} />
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '16px',
            fontWeight: 500,
            color: 'var(--loss)',
            textAlign: 'center',
          }}
        >
          {error}
        </span>
      </div>
    );
  }

  // ── Days label ────────────────────────────────────────

  const daysLabel =
    daysLeft === null
      ? '…'
      : daysLeft === 1
        ? '1 day'
        : `${daysLeft} days`;

  // ── Render ────────────────────────────────────────────

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
      <div
        style={{
          padding: '40px 24px 0',
          flexShrink: 0,
          textAlign: 'center',
        }}
      >
        <h2 style={{ margin: 0 }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '48px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            You have {daysLabel}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '48px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--accent)',
              lineHeight: 1.1,
            }}
          >
            left in demo.
          </span>
        </h2>

        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.60)',
            textAlign: 'center',
            margin: '14px 0 0',
            lineHeight: 1.5,
          }}
        >
          You&rsquo;re trading with $100,000 of virtual money.
        </p>
      </div>

      {/* ═══ CONTENT AREA ═══ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '32px 24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          scrollbarWidth: 'none',
        }}
        className="hide-scrollbar"
      >
        {/* ── Upgrade frosted card ── */}
        <div
          style={{
            width: '100%',
            padding: '24px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--border-card)',
            borderRadius: '20px',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '17px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.3,
            }}
          >
            Want to use real money?
          </span>

          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              fontWeight: 400,
              color: 'rgba(255,255,255,0.60)',
              lineHeight: 1.5,
            }}
          >
            Connect your broker to get AI analysis of your actual
            portfolio.
          </span>

          <button
            onClick={handleConnectBroker}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: 'var(--radius-pill)',
              border: 'none',
              background: 'var(--accent)',
              color: '#000000',
              fontSize: '16px',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              marginTop: '4px',
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
            Connect a broker →
          </button>
        </div>

        {/* ── Settings note ── */}
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.40)',
            textAlign: 'center',
            lineHeight: 1.4,
            paddingBottom: '8px',
          }}
        >
          You can also do this anytime from Settings.
        </span>
      </div>

      {/* ═══ ENTER APP BUTTON ═══ */}
      <div
        style={{
          flexShrink: 0,
          padding: '16px 24px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <button
          onClick={onEnter}
          style={{
            width: '100%',
            height: '56px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: '#ffffff',
            color: '#000000',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
          onTouchStart={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
          }}
          onTouchEnd={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
          }}
        >
          Enter Vantage →
        </button>
      </div>
    </div>
  );
}
