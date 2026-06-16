// ─── ArrivalScreen ──────────────────────────────────────────
// Full-screen immersive intro shown after Feature Splash.
//
// NOTE: The compass mark is already positioned at top-center
// (56px, idle-rotating) from the Feature Splash → Arrival
// transition. This screen starts directly at the typewriter
// phase — no compass burst, no repositioning.
//
// Sequence:
//   1. Typewriter lines play immediately
//   2. CTA fades in after all lines complete

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CompassMark } from '@/components/brand/CompassMark';
import { useTypewriter } from '@/lib/animations/typewriter';

interface ArrivalScreenProps {
  onFindStyle: () => void;
}

const LINE_1 = 'Every investor has a style.';
const LINE_2 = 'Buffett waits decades.';
const LINE_3 = 'Livermore reads the tape.';
const LINE_4 = 'Soros bets against the world.';
const LINE_5 = "Let's find yours.";

export function ArrivalScreen({ onFindStyle }: ArrivalScreenProps) {
  const [animationPhase, setAnimationPhase] = useState<'typewriter' | 'cta' | 'done'>('typewriter');
  const [currentTypeLine, setCurrentTypeLine] = useState(0);

  // Typewriter line sequencing — starts immediately
  useEffect(() => {
    const nextLine = (index: number) => {
      if (index > 4) {
        // All lines done, show CTA
        const ctaTimer = setTimeout(() => setAnimationPhase('cta'), 600);
        return () => clearTimeout(ctaTimer);
      }

      const speeds = [35, 30, 30, 30, 40];
      const pauses = [700, 200, 200, 900, 0];
      const chars = [LINE_1, LINE_2, LINE_3, LINE_4, LINE_5][index];
      const typeTime = chars.length * speeds[index];

      const timer = setTimeout(() => {
        setCurrentTypeLine(index + 1);
        const pauseTimer = setTimeout(() => {
          nextLine(index + 1);
        }, pauses[index]);
        return () => clearTimeout(pauseTimer);
      }, typeTime);

      return () => clearTimeout(timer);
    };

    nextLine(0);
  }, []);

  const { displayText: line1Text } = useTypewriter(
    LINE_1, 35, 0,
  );
  const { displayText: line2Text } = useTypewriter(
    currentTypeLine >= 1 ? LINE_2 : '', 30, currentTypeLine >= 1 ? 700 : 999999,
  );
  const { displayText: line3Text } = useTypewriter(
    currentTypeLine >= 2 ? LINE_3 : '', 30, currentTypeLine >= 2 ? 200 : 999999,
  );
  const { displayText: line4Text } = useTypewriter(
    currentTypeLine >= 3 ? LINE_4 : '', 30, currentTypeLine >= 3 ? 200 : 999999,
  );
  const { displayText: line5Text } = useTypewriter(
    currentTypeLine >= 4 ? LINE_5 : '', 40, currentTypeLine >= 4 ? 900 : 999999,
  );

  const showCta = animationPhase === 'cta' || animationPhase === 'done';

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
        overflow: 'hidden',
      }}
    >
      {/* Compass mark — already in position from Feature Splash transition */}
      <div
        style={{
          marginTop: 'max(80px, env(safe-area-inset-top, 20px) + 40px)',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <CompassMark size={56} showBurst={false} glow idleRotate />
      </div>

      {/* Typewriter text area */}
      <div
        style={{
          width: '100%',
          padding: '0 32px',
          textAlign: 'center',
          marginTop: '24px',
        }}
      >
        {/* Line 1 */}
        <div
          style={{
            fontSize: '22px',
            fontWeight: 600,
            color: '#ffffff',
            minHeight: '32px',
            marginBottom: '20px',
          }}
        >
          {line1Text}
          {currentTypeLine === 0 && (
            <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
          )}
        </div>

        {/* Lines 2-4 */}
        <div style={{ marginBottom: '16px' }}>
          {[line2Text, line3Text, line4Text].map((text, i) => (
            <div
              key={i}
              style={{
                fontSize: '16px',
                color: '#64748b',
                minHeight: '24px',
                marginBottom: '4px',
              }}
            >
              {text}
              {currentTypeLine === i + 1 && (
                <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
              )}
            </div>
          ))}
        </div>

        {/* Line 5 */}
        <div
          style={{
            fontSize: '22px',
            fontWeight: 600,
            color: '#ffffff',
            minHeight: '32px',
          }}
        >
          {line5Text}
          {currentTypeLine === 4 && (
            <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
          )}
        </div>
      </div>

      {/* CTA */}
      {showCta && (
        <div
          style={{
            position: 'absolute',
            bottom: 'max(60px, env(safe-area-inset-bottom, 20px) + 32px)',
            left: 0,
            right: 0,
            padding: '0 24px',
            opacity: 0,
            animation: 'fadeIn 400ms ease forwards',
            animationDelay: '0ms',
          }}
        >
          <button
            onClick={onFindStyle}
            style={{
              width: '100%',
              padding: '16px 0',
              background: '#22d3ee',
              border: 'none',
              borderRadius: '14px',
              fontSize: '16px',
              fontWeight: 600,
              color: '#0a0f1e',
              cursor: 'pointer',
              transition: 'transform 0.15s ease',
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.97)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            Find my style →
          </button>

          <p
            style={{
              fontSize: '13px',
              color: '#475569',
              textAlign: 'center',
              marginTop: '16px',
              opacity: 0,
              animation: 'fadeIn 400ms ease forwards',
              animationDelay: '200ms',
            }}
          >
            Takes 2 minutes. No account needed.
          </p>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .cursor-blink {
          animation: blink 0.8s ease-in-out infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
