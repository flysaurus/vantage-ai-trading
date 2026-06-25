// ─── VantageOrb — Living Glowing Sphere ────────────────────
// Five-layer radial orb with breathing pulse, specular
// highlight, entrance animation. Replaces VantageMark for all
// large-mark moments (boot splash hero, feature splash).
//
// Layers (back → front):
//   1. Background bloom — 320px soft radial, breathe 4s
//   2. Outer soft ring — 260px gradient ring
//   3. Main orb body — 180px sphere with cyan depths
//   4. Specular highlight — 60px bright spot top-left
//   5. Inner glow rim — 180px border with inset glow

'use client';

import React, { useEffect, useRef, useState } from 'react';

interface VantageOrbProps {
  size?: number;       // scales proportionally, default 260
  animate?: boolean;   // idle pulse
  showEntrance?: boolean;
  onEntranceComplete?: () => void;
}

const BASE = 260; // base size all measurements derive from

export function VantageOrb({
  size = BASE,
  animate = true,
  showEntrance = false,
  onEntranceComplete,
}: VantageOrbProps) {
  const scale = size / BASE;
  const [entered, setEntered] = useState(!showEntrance);
  const entranceFired = useRef(false);

  useEffect(() => {
    if (!showEntrance || entranceFired.current) return;
    entranceFired.current = true;

    const t = setTimeout(() => {
      setEntered(true);
      onEntranceComplete?.();
    }, 800);
    return () => clearTimeout(t);
  }, [showEntrance, onEntranceComplete]);

  const s = (v: number) => v * scale;

  // Layer entrance stagger (applied via CSS animation-delay)
  const layerBaseStyle = (delay: number): React.CSSProperties => ({
    opacity: entered ? 1 : 0,
    transform: entered ? 'scale(1)' : 'scale(0)',
    transition: `opacity 500ms cubic-bezier(0.34,1.56,0.64,1), transform 500ms cubic-bezier(0.34,1.56,0.64,1)`,
    transitionDelay: `${delay}ms`,
  });

  return (
    <div
      style={{
        width: s(260),
        height: s(260),
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Layer 1 — Background bloom */}
      <div
        style={{
          position: 'absolute',
          width: s(320),
          height: s(320),
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(34,211,238,0.25) 0%, rgba(14,116,144,0.12) 40%, transparent 70%)`,
          filter: 'blur(24px)',
          animation: animate && entered ? 'orb-breathe 4s ease-in-out infinite' : 'none',
          ...layerBaseStyle(0),
        }}
      />

      {/* Layer 2 — Outer soft ring */}
      <div
        style={{
          position: 'absolute',
          width: s(260),
          height: s(260),
          borderRadius: '50%',
          background: `radial-gradient(circle, transparent 45%, rgba(34,211,238,0.15) 60%, rgba(34,211,238,0.08) 75%, transparent 85%)`,
          ...layerBaseStyle(100),
        }}
      />

      {/* Layer 5 — Inner glow rim (rendered BEFORE orb body so border sits under specular) */}
      <div
        style={{
          position: 'absolute',
          width: s(180),
          height: s(180),
          borderRadius: '50%',
          border: '1px solid rgba(34,211,238,0.60)',
          boxShadow: `inset 0 0 ${s(20)}px rgba(34,211,238,0.20)`,
          ...layerBaseStyle(300),
        }}
      />

      {/* Layer 3 — Main orb body */}
      <div
        style={{
          position: 'absolute',
          width: s(180),
          height: s(180),
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.95) 0%, rgba(186,230,253,0.90) 12%, rgba(34,211,238,0.85) 28%, rgba(14,116,144,0.80) 50%, rgba(8,61,90,0.90) 72%, rgba(2,20,40,0.95) 100%)`,
          boxShadow: entered
            ? `0 0 ${s(40)}px rgba(34,211,238,0.60), 0 0 ${s(80)}px rgba(34,211,238,0.35), 0 0 ${s(140)}px rgba(34,211,238,0.18), inset 0 0 ${s(30)}px rgba(255,255,255,0.15)`
            : 'none',
          animation: animate && entered ? `orb-pulse 3s ease-in-out infinite` : 'none',
          ...layerBaseStyle(200),
        }}
      />

      {/* Layer 4 — Specular highlight (min 16px for small sizes) */}
      <div
        style={{
          position: 'absolute',
          width: Math.max(s(60), 16),
          height: Math.max(s(60), 16),
          borderRadius: '50%',
          top: s(32) * (Math.max(s(60), 16) / s(60)),
          left: s(38) * (Math.max(s(60), 16) / s(60)),
          background: `radial-gradient(circle, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0.40) 40%, transparent 70%)`,
          filter: `blur(${Math.max(4 * scale, 1.5)}px)`,
          ...layerBaseStyle(400),
        }}
      />

      {/* ── Keyframes ── */}
      <style>{`
        @keyframes orb-breathe {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50%      { transform: scale(1.08); opacity: 1; }
        }

        @keyframes orb-pulse {
          0%, 100% {
            box-shadow:
              0 0 ${s(40)}px rgba(34,211,238,0.60),
              0 0 ${s(80)}px rgba(34,211,238,0.35),
              0 0 ${s(140)}px rgba(34,211,238,0.18),
              inset 0 0 ${s(30)}px rgba(255,255,255,0.15);
          }
          50% {
            box-shadow:
              0 0 ${s(60)}px rgba(34,211,238,0.80),
              0 0 ${s(120)}px rgba(34,211,238,0.45),
              0 0 ${s(200)}px rgba(34,211,238,0.25),
              inset 0 0 ${s(40)}px rgba(255,255,255,0.20);
          }
        }
      `}</style>
    </div>
  );
}
