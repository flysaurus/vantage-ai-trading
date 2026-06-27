'use client';

// ─── Broker Selection — Parent Container ───────────────────
// Manages two screens with horizontal slide transitions:
//   Screen 1: Celebration — "YOU'RE IN." + features + CTA
//   Screen 2: BrokerConnect — broker cards + skip → demo
//
// Transitions use CSS inline styles with translateX for smooth
// horizontal slides. Screen 1 exits left (-30%), Screen 2
// enters from right (100% → 0).

import React, { useState } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { BrokerConnect } from '@/components/app/BrokerConnect';

// ── Types ───────────────────────────────────────────────────

type Screen = 'celebration' | 'connect';

// ── Shared gradient ─────────────────────────────────────────

const GRADIENT = `
  radial-gradient(ellipse 200% 70% at 50% -10%, rgba(34,211,238,0.50) 0%, rgba(14,116,144,0.30) 35%, transparent 65%),
  radial-gradient(ellipse 100% 60% at 85% 100%, rgba(99,102,241,0.20) 0%, transparent 70%),
  #0a0f1e
`;

// ── Component ───────────────────────────────────────────────

export function BrokerSelection() {
  const [screen, setScreen] = useState<Screen>('celebration');
  const [loading, setLoading] = useState(false);

  // ── Forward: celebration → connect ───────────────────────

  const handleStartDemo = () => {
    setLoading(true);
    setTimeout(() => {
      setScreen('connect');
      setLoading(false);
    }, 150);
  };

  // ── Back: connect → celebration ──────────────────────────

  const handleBack = () => {
    setScreen('celebration');
  };

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
      {/* ═══ SCREEN 1 — Celebration ═══ */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: screen === 'celebration' ? 'translateX(0)' : 'translateX(-30%)',
          opacity: screen === 'celebration' ? 1 : 0,
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-in',
          pointerEvents: screen === 'celebration' ? 'auto' : 'none',
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

        {/* Primary CTA — no API call, just slide to Screen 2 */}
        <div style={{ padding: '0 28px', marginTop: 28 }}>
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
                <Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite' }} />
                Loading…
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

      {/* ═══ SCREEN 2 — Broker Connect ═══ */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: screen === 'connect' ? 'translateX(0)' : 'translateX(100%)',
          opacity: screen === 'connect' ? 1 : 0,
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-out',
          pointerEvents: screen === 'connect' ? 'auto' : 'none',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <BrokerConnect onBack={handleBack} />
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
