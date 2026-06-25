// ─── BootSplash — Orb Hero ──────────────────────────────────
// VantageOrb command center. Orb + wordmark + tagline as ONE
// tight centered group. No dead space. Version anchored bottom.
//
// Layout:
//   Orb section:  padding-top 48px, orb 260px
//   Text section: margin-top 36px, wordmark 38px + tagline 18px
//   Version:      absolute bottom 44px

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
        padding: 0,
        background: `
          radial-gradient(ellipse 180% 80% at 50% -30%, rgba(34,211,238,0.50) 0%, rgba(14,116,144,0.30) 35%, rgba(6,78,100,0.12) 60%, transparent 75%),
          radial-gradient(ellipse 100% 60% at 80% 110%, rgba(99,102,241,0.22) 0%, transparent 70%),
          #0a0f1e
        `,
      }}
    >
      {/* Orb section — padding-top pushes it slightly up */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: '48px',
        }}
      >
        <VantageOrb size={260} animate showEntrance />
      </div>

      {/* Wordmark + tagline — tight group below orb */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginTop: '36px',
          gap: '10px',
          opacity: showWordmark ? 1 : 0,
          transition: 'opacity 400ms var(--ease-out)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '38px',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '0.22em',
          }}
        >
          VANTAGE
        </span>

        <span
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '18px',
            fontWeight: 400,
            fontStyle: 'italic',
            color: 'rgba(255,255,255,0.55)',
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
          bottom: '44px',
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
