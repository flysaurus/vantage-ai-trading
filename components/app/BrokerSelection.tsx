'use client';

// ─── Broker Selection / Demo Activation Screen ──────────────
// Three-screen flow with smooth slide transitions:
//   Screen 1: Celebration  — "YOU'RE IN." + features + CTA
//   Screen 2: Connect      — "Your demo is ready." + two buttons
//   Screen 3: Splash       — Orb pulsing countdown → app
//
// Bold visual language matching the onboarding flow.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { LoadingSplash } from '@/components/app/LoadingSplash';

// ── Types ───────────────────────────────────────────────────

type Screen = 'celebration' | 'connect' | 'splash';

// ── Shared gradient ─────────────────────────────────────────

const GRADIENT = `
  radial-gradient(ellipse 200% 70% at 50% -10%, rgba(34,211,238,0.50) 0%, rgba(14,116,144,0.30) 35%, transparent 65%),
  radial-gradient(ellipse 100% 60% at 85% 100%, rgba(99,102,241,0.20) 0%, transparent 70%),
  #0a0f1e
`;

// ── Transition config ───────────────────────────────────────

const TRANSITION = '0.5s cubic-bezier(0.16, 1, 0.3, 1)';

// ── Component ───────────────────────────────────────────────

export function BrokerSelection() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('celebration');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoStarted, setDemoStarted] = useState(false);

  // ── Screen 1: Start demo → API call → slide to screen 2 ──

  const handleStartDemo = async () => {
    setLoading(true);
    setError('');

    try {
      if (typeof window !== 'undefined') {
        try { localStorage.removeItem('vantage_demo_state_v3'); } catch {}
      }

      const res = await fetch('/api/demo/start', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to start demo. Try again.');
        setLoading(false);
        return;
      }

      setDemoStarted(true);
      setLoading(false);
      setScreen('connect');
    } catch {
      setError('Network error. Check your connection.');
      setLoading(false);
    }
  };

  // ── Screen 2: Start demo → splash / Connect broker → toast

  const handleDemoNow = () => {
    // Demo already started in Screen 1 — just go to splash
    setScreen('splash');
  };

  const handleConnectBroker = () => {
    // Placeholder — broker connections coming soon
    alert('Broker connections coming soon. You can connect from Settings later.');
  };

  // ── Screen 3: Splash complete → app ──────────────────────

  const handleSplashComplete = () => {
    router.push('/');
    router.refresh();
  };

  // ── Screen transforms ────────────────────────────────────

  const transformFor = (s: Screen): string => {
    if (s === screen) return 'translateY(0)';
    // Screens after current: slide in from below
    // Screens before current: slide out upward
    if (s === 'connect' && screen === 'celebration') return 'translateY(100%)';
    if (s === 'splash' && screen === 'celebration') return 'translateY(200%)';
    if (s === 'splash' && screen === 'connect') return 'translateY(100%)';
    // Screens before current: slide up
    if (s === 'celebration' && screen === 'connect') return 'translateY(-100%)';
    if (s === 'celebration' && screen === 'splash') return 'translateY(-200%)';
    if (s === 'connect' && screen === 'splash') return 'translateY(-100%)';
    return 'translateY(0)';
  };

  const isActive = (s: Screen) => s === screen;

  // ══════════════════════════════════════════════════════════
  //  SCREEN 1 — Celebration
  // ══════════════════════════════════════════════════════════
  const celebrationContent = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: transformFor('celebration'),
        opacity: isActive('celebration') ? 1 : 0,
        transition: `transform ${TRANSITION}, opacity 0.35s ease`,
        pointerEvents: isActive('celebration') ? 'auto' : 'none',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* ── Orb Hero ── */}
      <div
        style={{
          marginTop: 52,
          display: 'flex',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <VantageOrb size={180} animate showEntrance />
      </div>

      {/* ── Headline ── */}
      <div style={{ marginTop: 28, textAlign: 'center', padding: '0 28px' }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 900,
            fontSize: 52,
            letterSpacing: '-0.01em',
            color: '#fff',
            lineHeight: 1,
          }}
        >
          YOU&apos;RE IN.
        </div>
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 22,
            color: 'rgba(255,255,255,0.70)',
            marginTop: 8,
          }}
        >
          Your 30-day investing sandbox is ready.
        </div>
      </div>

      {/* ── Description ── */}
      <p
        style={{
          marginTop: 16,
          textAlign: 'center',
          maxWidth: 320,
          marginLeft: 'auto',
          marginRight: 'auto',
          fontFamily: 'var(--font-sans)',
          fontWeight: 400,
          fontSize: 16,
          color: 'rgba(255,255,255,0.60)',
          lineHeight: 1.6,
          padding: '0 28px',
        }}
      >
        Real market prices. Real AI analysis. Paper trades — no real money at risk.
      </p>

      {/* ── Features ── */}
      <div
        style={{
          marginTop: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          padding: '0 28px',
        }}
      >
        {[
          '$100,000 simulated portfolio',
          'Live market data + AI advisor',
          'Strategy baskets + paper trading',
        ].map((text) => (
          <div
            key={text}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <CheckCircle size={18} color="var(--gain)" />
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 15,
                color: '#fff',
              }}
            >
              {text}
            </span>
          </div>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            margin: '16px 28px 0',
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 12,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {/* Primary CTA */}
      <div style={{ padding: '0 28px', marginTop: 28, marginBottom: 128 }}>
        <button
          onClick={handleStartDemo}
          disabled={loading}
          style={{
            height: 58,
            width: '100%',
            background: '#fff',
            color: '#000',
            fontFamily: 'var(--font-sans)',
            fontWeight: 700,
            fontSize: 17,
            border: 'none',
            borderRadius: 999,
            cursor: loading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: loading ? 0.8 : 1,
          }}
        >
          {loading ? (
            <>
              <Loader2
                size={20}
                style={{ animation: 'spin 0.8s linear infinite' }}
              />
              Starting demo…
            </>
          ) : (
            'Start my 30-day demo →'
          )}
        </button>

        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 400,
            fontSize: 13,
            color: 'rgba(255,255,255,0.35)',
            textAlign: 'center',
            marginTop: 10,
          }}
        >
          No credit card required.
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  //  SCREEN 2 — Connect your portfolio
  // ══════════════════════════════════════════════════════════
  const connectContent = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: transformFor('connect'),
        opacity: isActive('connect') ? 1 : 0,
        transition: `transform ${TRANSITION}, opacity 0.35s ease`,
        pointerEvents: isActive('connect') ? 'auto' : 'none',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* ── Orb Hero ── */}
      <div
        style={{
          marginTop: 68,
          display: 'flex',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <VantageOrb size={140} animate showEntrance={false} />
      </div>

      {/* ── Headline ── */}
      <div style={{ marginTop: 36, textAlign: 'center', padding: '0 28px' }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 800,
            fontSize: 38,
            letterSpacing: '-0.01em',
            color: '#fff',
            lineHeight: 1.1,
          }}
        >
          Your demo is ready.
        </div>
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 22,
            color: 'rgba(255,255,255,0.70)',
            marginTop: 12,
            lineHeight: 1.4,
          }}
        >
          Want to bring your real portfolio too?
        </div>
      </div>

      {/* ── Buttons ── */}
      <div
        style={{
          marginTop: 48,
          padding: '0 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Primary: Start with demo */}
        <button
          onClick={handleDemoNow}
          style={{
            height: 58,
            width: '100%',
            background: '#fff',
            color: '#000',
            fontFamily: 'var(--font-sans)',
            fontWeight: 700,
            fontSize: 17,
            border: 'none',
            borderRadius: 999,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          Start with demo for now, connect later →
        </button>

        {/* Secondary: Connect a broker */}
        <button
          onClick={handleConnectBroker}
          style={{
            height: 58,
            width: '100%',
            background: 'transparent',
            color: '#fff',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: 17,
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 999,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          Connect a broker →
        </button>

        {/* Coming soon badge */}
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--warning)',
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.35)',
              padding: '4px 12px',
              borderRadius: 999,
            }}
          >
            COMING SOON
          </span>
        </div>
      </div>

      {/* Bottom spacing */}
      <div style={{ height: 80 }} />
    </div>
  );

  // ══════════════════════════════════════════════════════════
  //  SCREEN 3 — Splash (demo countdown)
  // ══════════════════════════════════════════════════════════
  const splashContent = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: transformFor('splash'),
        opacity: isActive('splash') ? 1 : 0,
        transition: `transform ${TRANSITION}, opacity 0.35s ease`,
        pointerEvents: isActive('splash') ? 'auto' : 'none',
      }}
    >
      <LoadingSplash
        mode="demo"
        daysRemaining={30}
        onComplete={handleSplashComplete}
      />
    </div>
  );

  // ══════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <div
      style={{
        height: '100dvh',
        background: GRADIENT,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {celebrationContent}
      {connectContent}
      {splashContent}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
