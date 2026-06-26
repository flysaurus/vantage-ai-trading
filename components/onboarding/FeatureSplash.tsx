// ─── FeatureSplash ──────────────────────────────────────────
// bg-onboarding-0 gradient, two-line headlines
// per slide, progress bar (3 segments), VantageOrb 100px pulsing.
//
// Layout:
//   TOP RIGHT:  "Skip" button
//   CENTER:     VantageOrb (100px, pulsing) + two-line headlines
//   BOTTOM:     progress bar (3 segments) + white pill Continue

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';

const SLIDES = [
  ['Beyond buy buttons.', 'Actual insight.'],
  ['Five styles.', "One that's actually yours."],
  ['The AI-powered advisor', 'that fits in your pocket.'],
];

const AUTO_ADVANCE_MS = 2000;

interface FeatureSplashProps {
  onComplete: () => void;
}

export function FeatureSplash({ onComplete }: FeatureSplashProps) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideState, setSlideState] = useState<'in' | 'visible'>('in');
  const finished = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-advance
  useEffect(() => {
    if (finished.current) return;

    // Small delay for "in" animation, then auto-advance
    const t = setTimeout(() => {
      setSlideState('visible');
    }, 400);

    const auto = setTimeout(() => {
      if (finished.current) return;
      if (activeSlide < SLIDES.length - 1) {
        setSlideState('in');
        setActiveSlide((prev) => prev + 1);
      } else {
        finished.current = true;
        onComplete();
      }
    }, AUTO_ADVANCE_MS);

    timerRef.current = auto;
    return () => {
      clearTimeout(t);
      clearTimeout(auto);
    };
  }, [activeSlide, onComplete]);

  const handleContinue = useCallback(() => {
    if (finished.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    if (activeSlide < SLIDES.length - 1) {
      setSlideState('in');
      setActiveSlide((prev) => prev + 1);
    } else {
      finished.current = true;
      onComplete();
    }
  }, [activeSlide, onComplete]);

  const handleSkip = useCallback(() => {
    if (finished.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    finished.current = true;
    onComplete();
  }, [onComplete]);

  const [line1, line2] = SLIDES[activeSlide];

  return (
    <div
      className="bg-onboarding-0"
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 'max(24px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* ── TOP RIGHT: Skip ── */}
      <button
        onClick={handleSkip}
        style={{
          position: 'absolute',
          top: 'max(56px, env(safe-area-inset-top, 56px))',
          right: '24px',
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.40)',
          fontSize: '13px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          padding: '8px',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Skip
      </button>

      {/* ── CENTER ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
        }}
      >
        {/* VantageOrb — pulsing at small size */}
        <div style={{ marginBottom: '48px' }}>
          <VantageOrb size={100} animate showEntrance={false} />
        </div>

        {/* Two-line headline per slide */}
        <div
          style={{
            textAlign: 'center',
            opacity: slideState === 'visible' ? 1 : 0,
            transform: slideState === 'visible' ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 600ms var(--ease-out), transform 600ms var(--ease-out)',
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '36px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.15,
              marginBottom: '4px',
            }}
          >
            {line1}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '36px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-primary)',
              lineHeight: 1.15,
            }}
          >
            {line2}
          </span>
        </div>
      </div>

      {/* ── BOTTOM: Progress + Continue ── */}
      <div
        style={{
          width: '100%',
          padding: '0 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {/* Progress bar (3 segments) */}
        <div style={{ display: 'flex', gap: '2px', width: '100%', maxWidth: '200px' }}>
          {SLIDES.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: '3px',
                borderRadius: '1px',
                background: i <= activeSlide ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                transition: 'background 300ms ease-out',
              }}
            />
          ))}
        </div>

        {/* Continue button */}
        <button
          onClick={handleContinue}
          style={{
            width: '100%',
            maxWidth: '360px',
            height: '56px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: '#ffffff',
            color: '#000000',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
