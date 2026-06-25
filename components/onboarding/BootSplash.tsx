// ─── BootSplash — Orb Hero ──────────────────────────────────
// VantageOrb command center. Large glowing sphere with
// architectural wordmark below. The "wow" first impression.
//
// Layout (centered, flex column):
//   VantageOrb (260px, entrance + pulse)
//   "VANTAGE" (sans 800, 38px, 0.22em spacing)
//   "Your AI investing advisor." (serif italic, 18px)
//   v0.1.0 (absolute bottom, subtle)

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';

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
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        background: `
          radial-gradient(ellipse 180% 80% at 50% -30%, rgba(34,211,238,0.50) 0%, rgba(14,116,144,0.30) 35%, rgba(6,78,100,0.12) 60%, transparent 75%),
          radial-gradient(ellipse 100% 60% at 80% 110%, rgba(99,102,241,0.22) 0%, transparent 70%),
          #0a0f1e
        `,
      }}
    >
      {/* VantageOrb — the hero */}
      <div style={{ marginBottom: '40px' }}>
        <VantageOrb size={260} animate showEntrance />
      </div>

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
            fontSize: '38px',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '0.22em',
            marginBottom: '10px',
          }}
        >
          VANTAGE
        </span>

        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-serif)',
            fontSize: '18px',
            fontWeight: 400,
            fontStyle: 'italic',
            color: 'rgba(255,255,255,0.55)',
            textAlign: 'center',
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
          bottom: '48px',
          fontSize: '12px',
          color: 'rgba(255,255,255,0.20)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        v0.1.0
      </span>
    </div>
  );
}
