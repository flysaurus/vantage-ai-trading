// ─── BootSplash ─────────────────────────────────────────────
// Full-screen splash shown on every app open (~1100ms).
//
// Background: var(--bg-primary) — NOT pure black, fixing the
// flash-to-navy bug from the current build.
//
// Sequence:
//   0ms: CompassMark burst-in (140px, glow, no idle rotate)
//   400ms: "VANTAGE" wordmark + tagline + version fade in
//   1100ms: route decision (see flow below)
//
// Routing:
//   Quiz done → fade out to main app (300ms)
//   Intro not seen → compass shrinks 140→56px and moves to
//     top-center (400ms), wordmark/tagline fade out → FeatureSplash
//   Quiz incomplete + intro seen → skip to Quiz Q1

'use client';

import React, { useEffect, useState } from 'react';
import { CompassMark } from '@/components/brand/CompassMark';
import { isQuizComplete } from '@/lib/onboarding/quiz-logic';
import { isIntroSeen } from '@/lib/onboarding/flow-state';

const BOOT_DURATION = 1100;

interface BootSplashProps {
  onComplete: (route: 'main' | 'feature-splash' | 'quiz') => void;
}

export function BootSplash({ onComplete }: BootSplashProps) {
  const [phase, setPhase] = useState<'burst' | 'text' | 'exit' | 'shrink'>('burst');
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Phase: show text at 400ms
    const textTimer = setTimeout(() => setPhase('text'), 400);

    // Phase: route decision at BOOT_DURATION
    const exitTimer = setTimeout(() => {
      const quizDone = isQuizComplete();
      const introSeen = isIntroSeen();

      if (quizDone) {
        // Fade out to main app
        setPhase('exit');
        setTimeout(() => {
          setIsVisible(false);
          onComplete('main');
        }, 300);
      } else if (!introSeen) {
        // Shrink compass to top-center → Feature Splash
        setPhase('shrink');
        setTimeout(() => {
          setIsVisible(false);
          onComplete('feature-splash');
        }, 400);
      } else {
        // Quiz incomplete but intro seen → skip to quiz
        setPhase('exit');
        setTimeout(() => {
          setIsVisible(false);
          onComplete('quiz');
        }, 200);
      }
    }, BOOT_DURATION);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(exitTimer);
    };
  }, [onComplete]);

  if (!isVisible) return null;

  const isShrink = phase === 'shrink';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--bg-primary, #0a0f1e)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: phase === 'exit' ? 0 : 1,
        transition: 'opacity 300ms ease',
      }}
    >
      {/* Compass mark — shrinks + repositions when going to Feature Splash */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: isShrink
            ? 'scale(0.4) translateY(calc(-50vh + 108px))'
            : 'scale(1) translateY(0)',
          transition: 'transform 400ms ease-in-out',
        }}
      >
        <CompassMark
          size={140}
          showBurst
          glow
          idleRotate={false}
        />
      </div>

      {/* Wordmark + tagline + version */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginTop: '24px',
          opacity: phase === 'burst' ? 0 : isShrink ? 0 : 1,
          transition: 'opacity 300ms ease',
        }}
      >
        <span
          style={{
            fontSize: '28px',
            fontWeight: 600,
            color: '#ffffff',
            letterSpacing: '0.15em',
          }}
        >
          VANTAGE
        </span>

        <p
          style={{
            fontSize: '14px',
            color: '#64748b',
            maxWidth: '280px',
            textAlign: 'center',
            marginTop: '8px',
            lineHeight: 1.5,
          }}
        >
          Institutional-quality AI portfolio analysis. Built for everyone.
        </p>

        <span
          style={{
            fontSize: '12px',
            color: '#475569',
            marginTop: '24px',
            letterSpacing: '0.05em',
          }}
        >
          v0.1.0
        </span>
      </div>
    </div>
  );
}
