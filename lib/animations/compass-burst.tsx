// ─── CompassBurst Animation ─────────────────────────────────
// Plays a compass rose burst animation once on mount.
// Compass scales in with particle lines shooting outward
// in 8 directions, then settles with a slow rotation.

'use client';

import React, { useEffect, useState } from 'react';

interface CompassBurstProps {
  size?: number;
  particleLength?: number;
  onComplete?: () => void;
}

export function CompassBurst({
  size = 80,
  particleLength = 60,
  onComplete,
}: CompassBurstProps) {
  const [phase, setPhase] = useState<'burst' | 'rest' | 'settled'>('burst');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    // Trigger burst on next frame for CSS animation to pick up
    requestAnimationFrame(() => setStarted(true));
    const t1 = setTimeout(() => setPhase('rest'), 800);
    const t2 = setTimeout(() => {
      setPhase('settled');
      onComplete?.();
    }, 1200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onComplete]);

  const directions = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Particle lines */}
      {directions.map((angle, i) => (
        <div
          key={i}
          className={started ? 'compass-particle-active' : ''}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '2px',
            height: `${particleLength}px`,
            background: '#22d3ee',
            transformOrigin: 'bottom center',
            transform: `translate(-50%, -100%) rotate(${angle}deg)`,
            opacity: started ? undefined : 0,
            animation: started ? `compass-${i}-shoot 600ms ease-out forwards` : 'none',
          }}
        />
      ))}

      {/* Compass rose SVG */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        className={started ? 'compass-animate' : ''}
        style={{
          position: 'relative',
          zIndex: 1,
          transform: 'scale(1.2)',
          opacity: 1,
          filter: 'drop-shadow(0 0 20px rgba(34,211,238,0.3))',
          transition: 'transform 200ms ease-in-out',
        }}
      >
        <circle cx="32" cy="32" r="28" fill="none" stroke="#22d3ee" strokeWidth="1.2" opacity="0.3" />
        <line x1="32" y1="4" x2="32" y2="60" stroke="#22d3ee" strokeWidth="1.5" opacity="0.6" />
        <line x1="4" y1="32" x2="60" y2="32" stroke="#22d3ee" strokeWidth="1.5" opacity="0.6" />
        <line x1="12" y1="12" x2="52" y2="52" stroke="#22d3ee" strokeWidth="0.8" opacity="0.25" />
        <line x1="52" y1="12" x2="12" y2="52" stroke="#22d3ee" strokeWidth="0.8" opacity="0.25" />
        <polygon points="32,10 28,18 36,18" fill="#22d3ee" opacity="0.9" />
        <polygon points="32,54 28,46 36,46" fill="#22d3ee" opacity="0.3" />
        <circle cx="32" cy="32" r="2.5" fill="#22d3ee" />
      </svg>

      <style>{`
        @keyframes compassSettle {
          0% { transform: scale(1.2); }
          100% { transform: scale(1) rotate(15deg); }
        }
        .compass-animate {
          animation: compassSettle 600ms ease-out forwards;
        }
        @keyframes compass-0-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(0deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(0deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(0deg) scaleY(1.5); }
        }
        @keyframes compass-1-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(45deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(45deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(45deg) scaleY(1.5); }
        }
        @keyframes compass-2-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(90deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(90deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(90deg) scaleY(1.5); }
        }
        @keyframes compass-3-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(135deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(135deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(135deg) scaleY(1.5); }
        }
        @keyframes compass-4-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(180deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(180deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(180deg) scaleY(1.5); }
        }
        @keyframes compass-5-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(225deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(225deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(225deg) scaleY(1.5); }
        }
        @keyframes compass-6-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(270deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(270deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(270deg) scaleY(1.5); }
        }
        @keyframes compass-7-shoot {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(315deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(315deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(315deg) scaleY(1.5); }
        }
      `}</style>
    </div>
  );
}
