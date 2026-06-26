'use client';

import React, { useEffect, useState, useRef } from 'react';

/* ── Brand identity constants ── */
const GRAD_START = '#22d3ee';
const GRAD_END = '#0e7490';
const RING_COLOR = 'rgba(34,211,238,0.25)';
const PARTICLE_COLOR = '#22d3ee';
const GLOW_COLOR = 'rgba(34,211,238,0.15)';

interface CompassMarkProps {
  size: number;
  showBurst?: boolean;
  idleRotate?: boolean;
  glow?: boolean;
  onBurstComplete?: () => void;
}

export function CompassMark({
  size,
  showBurst = false,
  idleRotate = false,
  glow = false,
  onBurstComplete,
}: CompassMarkProps) {
  const [phase, setPhase] = useState<'idle' | 'bursting' | 'settling' | 'done'>(
    showBurst ? 'bursting' : 'idle',
  );
  const [started, setStarted] = useState(false);
  const burstDoneRef = useRef(false);

  useEffect(() => {
    if (!showBurst) return;
    if (burstDoneRef.current) return;
    burstDoneRef.current = true;

    requestAnimationFrame(() => setStarted(true));

    const settleTimer = setTimeout(() => setPhase('settling'), 600);
    const doneTimer = setTimeout(() => {
      setPhase('done');
      onBurstComplete?.();
    }, 800);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(doneTimer);
    };
  }, [showBurst, onBurstComplete]);

  const isBursting = phase === 'bursting' && started;
  const isSettling = phase === 'settling';
  const isDone = phase === 'done' || (!showBurst && phase === 'idle');
  const shouldRotate = isDone && idleRotate;
  const glowVisible = (isDone || isSettling) && glow;

  /* 8 particle directions */
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const particleLen = size * 0.4;

  /* 4-point star (diamond) in 100×100 viewBox, centered at 50,50 */
  const cx = 50, cy = 50, r = 48;
  // A crisp 4-point star: tip-to-tip N/E/S/W
  const starPath = `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;

  const starAnimStyle: React.CSSProperties = isBursting
    ? { animation: 'compass-burst 600ms ease-out forwards' }
    : isSettling
      ? { transform: 'scale(1.15)', transition: 'none' }
      : shouldRotate
        ? { animation: 'compass-spin 24s linear infinite' }
        : { transform: 'scale(1)' };

  // On settling phase, animate back to 1.0
  if (isSettling) {
    starAnimStyle.animation = 'compass-settle 200ms ease-in-out forwards';
  }

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
      {/* Glow layer — separate blurred div behind everything */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: GLOW_COLOR,
          filter: 'blur(16px)',
          zIndex: 0,
          opacity: glowVisible ? undefined : 0,
          transition: 'opacity 300ms var(--ease-out)',
          animation: glowVisible ? 'compass-breathe 3s ease-in-out infinite' : 'none',
        }}
      />

      {/* Particles — rendered above glow, below star */}
      {showBurst &&
        angles.map((angle, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '2px',
              height: `${particleLen}px`,
              background: PARTICLE_COLOR,
              transformOrigin: 'bottom center',
              transform: `translate(-50%, -100%) rotate(${angle}deg)`,
              opacity: started ? undefined : 0,
              zIndex: 1,
              animation: started
                ? `compass-particle-${i} 500ms ease-out forwards`
                : 'none',
            }}
          />
        ))}

      {/* Star SVG */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          ...starAnimStyle,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          style={{ display: 'block' }}
        >
          <defs>
            <linearGradient id="star-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GRAD_START} />
              <stop offset="100%" stopColor={GRAD_END} />
            </linearGradient>
          </defs>

          {/* Outer ring — stays fixed, no rotation */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={RING_COLOR}
            strokeWidth="1"
          />

          {/* 4-point star */}
          <path
            d={starPath}
            fill="url(#star-grad)"
          />

          {/* Center dot */}
          <circle
            cx={cx}
            cy={cy}
            r="4"
            fill="white"
            opacity="0.9"
          />
        </svg>
      </div>

      <style>{`
        @keyframes compass-burst {
          0%   { transform: scale(0);   opacity: 0; }
          85%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes compass-settle {
          from { transform: scale(1.15); }
          to   { transform: scale(1);    }
        }
        @keyframes compass-spin {
          from { transform: rotate(0deg);   }
          to   { transform: rotate(360deg); }
        }
        @keyframes compass-breathe {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 0.3; }
        }
        ${angles.map((_, i) => `
        @keyframes compass-particle-${i} {
          0%   { opacity: 0.8; transform: translate(-50%, -100%) rotate(${angles[i]}deg) scaleY(0);   }
          50%  { opacity: 0.4; transform: translate(-50%, -100%) rotate(${angles[i]}deg) scaleY(1.3); }
          100% { opacity: 0;   transform: translate(-50%, -100%) rotate(${angles[i]}deg) scaleY(1.5); }
        }
        `).join('')}
      `}</style>
    </div>
  );
}
