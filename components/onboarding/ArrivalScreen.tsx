// ─── ArrivalScreen ──────────────────────────────────────────
// Shown after Feature Splash. Static headline + cycling
// typewriter support lines + closing line + CTA.
//
// Three-zone flex layout (full viewport):
//   TOP: CompassMark 100px, glow, idleRotate
//   MIDDLE: centered headline + typewriter lines
//   BOTTOM: CTA + subtext + sign-in link

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CompassMark } from '@/components/brand/CompassMark';
import { useTypewriter } from '@/lib/animations/typewriter';

interface ArrivalScreenProps {
  onFindStyle: () => void;
  onSignIn: () => void;
}

const HEADLINE = 'Every investor has a style.';
const SUPPORT_LINES = [
  'Buffett waits decades.',
  'Livermore reads the tape.',
  'Soros bets against the world.',
];
const CLOSING_LINE = "Let's find yours.";

const HEADLINE_HOLD = 500;
const SUPPORT_HOLD = 450;
const SUPPORT_FADE = 200;
const CLOSING_PAUSE = 500;
const CLOSING_HOLD = 400;

export function ArrivalScreen({ onFindStyle, onSignIn }: ArrivalScreenProps) {
  // headline → support → closing → cta
  const [phase, setPhase] = useState<'headline' | 'support' | 'closing' | 'cta'>('headline');
  const [supportIndex, setSupportIndex] = useState(-1);
  const [showCta, setShowCta] = useState(false);

  const { displayText: headlineText, isDone: headlineTyped } = useTypewriter(HEADLINE, 35);
  const { displayText: supportText, isDone: supportTyped } = useTypewriter(
    supportIndex >= 0 ? SUPPORT_LINES[supportIndex] : '',
    30,
    0,
  );
  const { displayText: closingText, isDone: closingTyped } = useTypewriter(
    phase === 'closing' ? CLOSING_LINE : '',
    40,
    0,
  );

  // Headline typed → hold → first support line
  useEffect(() => {
    if (!headlineTyped || phase !== 'headline') return;
    const t = setTimeout(() => {
      setPhase('support');
      setSupportIndex(0);
    }, HEADLINE_HOLD);
    return () => clearTimeout(t);
  }, [headlineTyped, phase]);

  // Support line typed → hold → next or closing
  useEffect(() => {
    if (!supportTyped || phase !== 'support') return;
    const t = setTimeout(() => {
      if (supportIndex < SUPPORT_LINES.length - 1) {
        setSupportIndex((prev) => prev + 1);
      } else {
        setPhase('closing');
      }
    }, SUPPORT_HOLD);
    return () => clearTimeout(t);
  }, [supportTyped, phase, supportIndex]);

  // Closing typed → hold → show CTA
  useEffect(() => {
    if (!closingTyped || phase !== 'closing') return;
    const t = setTimeout(() => {
      setPhase('cta');
      setTimeout(() => setShowCta(true), 400);
    }, CLOSING_HOLD);
    return () => clearTimeout(t);
  }, [closingTyped, phase]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 'max(24px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* TOP: CompassMark */}
      <div style={{ marginTop: '60px' }}>
        <CompassMark size={100} showBurst={false} glow idleRotate />
      </div>

      {/* MIDDLE: Headline + typewriter */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
        {/* Static headline */}
        <h1
          style={{
            fontSize: 'var(--text-3xl)',
            fontWeight: 700,
            color: 'var(--text-primary)',
            textAlign: 'center',
            marginBottom: phase !== 'headline' ? 'var(--space-8)' : 'var(--space-2)',
            opacity: headlineTyped ? 1 : 0.6,
            transition: 'opacity 300ms var(--ease-out)',
          }}
        >
          {headlineText}
        </h1>

        {/* Typewriter lines container — fixed height to prevent layout jump */}
        <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {(phase === 'support' || phase === 'headline') && supportIndex >= 0 && (
            <p
              style={{
                fontSize: 'var(--text-lg)',
                color: 'var(--onb-body-color, rgba(255,255,255,0.82))',
                textAlign: 'center',
                opacity: supportTyped ? 1 : 0.7,
                transition: 'opacity 200ms var(--ease-out)',
              }}
            >
              {supportText}
            </p>
          )}

          {phase === 'closing' && (
            <p
              style={{
                fontSize: 'var(--text-3xl)',
                fontWeight: 700,
                color: 'var(--text-primary)',
                textAlign: 'center',
              }}
            >
              {closingText}
            </p>
          )}
        </div>
      </div>

      {/* BOTTOM: CTA + subtext */}
      <div style={{ width: '100%', padding: '0 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* CTA button */}
        <button
          onClick={onFindStyle}
          disabled={!showCta}
          style={{
            width: '100%',
            maxWidth: '360px',
            padding: '15px 0',
            background: showCta ? 'var(--accent)' : 'transparent',
            border: showCta ? 'none' : '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-button)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: showCta ? '#000' : 'var(--text-muted)',
            cursor: showCta ? 'pointer' : 'default',
            opacity: showCta ? 1 : 0,
            transition: 'opacity 400ms var(--ease-out), background 300ms var(--ease-out), color 300ms var(--ease-out)',
            fontFamily: 'inherit',
            pointerEvents: showCta ? 'auto' : 'none',
          }}
        >
          Find my style →
        </button>

        {/* Subtext */}
        <p style={{ marginTop: 'var(--space-3)', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
          Takes 2 minutes. No account needed to take the quiz.
        </p>

        {/* Sign in link */}
        <button
          onClick={onSignIn}
          style={{
            marginTop: 'var(--space-2)',
            background: 'none',
            border: 'none',
            fontSize: '13px',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: 'var(--space-2)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Already have an account? Sign in
        </button>
      </div>
    </div>
  );
}
