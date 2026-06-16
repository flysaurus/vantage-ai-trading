// ─── FeatureSplash ──────────────────────────────────────────
// First-time-only feature intro shown after Boot Splash.
// Three auto-advancing taglines with progress dots.
//
// Layout:
//   Top: CompassMark 56px, idle-rotating (arrives from BootSplash transition)
//   Skip: top-right corner, 13px muted
//   Center: 3 lines auto-advancing with crossfade
//   Bottom: 3 progress dots (purely indicator, not tappable)
//
// After line 3: marks intro seen → transitions to Arrival Screen
// Skip tap: marks intro seen → routes to Quiz Q1

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
      // Last line — mark intro seen and go to arrival
      finished.current = true;
      markIntroSeen();

      // Fade out last line
      setLineState('out');
      timerRef.current = setTimeout(() => {
        onComplete('arrival');
      }, OUT_DURATION);
      return;
    }

    // Fade out current, then show next
    setLineState('out');
    timerRef.current = setTimeout(() => {
      setActiveLine(currentLine + 1);
      setLineState('in');
    }, OUT_DURATION);
  }, [onComplete]);

  useEffect(() => {
    const currentLine = activeLine;

    // Phase: fade in completed → hold
    const holdTimer = setTimeout(() => {
      setLineState('hold');

      // Phase: hold completed → advance
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
        overflow: 'hidden',
      }}
    >
      {/* Compass mark — top-center, 56px, settled */}
      <div
        style={{
          marginTop: 'max(80px, env(safe-area-inset-top, 20px) + 40px)',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <CompassMark size={56} showBurst={false} glow idleRotate />
      </div>

      {/* Skip button */}
      <button
        onClick={handleSkip}
        style={{
          position: 'absolute',
          top: 'max(16px, env(safe-area-inset-top, 16px))',
          right: '16px',
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

      {/* Auto-advancing lines */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: '320px',
          padding: '0 24px',
          marginTop: '-40px', // slight visual balance since compass is at top
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

      {/* Progress dots */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: 'max(60px, env(safe-area-inset-bottom, 20px) + 32px)',
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
    </div>
  );
}
