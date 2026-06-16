// ─── CompassMark ────────────────────────────────────────────
// Filled compass rose brand mark. Replaces the old thin-ring +
// needle icon. Used across Boot Splash, Feature Splash, and
// Arrival Screen as the visual thread.
//
// SVG: 4 long primary points (N/E/S/W) + 4 short secondary
// points (NE/SE/SW/NW). Linear gradient fill #22d3ee → #0e7490.
// Outer ring 1px rgba(34,211,238,0.25). Center dot 6px white.
//
// Props:
//   size           px, controls width/height
//   showBurst      play burst-in on mount (scale 0→1.15→1.0 + particles)
//   idleRotate     continuous slow rotation after settling (24s/rev)
//   glow           radial blur behind shape
//   onBurstComplete   callback when burst finishes

'use client';

import React, { useEffect, useState, useRef } from 'react';

/* ── Brand gradient definition ──
   This is the literal brand color definition — the one acceptable
   hex usage outside tokens since it defines the brand identity. */
const BRAND_GRADIENT_START = '#22d3ee';
const BRAND_GRADIENT_END = '#0e7490';
const BRAND_RING = 'rgba(34,211,238,0.25)';
const BRAND_PARTICLE = '#22d3ee';
const BRAND_GLOW = 'rgba(34,211,238,0.35)';

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
  const [burstPhase, setBurstPhase] = useState<'idle' | 'bursting' | 'settling' | 'done'>(
    showBurst ? 'bursting' : 'idle',
  );
  const [started, setStarted] = useState(false);

  // Trigger burst animation
  useEffect(() => {
    if (!showBurst) return;

    requestAnimationFrame(() => setStarted(true));

    // Phase: burst 0-600ms
    const settle = setTimeout(() => setBurstPhase('settling'), 600);
    // Phase: settling 600-800ms
    const done = setTimeout(() => {
      setBurstPhase('done');
      onBurstComplete?.();
    }, 800);

    return () => {
      clearTimeout(settle);
      clearTimeout(done);
    };
  }, [showBurst, onBurstComplete]);

  const isBursting = burstPhase === 'bursting' && started;
  const isSettling = burstPhase === 'settling';
  const isDone = burstPhase === 'done' || (!showBurst && burstPhase === 'idle');

  // 8 directions for particles (one per rose point)
  const particleAngles = [0, 45, 90, 135, 180, 225, 270, 315];
  // Which are primary (long) vs secondary (short) — matching rose points
  const isPrimaryDirection = [true, false, true, false, true, false, true, false];

  const particleLen = size * 0.4;

  // SVG rose path: 8-point star
  // Center at (32,32) in 64x64 viewBox
  const cx = 32, cy = 32;
  const outerR = 28;    // tip of primary points
  const innerR = 13;    // tip of secondary points

  const rosePath = `
    M ${cx} ${cy - outerR}
    L ${cx + innerR * 0.7} ${cy - innerR * 0.7}
    L ${cx + outerR} ${cy}
    L ${cx + innerR * 0.7} ${cy + innerR * 0.7}
    L ${cx} ${cy + outerR}
    L ${cx - innerR * 0.7} ${cy + innerR * 0.7}
    L ${cx - outerR} ${cy}
    L ${cx - innerR * 0.7} ${cy - innerR * 0.7}
    Z
  `;

  // Scale animation values
  const scale = isBursting ? 'var(--burst-scale, 1.15)' : isSettling ? 1.15 : 1;
  const opacity = isBursting ? 1 : 1;
  const compScale = isBursting ? 1.15 : isSettling ? 1.15 : 1;
  const compOpacity = isBursting ? 1 : 1;

  // glow appears after burst completes
  const glowOpacity = ((isDone || isSettling) && glow) ? 0.35 : 0;

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
      {/* Radial glow behind shape */}
      {glow && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${BRAND_GLOW}, transparent 70%)`,
            filter: 'blur(24px)',
            opacity: isBursting
              ? 0
              : isSettling
                ? 0.18
                : glowOpacity,
            transition: 'opacity 300ms ease',
          }}
        />
      )}

      {/* Particle lines (burst phase only) */}
      {showBurst &&
        particleAngles.map((angle, i) => {
          const isPrimary = isPrimaryDirection[i];
          const length = isPrimary ? particleLen : particleLen * 0.65;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: '2px',
                height: `${length}px`,
                background: BRAND_PARTICLE,
                transformOrigin: 'bottom center',
                transform: `translate(-50%, -100%) rotate(${angle}deg)`,
                opacity: started ? undefined : 0,
                animation: started
                  ? `compass-particle-${i} 500ms ease-out forwards`
                  : 'none',
              }}
            />
          );
        })}

      {/* Compass rose SVG */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          // No inline transform when CSS animation is running
          // (CSS animation overrides would need !important otherwise)
          transform: isBursting
            ? undefined
            : isSettling
              ? `scale(1.15)`
              : `scale(1)`,
          opacity: isBursting ? undefined : 1,
          transition: isBursting
            ? undefined
            : 'transform 400ms ease-in-out, opacity 300ms ease',
          animation: isBursting
            ? `compass-burst-in 600ms ease-out forwards`
            : isDone && idleRotate
              ? 'compass-idle-rotate 24s linear infinite'
              : undefined,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          style={{ display: 'block' }}
        >
          <defs>
            <linearGradient id="compass-rose-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND_GRADIENT_START} />
              <stop offset="100%" stopColor={BRAND_GRADIENT_END} />
            </linearGradient>
          </defs>

          {/* Outer thin ring */}
          <circle
            cx={cx}
            cy={cy}
            r={outerR}
            fill="none"
            stroke={BRAND_RING}
            strokeWidth="1"
          />

          {/* Filled 8-point rose */}
          <path
            d={rosePath}
            fill="url(#compass-rose-grad)"
            opacity="0.92"
          />

          {/* Center dot */}
          <circle
            cx={cx}
            cy={cy}
            r="3"
            fill="rgba(255,255,255,0.9)"
          />
        </svg>
      </div>

      <style>{`
        @keyframes compass-burst-in {
          0% { transform: scale(0); opacity: 0; }
          85% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes compass-idle-rotate {
          from { transform: scale(1) rotate(0deg); }
          to { transform: scale(1) rotate(360deg); }
        }
        /* Particle keyframes — one per direction to avoid CSS var transform conflicts */
        @keyframes compass-particle-0 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(0deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(0deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(0deg) scaleY(1.5); }
        }
        @keyframes compass-particle-1 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(45deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(45deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(45deg) scaleY(1.5); }
        }
        @keyframes compass-particle-2 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(90deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(90deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(90deg) scaleY(1.5); }
        }
        @keyframes compass-particle-3 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(135deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(135deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(135deg) scaleY(1.5); }
        }
        @keyframes compass-particle-4 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(180deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(180deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(180deg) scaleY(1.5); }
        }
        @keyframes compass-particle-5 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(225deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(225deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(225deg) scaleY(1.5); }
        }
        @keyframes compass-particle-6 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(270deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(270deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(270deg) scaleY(1.5); }
        }
        @keyframes compass-particle-7 {
          0% { opacity: 0.8; transform: translate(-50%, -100%) rotate(315deg) scaleY(0); }
          50% { opacity: 0.4; transform: translate(-50%, -100%) rotate(315deg) scaleY(1.3); }
          100% { opacity: 0; transform: translate(-50%, -100%) rotate(315deg) scaleY(1.5); }
        }
      `}</style>
    </div>
  );
}
