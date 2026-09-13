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
      className="onboarding-shell"
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        padding: 0,
        // Themed canvas with a soft accent wash (tokens only — no dark navy).
        background: `
          radial-gradient(ellipse 180% 80% at 50% -30%, var(--v-accent-dim) 0%, transparent 72%),
          radial-gradient(ellipse 100% 60% at 80% 110%, var(--v-glow) 0%, transparent 70%),
          var(--v-canvas)
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
            color: 'var(--v-text-primary)',
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
            color: 'var(--v-text-secondary)',
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
          color: 'var(--v-text-faint)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        v0.1.0
      </span>
    </div>
  );
}
