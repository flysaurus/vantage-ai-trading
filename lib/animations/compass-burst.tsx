// ─── CompassBurst Animation ─────────────────────────────────
// Plays a compass rose burst animation once on mount.
// Compass scales in with particle lines shooting outward
// in 8 directions, then settles with a slow rotation.

'use client';

import React, { useEffect, useState } from 'react';
import { NetworkMark } from '@/components/brand/NetworkMark';

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
            background: 'var(--v-orb-node)',
            transformOrigin: 'bottom center',
            transform: `translate(-50%, -100%) rotate(${angle}deg)`,
            opacity: started ? undefined : 0,
            animation: started ? `compass-${i}-shoot 600ms ease-out forwards` : 'none',
          }}
        />
      ))}

      {/* Compass rose SVG */}
      <NetworkMark size={Math.round(size * 0.75)} />

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
