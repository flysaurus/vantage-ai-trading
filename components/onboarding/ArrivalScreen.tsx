// ─── ArrivalScreen ──────────────────────────────────────────
// Full-screen immersive intro shown after Feature Splash.
//
// Compass arrives already positioned at top-center (100px,
// idle-rotating). No compass burst — that's handled by
// Boot Splash / Feature Splash transition.
//
// Structure:
//   1. Fixed headline: "Every investor has a style." — fades in,
//      stays on screen the entire sequence
//   2. Support lines cycle beneath headline, one at a time,
//      with tight 150ms gaps between lines:
//      "Buffett waits decades." → "Livermore reads the tape."
//      → "Soros bets against the world."
//   3. Closing line: "Let's find yours." — lands at headline
//      weight/size (confident close, not smaller)
//   4. CTA: "Find my style →" + subtitle

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

export function ArrivalScreen({ onFindStyle }: ArrivalScreenProps) {
  const [phase, setPhase] = useState<'headline' | 'support' | 'closing' | 'cta' | 'done'>(
    'headline'
  );
  const [supportIndex, setSupportIndex] = useState(-1); // -1 = none showing yet
  const headlineDone = useRef(false);

  const { displayText: headlineText, isDone: headlineTyped } = useTypewriter(
    HEADLINE,
    35,
    0,
  );

  // ── Headline typed → show first support line ──────────────
  useEffect(() => {
    if (headlineTyped && !headlineDone.current) {
      headlineDone.current = true;
      setTimeout(() => {
        setPhase('support');
        setSupportIndex(0);
      }, 400);
    }
  }, [headlineTyped]);

  // ── Support line sequencing ───────────────────────────────
  const supportIndexRef = useRef(0);
  useEffect(() => {
    if (phase !== 'support') return;
    supportIndexRef.current = supportIndex;
  }, [phase, supportIndex]);

  useEffect(() => {
    if (phase !== 'support' || supportIndex < 0) return;

    const line = SUPPORT_LINES[supportIndex];
    const typeTime = line.length * 30;
    const holdTime = 600;
    const fadeTime = 200;

    if (supportIndex === SUPPORT_LINES.length - 1) {
      // Last support line → close → closing line after 300ms pause
      const t = setTimeout(() => {
        setPhase('closing');
      }, typeTime + holdTime + fadeTime + 300);
      return () => clearTimeout(t);
    } else {
      // Next support line after 150ms gap
      const t = setTimeout(() => {
        setSupportIndex((prev) => prev + 1);
      }, typeTime + holdTime + fadeTime + 150);
      return () => clearTimeout(t);
    }
  }, [phase, supportIndex]);

  // ── Closing line typed → show CTA ────────────────────────
  const { displayText: closingText, isDone: closingDone } = useTypewriter(
    phase === 'closing' ? CLOSING_LINE : '',
    35,
    0,
  );

  useEffect(() => {
    if (closingDone && phase === 'closing') {
      const t = setTimeout(() => setPhase('cta'), 300);
      return () => clearTimeout(t);
    }
  }, [closingDone, phase]);

  // ── Typewriter hook per support line ──────────────────────
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
        overflow: 'hidden',
      }}
    >
      {/* Compass — 100px, idle-rotating, already positioned from Feature Splash */}
      <div
        style={{
          marginTop: 'max(64px, env(safe-area-inset-top, 20px) + 32px)',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <CompassMark size={100} showBurst={false} glow idleRotate />
      </div>

      {/* Fixed headline — fades in once, stays fixed */}
      <h1
        style={{
          fontSize: 'var(--onb-headline-size)',
          fontWeight: 'var(--onb-headline-weight)',
          color: 'var(--onb-headline-color)',
          textAlign: 'center',
          marginTop: '28px',
          marginBottom: '36px',
          maxWidth: '320px',
          padding: '0 24px',
          opacity: 1,
          transition: 'opacity 400ms ease',
        }}
      >
        {headlineText}
        {!headlineTyped && (
          <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
        )}
      </h1>

      {/* Support lines container — fixed height, no layout jumps */}
      <div
        style={{
          width: '100%',
          maxWidth: '340px',
          padding: '0 24px',
          minHeight: '48px', // reserve space for the longest line
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        {/* Support phase */}
        {phase === 'support' && (
          <p
            key={supportIndex} // remounts per line for fresh fade-in
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

        {/* Closing line — same weight/size as headline */}
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

      {/* CTA */}
      {showCta && (
        <div
          style={{
            position: 'absolute',
            bottom: 'max(60px, env(safe-area-inset-bottom, 20px) + 32px)',
            left: 0,
            right: 0,
            padding: '0 24px',
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
