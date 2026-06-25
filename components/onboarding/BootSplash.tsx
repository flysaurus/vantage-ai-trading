// ─── BootSplash ─────────────────────────────────────────────
// Full-screen splash shown on EVERY app open for 1.5 seconds.
// Never skippable. Transitions automatically.
//
// Compass burst-in, wordmark fades, 1500ms → onComplete().
// Parent (app layout / onboarding orchestrator) decides next
// screen based on auth state.

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { VantageMark } from '@/components/brand/VantageMark';

const DURATION = 1500;
const WORDMARK_DELAY = 600;
const TAGLINE_DELAY = 800;

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
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-6)',
      }}
    >
      {/* Compass */}
      <VantageMark size={140} showBurst animate />

      {/* Wordmark */}
      <div style={{ textAlign: 'center', opacity: showWordmark ? 1 : 0, transition: 'opacity 300ms var(--ease-out)' }}>
        <span
          style={{
            display: 'block',
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '0.15em',
          }}
        >
          VANTAGE
        </span>

        {/* Tagline */}
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: '14px',
            color: 'var(--text-muted)',
            letterSpacing: '0.05em',
            opacity: showTagline ? 1 : 0,
            transition: 'opacity 300ms var(--ease-out)',
          }}
        >
          Institutional-quality AI portfolio analysis.
        </p>
      </div>

      {/* Version */}
      <span
        style={{
          position: 'absolute',
          bottom: '32px',
          fontSize: '12px',
          color: 'var(--text-muted)',
        }}
      >
        v0.1.0
      </span>
    </div>
  );
}
