'use client';

// ─── Loading Splash ─────────────────────────────────────────
// Bold orb-hero splash shown after successful sign-in or demo
// activation. Auto-dismisses after ~3.5s with a fade.
//
// Demo mode:  "You have X days left"
// Broker mode: "Your {broker} portfolio loading now…"

import React, { useEffect, useState, useRef } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';

// ── Types ───────────────────────────────────────────────────

export type SplashMode = 'broker' | 'generic';

interface LoadingSplashProps {
  mode: SplashMode;
  brokerName?: string;
  onComplete: () => void;
}

// ── Shared gradient (matching celebration screen) ───────────

const GRADIENT = `
  radial-gradient(ellipse 200% 70% at 50% -10%, rgba(34,211,238,0.50) 0%, rgba(14,116,144,0.30) 35%, transparent 65%),
  radial-gradient(ellipse 100% 60% at 85% 100%, rgba(99,102,241,0.20) 0%, transparent 70%),
  #0a0f1e
`;

// ── Component ───────────────────────────────────────────────

export function LoadingSplash({
  mode,
  brokerName,
  onComplete,
}: LoadingSplashProps) {
  const [exiting, setExiting] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      setExiting(true);
      setTimeout(onComplete, 400); // wait for fade-out
    }, 3500);

    return () => clearTimeout(timer);
  }, [onComplete]);

  // ── Message ───────────────────────────────────────────────

  const heading = (() => {
    if (mode === 'broker') {
      const name = brokerName || 'broker';
      return `Your ${name} portfolio`;
    }
    return 'Your portfolio';
  })();

  const subtext = (() => {
    if (mode === 'broker') return 'loading now…';
    return 'loading now…';
  })();

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: GRADIENT,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 0.4s ease',
        opacity: exiting ? 0 : 1,
        padding: '0 28px',
      }}
    >
      {/* Orb */}
      <VantageOrb size={180} animate showEntrance />

      {/* Headline */}
      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 900,
            fontSize: 42,
            letterSpacing: '-0.01em',
            color: '#fff',
            lineHeight: 1.1,
          }}
        >
          {heading}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 22,
            color: 'rgba(255,255,255,0.70)',
            marginTop: 8,
          }}
        >
          {subtext}
        </div>
      </div>
    </div>
  );
}
