// ─── FeatureSplash ──────────────────────────────────────────
// First-time-only feature intro shown after Boot Splash.
// Three auto-advancing taglines with progress dots.
//
// Layout (three-zone flex, full viewport):
//   TOP zone: CompassMark 56px, idle-rotating
//   Skip: absolute top-right
//   MIDDLE zone: flex:1, centered — 3 auto-advancing lines
//   BOTTOM zone: progress dots, anchored near bottom
//
// Adds subtle ambient background particles — soft-glow cyan
// circles drifting upward with slight horizontal sway.
// Barely noticeable, never distracts from text.

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CompassMark } from '@/components/brand/CompassMark';
import { markIntroSeen } from '@/lib/onboarding/flow-state';

const LINES = [
  ['Beyond buy buttons.', 'Actual insight.'],
  ['Five styles.', "One that's actually yours."],
  ['The AI-powered portfolio advisor', 'that fits in your pocket.'],
];

const IN_DURATION = 300;
const HOLD_DURATIONS = [1200, 1200, 1300];
const OUT_DURATION = 250;

// Ambient particles: 5 drifting cyan glow dots
const PARTICLES = [
  { size: 5, x: 12, duration: 9, delay: 0, drift: 18 },
  { size: 4, x: 35, duration: 11, delay: 2, drift: -14 },
  { size: 6, x: 58, duration: 10, delay: 4, drift: 20 },
  { size: 4, x: 78, duration: 12, delay: 6, drift: -16 },
  { size: 5, x: 22, duration: 8, delay: 8, drift: 12 },
];

interface FeatureSplashProps {
  onComplete: (route: 'arrival' | 'quiz') => void;
}

export function FeatureSplash({ onComplete }: FeatureSplashProps) {
  const [activeLine, setActiveLine] = useState(0);
  const [lineState, setLineState] = useState<'in' | 'hold' | 'out'>('in');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = useRef(false);

  const advance = useCallback((currentLine: number) => {
    if (finished.current) return;

    if (currentLine >= LINES.length - 1) {
      finished.current = true;
      markIntroSeen();
      setLineState('out');
      timerRef.current = setTimeout(() => {
        onComplete('arrival');
      }, OUT_DURATION);
      return;
    }

    setLineState('out');
    timerRef.current = setTimeout(() => {
      setActiveLine(currentLine + 1);
      setLineState('in');
    }, OUT_DURATION);
  }, [onComplete]);

  useEffect(() => {
    const currentLine = activeLine;

    const holdTimer = setTimeout(() => {
      setLineState('hold');

      timerRef.current = setTimeout(() => {
        advance(currentLine);
      }, HOLD_DURATIONS[currentLine]);
    }, IN_DURATION);

    return () => {
      clearTimeout(holdTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeLine, advance]);

  const handleSkip = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    markIntroSeen();
    if (timerRef.current) clearTimeout(timerRef.current);
    onComplete('quiz');
  }, [onComplete]);

  const currentCopy = LINES[activeLine];
  const isVisible = lineState !== 'out';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 190,
        background: 'var(--bg-primary, #0a0f1e)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100dvh',
        padding: '24px',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      {/* ── Ambient background particles ──────────────────── */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: '50%',
            background: 'rgba(34,211,238,0.4)',
            filter: 'blur(2px)',
            left: `${p.x}%`,
            bottom: '-10px',
            zIndex: 0,
            animation: `particleFloat-${i} ${p.duration}s ${p.delay}s infinite linear`,
          }}
        />
      ))}

      {/* ── TOP zone: Compass ─────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          paddingTop: 'max(32px, env(safe-area-inset-top, 16px))',
        }}
      >
        <CompassMark size={56} showBurst={false} glow idleRotate />
      </div>

      {/* Skip button — absolute, top-right */}
      <button
        onClick={handleSkip}
        style={{
          position: 'absolute',
          top: 'max(24px, env(safe-area-inset-top, 16px))',
          right: '24px',
          background: 'none',
          border: 'none',
          color: '#64748b',
          fontSize: '13px',
          cursor: 'pointer',
          padding: '8px 12px',
          zIndex: 10,
        }}
      >
        Skip
      </button>

      {/* ── MIDDLE zone: centered lines ───────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: '320px',
          width: '100%',
        }}
      >
        <div
          style={{
            fontSize: '26px',
            fontWeight: 600,
            color: '#ffffff',
            textAlign: 'center',
            lineHeight: 1.35,
            opacity: isVisible ? 1 : 0,
            transition: `opacity ${IN_DURATION}ms ease`,
          }}
        >
          {currentCopy[0]}
          <br />
          {currentCopy[1]}
        </div>
      </div>

      {/* ── BOTTOM zone: progress dots ────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          paddingBottom: 'max(4px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {LINES.map((_, i) => (
          <div
            key={i}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: i === activeLine ? '#22d3ee' : 'rgba(255,255,255,0.2)',
              transition: 'background 200ms ease',
            }}
          />
        ))}
      </div>

      <style>{`
        ${PARTICLES.map((p, i) => `
          @keyframes particleFloat-${i} {
            0%   { transform: translateY(0) translateX(0); opacity: 0; }
            10%  { opacity: 0.5; }
            85%  { opacity: 0.5; }
            100% { transform: translateY(-100dvh) translateX(${p.drift}px); opacity: 0; }
          }
        `).join('\n')}
      `}</style>
    </div>
  );
}
