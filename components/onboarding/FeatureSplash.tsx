// ─── FeatureSplash ──────────────────────────────────────────
// First-time-only feature intro shown after BootSplash.
// Three auto-advancing taglines with progress dots.
// No localStorage — only new users in the onboarding flow see this.

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { CompassMark } from '@/components/brand/CompassMark';

const LINES = [
  ['Beyond buy buttons.', 'Actual insight.'],
  ['Five styles.', "One that's actually yours."],
  ['The AI-powered portfolio advisor', 'that fits in your pocket.'],
];

const IN_DURATION = 300;
const OUT_DURATION = 250;
const HOLD_DURATIONS = [1200, 1200, 1400];

const PARTICLES = [
  { size: 5, x: 12, duration: 9, delay: 0, drift: 18 },
  { size: 4, x: 35, duration: 11, delay: 2, drift: -14 },
  { size: 6, x: 58, duration: 10, delay: 4, drift: 20 },
  { size: 4, x: 78, duration: 12, delay: 6, drift: -16 },
  { size: 5, x: 22, duration: 8, delay: 8, drift: 12 },
];

interface FeatureSplashProps {
  onComplete: () => void;
}

export function FeatureSplash({ onComplete }: FeatureSplashProps) {
  const [activeLine, setActiveLine] = useState(0);
  const [lineState, setLineState] = useState<'in' | 'hold' | 'out'>('in');
  const finished = useRef(false);

  const advance = useCallback((currentLine: number) => {
    if (finished.current) return;

    if (currentLine >= LINES.length - 1) {
      // Last line: hold longer, then finish
      setTimeout(() => {
        if (!finished.current) {
          finished.current = true;
          onComplete();
        }
      }, HOLD_DURATIONS[currentLine] + OUT_DURATION);
      return;
    }

    // Transition to next line
    const holdTime = HOLD_DURATIONS[currentLine];
    const holdTimer = setTimeout(() => {
      setLineState('out');
      const outTimer = setTimeout(() => {
        setActiveLine((prev) => prev + 1);
        setLineState('in');
      }, OUT_DURATION);
      return () => clearTimeout(outTimer);
    }, holdTime);

    return () => clearTimeout(holdTimer);
  }, [onComplete]);

  useEffect(() => {
    advance(activeLine);
  }, [activeLine, advance]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Ambient particles */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            bottom: '-10px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: '50%',
            background: 'rgba(34,211,238,0.4)',
            filter: 'blur(2px)',
            animation: `feature-particle ${p.duration}s ${p.delay}s linear infinite`,
          }}
        />
      ))}

      {/* Top: CompassMark */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '60px' }}>
        <CompassMark size={56} showBurst={false} glow idleRotate />
      </div>

      {/* Skip button */}
      <button
        onClick={() => {
          if (!finished.current) {
            finished.current = true;
            onComplete();
          }
        }}
        style={{
          position: 'absolute',
          top: 'max(20px, env(safe-area-inset-top, 0px))',
          right: '20px',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          fontFamily: 'inherit',
          padding: 'var(--space-2) var(--space-3)',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <X size={16} />
        Skip
      </button>

      {/* Center: auto-advancing lines */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: '80px',
        }}
      >
        <div
          style={{
            opacity: lineState === 'in' ? 1 : lineState === 'out' ? 0 : 0,
            transition: `opacity ${lineState === 'in' ? IN_DURATION : OUT_DURATION}ms var(--ease-out)`,
            textAlign: 'center',
          }}
        >
          {LINES[activeLine].map((text, i) => (
            <p
              key={i}
              style={{
                fontSize: '30px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.4,
                margin: 0,
              }}
            >
              {text}
            </p>
          ))}
        </div>
      </div>

      {/* Bottom: progress dots */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          paddingBottom: '40px',
        }}
      >
        {LINES.map((_, i) => (
          <div
            key={i}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: i === activeLine ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'background 300ms var(--ease-out)',
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes feature-particle {
          0%   { transform: translateY(0) translateX(0); opacity: 0; }
          10%  { opacity: 0.6; }
          90%  { opacity: 0.6; }
          100% { transform: translateY(-110vh) translateX(${PARTICLES[0].drift}px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
