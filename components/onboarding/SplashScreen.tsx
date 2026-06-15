// ─── SplashScreen ───────────────────────────────────────────
// Full-screen intro animation shown for 2 seconds on first
// launch of the onboarding quiz.
//
// Background: #0a0f1e (matching app bg)
// Vantage logo + compass rose icon + tagline
// Subtle pulse animation on the icon
// Auto-advances after 2 seconds

'use client';

import React, { useEffect, useState } from 'react';
import CompassIcon from '@/components/CompassIcon';

interface SplashScreenProps {
  onDone: () => void;
}

export function SplashScreen({ onDone }: SplashScreenProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Fade in
    requestAnimationFrame(() => setVisible(true));

    // Auto-advance after 2.5 seconds (2s visible + 0.5s fade out)
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(onDone, 500);
    }, 2500);

    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: '#0a0f1e',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: visible && !exiting ? 1 : 0,
        transition: 'opacity 0.5s ease',
      }}
    >
      {/* Compass rose icon */}
      <div
        className="splash-pulse"
        style={{
          marginBottom: '32px',
          animation: 'splashPulse 2s ease-in-out infinite',
        }}
      >
        <CompassIcon size={80} color="#22d3ee" />
      </div>

      {/* App name */}
      <h1
        style={{
          fontSize: '36px',
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          marginBottom: '12px',
        }}
      >
        Vantage
      </h1>

      {/* Tagline */}
      <p
        style={{
          fontSize: '15px',
          color: '#94a3b8',
          textAlign: 'center',
          maxWidth: '280px',
          lineHeight: 1.6,
        }}
      >
        Your AI investing companion.
      </p>

      <style>{`
        @keyframes splashPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
