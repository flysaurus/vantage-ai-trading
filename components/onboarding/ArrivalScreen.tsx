// ─── ArrivalScreen ──────────────────────────────────────────
// Full-screen immersive intro shown after Feature Splash.
//
// Compass arrives already positioned at top-center (100px,
// idle-rotating). No compass burst — that's handled by
// Boot Splash / Feature Splash transition.
//
// Three-zone flex layout (full viewport):
//   TOP zone: CompassMark 100px
//   MIDDLE zone: flex:1, centered — fixed headline
//     + cycling support lines + closing line as one block
//   BOTTOM zone: CTA button + subtext, anchored near bottom
//
// Timing (retuned — deliberate, not rushed):
//   Headline typed → hold 500ms → first support line
//   Support typed → hold 450ms → fade 200ms → next support
//   Last support → hold 400ms → closing line types in
//   Closing typed → hold 400ms → CTA fades in
//   Total ~5-6s to CTA

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CompassMark } from '@/components/brand/CompassMark';
import { useTypewriter } from '@/lib/animations/typewriter';

interface ArrivalScreenProps {
  onFindStyle: () => void;
}

const HEADLINE = 'Every investor has a style.';
const SUPPORT_LINES = [
  'Buffett waits decades.',
  'Livermore reads the tape.',
  'Soros bets against the world.',
];
const CLOSING_LINE = "Let's find yours.";

// Timing constants
const HEADLINE_HOLD = 500;      // after headline typed, before first support
const SUPPORT_HOLD = 450;       // after each support typed, before fade out
const SUPPORT_FADE = 200;       // fade out duration
const CLOSING_PAUSE = 400;      // after last support fades, before closing types
const CLOSING_HOLD = 400;       // after closing typed, before CTA

export function ArrivalScreen({ onFindStyle }: ArrivalScreenProps) {
  const [phase, setPhase] = useState<'headline' | 'support' | 'closing' | 'cta' | 'done'>(
    'headline'
  );
  const [supportIndex, setSupportIndex] = useState(-1);
  const headlineDone = useRef(false);

  const { displayText: headlineText, isDone: headlineTyped } = useTypewriter(
    HEADLINE,
    35,
    0,
  );

  // ── Headline typed → hold HEADLINE_HOLD → first support line
  useEffect(() => {
    if (headlineTyped && !headlineDone.current) {
      headlineDone.current = true;
      setTimeout(() => {
        setPhase('support');
        setSupportIndex(0);
      }, HEADLINE_HOLD);
    }
  }, [headlineTyped]);

  // ── Support line sequencing ───────────────────────────────
  useEffect(() => {
    if (phase !== 'support' || supportIndex < 0) return;

    const line = SUPPORT_LINES[supportIndex];
    const typeTime = line.length * 30;

    if (supportIndex === SUPPORT_LINES.length - 1) {
      // Last support line → hold → fade → pause → closing
      const t = setTimeout(() => {
        setPhase('closing');
      }, typeTime + SUPPORT_HOLD + SUPPORT_FADE + CLOSING_PAUSE);
      return () => clearTimeout(t);
    } else {
      // Next support line after hold + fade
      const t = setTimeout(() => {
        setSupportIndex((prev) => prev + 1);
      }, typeTime + SUPPORT_HOLD + SUPPORT_FADE);
      return () => clearTimeout(t);
    }
  }, [phase, supportIndex]);

  // ── Closing line typed → hold CLOSING_HOLD → CTA
  const { displayText: closingText, isDone: closingDone } = useTypewriter(
    phase === 'closing' ? CLOSING_LINE : '',
    35,
    0,
  );

  useEffect(() => {
    if (closingDone && phase === 'closing') {
      const t = setTimeout(() => setPhase('cta'), CLOSING_HOLD);
      return () => clearTimeout(t);
    }
  }, [closingDone, phase]);

  // ── Typewriter hooks per support line ─────────────────────
  const { displayText: s0Text } = useTypewriter(
    supportIndex === 0 ? SUPPORT_LINES[0] : '',
    30,
    0,
  );
  const { displayText: s1Text } = useTypewriter(
    supportIndex === 1 ? SUPPORT_LINES[1] : '',
    30,
    0,
  );
  const { displayText: s2Text } = useTypewriter(
    supportIndex === 2 ? SUPPORT_LINES[2] : '',
    30,
    0,
  );

  const currentSupportText =
    supportIndex === 0 ? s0Text : supportIndex === 1 ? s1Text : supportIndex === 2 ? s2Text : '';

  const showCta = phase === 'cta' || phase === 'done';
  const showClosing = phase === 'closing' || phase === 'cta' || phase === 'done';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: '#0a0f1e',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100dvh',
        padding: '24px',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      {/* ── TOP zone: Compass ─────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
        }}
      >
        <CompassMark size={100} showBurst={false} glow idleRotate />
      </div>

      {/* ── MIDDLE zone: headline + support/closing block ─── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: '340px',
          gap: '16px',
        }}
      >
        {/* Fixed headline — fades in once, stays fixed */}
        <h1
          style={{
            fontSize: 'var(--onb-headline-size)',
            fontWeight: 'var(--onb-headline-weight)',
            color: 'var(--onb-headline-color)',
            textAlign: 'center',
            maxWidth: '320px',
            margin: 0,
            opacity: 1,
            transition: 'opacity 400ms ease',
          }}
        >
          {headlineText}
          {!headlineTyped && (
            <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
          )}
        </h1>

        {/* Support lines / closing line — fixed min-height, no jumps */}
        <div
          style={{
            width: '100%',
            minHeight: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          {phase === 'support' && (
            <p
              key={supportIndex}
              style={{
                fontSize: 'var(--onb-body-size)',
                fontWeight: 'var(--onb-body-weight)',
                color: 'var(--onb-body-color)',
                lineHeight: 'var(--onb-body-line-height)',
                margin: 0,
                animation: 'supportFadeIn 200ms ease',
              }}
            >
              {currentSupportText}
              <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
            </p>
          )}

          {showClosing && (
            <p
              style={{
                fontSize: 'var(--onb-headline-size)',
                fontWeight: 'var(--onb-headline-weight)',
                color: 'var(--onb-headline-color)',
                lineHeight: 'var(--onb-body-line-height)',
                margin: 0,
                animation: phase === 'closing' ? 'supportFadeIn 200ms ease' : undefined,
              }}
            >
              {closingText}
              {!closingDone && (
                <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ── BOTTOM zone: CTA ──────────────────────────────── */}
      <div
        style={{
          width: '100%',
          paddingBottom: 'max(4px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {showCta && (
          <div
            style={{
              opacity: 0,
              animation: 'fadeIn 400ms ease forwards',
            }}
          >
            <button
              onClick={onFindStyle}
              style={{
                width: '100%',
                padding: '16px 0',
                background: '#22d3ee',
                border: 'none',
                borderRadius: '14px',
                fontSize: '16px',
                fontWeight: 600,
                color: '#0a0f1e',
                cursor: 'pointer',
                transition: 'transform 0.15s ease',
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.97)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              Find my style →
            </button>

            <p
              style={{
                fontSize: '13px',
                color: 'var(--onb-body-color)',
                textAlign: 'center',
                marginTop: '16px',
                opacity: 0,
                animation: 'fadeIn 400ms ease forwards',
                animationDelay: '200ms',
              }}
            >
              Takes 2 minutes. No account needed.
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes supportFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .cursor-blink {
          animation: blink 0.8s ease-in-out infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
