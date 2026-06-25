// ─── BootSplash ─────────────────────────────────────────────
// Full redesign: bg-onboarding-0 gradient, VantageMark burst,
// two-line wordmark, version tag. 1800ms duration.
//
// Layout (centered):
//   VantageMark burst (130px)
//   "VANTAGE" wordmark (sans 800, 28px)
//   "Your AI investing advisor." tagline (serif italic, 16px)
//   "v0.1.0" version (absolute bottom)

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { VantageMark } from '@/components/brand/VantageMark';

const DURATION = 1800;
const WORDMARK_DELAY = 700;
const TAGLINE_DELAY = 950;

interface BootSplashProps {
  onComplete: () => void;
}

export function BootSplash({ onComplete }: BootSplashProps) {
  const [showWordmark, setShowWordmark] = useState(false);
  const [showTagline, setShowTagline] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const wm = setTimeout(() => setShowWordmark(true), WORDMARK_DELAY);
    const tl = setTimeout(() => setShowTagline(true), TAGLINE_DELAY);
    const exit = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onComplete();
      }
    }, DURATION);

    return () => {
      clearTimeout(wm);
      clearTimeout(tl);
      clearTimeout(exit);
    };
  }, [onComplete]);

  return (
    <div
      className="bg-onboarding-0"
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
      }}
    >
      {/* VantageMark burst */}
      <VantageMark size={130} showBurst />

      {/* Wordmark + Tagline */}
      <div
        style={{
          textAlign: 'center',
          opacity: showWordmark ? 1 : 0,
          transition: 'opacity 400ms var(--ease-out)',
        }}
      >
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-sans)',
            fontSize: '28px',
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '0.18em',
          }}
        >
          VANTAGE
        </span>

        <span
          style={{
            display: 'block',
            marginTop: '8px',
            fontFamily: 'var(--font-serif)',
            fontSize: '16px',
            fontWeight: 400,
            fontStyle: 'italic',
            color: 'rgba(255,255,255,0.60)',
            opacity: showTagline ? 1 : 0,
            transition: 'opacity 400ms var(--ease-out)',
          }}
        >
          Your AI investing advisor.
        </span>
      </div>

      {/* Version */}
      <span
        style={{
          position: 'absolute',
          bottom: '40px',
          fontSize: '11px',
          color: 'rgba(255,255,255,0.25)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        v0.1.0
      </span>
    </div>
  );
}
