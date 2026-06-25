// ─── ArrivalScreen ──────────────────────────────────────────
// Full redesign: bg-onboarding-0 gradient, two-line centered
// headline, typewriter cycling lines, white pill CTA.
//
// Layout:
//   TOP RIGHT:  "I have an account ›" → /login
//   CENTER:     VantageMark constellation (40px) + headline + cycling lines
//   BOTTOM:     white pill "Find my style" + subtext

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { VantageMark } from '@/components/brand/VantageMark';
import { useTypewriter } from '@/lib/animations/typewriter';

const SUPPORT_LINES = [
  'Buffett waits decades.',
  'Livermore reads the tape.',
  'Soros bets against the world.',
];
const CLOSING_LINE = "Let's find yours.";

interface ArrivalScreenProps {
  onFindStyle: () => void;
  onSignIn: () => void;
}

export function ArrivalScreen({ onFindStyle, onSignIn }: ArrivalScreenProps) {
  const [phase, setPhase] = useState<'support' | 'closing' | 'cta'>('support');
  const [supportIndex, setSupportIndex] = useState(0);
  const [showCta, setShowCta] = useState(false);
  const [showClosing, setShowClosing] = useState(false);

  const { displayText: supportText, isDone: supportTyped } = useTypewriter(
    SUPPORT_LINES[supportIndex],
    30,
    0,
  );

  // Support line typed → next or closing
  useEffect(() => {
    if (!supportTyped || phase !== 'support') return;
    const t = setTimeout(() => {
      if (supportIndex < SUPPORT_LINES.length - 1) {
        setSupportIndex((prev) => prev + 1);
      } else {
        setPhase('closing');
        // Closing line fades in (not typed per spec)
        setTimeout(() => setShowClosing(true), 400);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [supportTyped, phase, supportIndex]);

  // Closing shown → show CTA
  useEffect(() => {
    if (!showClosing) return;
    const t = setTimeout(() => {
      setPhase('cta');
      setTimeout(() => setShowCta(true), 400);
    }, 800);
    return () => clearTimeout(t);
  }, [showClosing]);

  return (
    <div
      className="bg-onboarding-0"
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 'max(24px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* ── TOP RIGHT: Sign-in link ── */}
      <button
        onClick={onSignIn}
        style={{
          position: 'absolute',
          top: 'max(56px, env(safe-area-inset-top, 56px))',
          right: '24px',
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.50)',
          fontSize: '13px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          padding: '8px',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        I have an account
        <ChevronRight size={13} />
      </button>

      {/* ── CENTER: Mark + headline ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
          marginTop: '-40px',
        }}
      >
        {/* VantageMark constellation */}
        <div style={{ marginBottom: '40px' }}>
          <VantageMark size={40} />
        </div>

        {/* Two-line headline (centered) */}
        <h1
          style={{
            textAlign: 'center',
            marginBottom: '32px',
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '42px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            Every investor has
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '42px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            a style.
          </span>
        </h1>

        {/* Cycling lines + closing — fixed height container */}
        <div style={{ height: '48px', display: 'flex', alignItems: 'center' }}>
          {(phase === 'support') && (
            <p
              style={{
                fontSize: '14px',
                color: 'rgba(255,255,255,0.55)',
                textAlign: 'center',
                margin: 0,
              }}
            >
              {supportText}
            </p>
          )}

          {(phase === 'closing' || phase === 'cta') && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '24px',
                fontWeight: 800,
                color: 'var(--text-primary)',
                textAlign: 'center',
                margin: 0,
                opacity: showClosing ? 1 : 0,
                transition: 'opacity 400ms var(--ease-out)',
              }}
            >
              {CLOSING_LINE}
            </p>
          )}
        </div>
      </div>

      {/* ── BOTTOM: CTA + subtext ── */}
      <div
        style={{
          width: '100%',
          padding: '0 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <button
          onClick={onFindStyle}
          disabled={!showCta}
          style={{
            width: '100%',
            maxWidth: '360px',
            height: '56px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: showCta ? '#ffffff' : 'rgba(255,255,255,0.20)',
            color: showCta ? '#000000' : 'rgba(0,0,0,0.40)',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: showCta ? 'pointer' : 'default',
            pointerEvents: showCta ? 'auto' : 'none',
            opacity: showCta ? 1 : 0,
            transition: 'opacity 400ms var(--ease-out), background 200ms var(--ease-out)',
          }}
        >
          Find my style
        </button>

        <p
          style={{
            marginTop: '16px',
            fontSize: '13px',
            color: 'rgba(255,255,255,0.40)',
            textAlign: 'center',
          }}
        >
          Takes 2 minutes. No account needed to take the quiz.
        </p>
      </div>
    </div>
  );
}
