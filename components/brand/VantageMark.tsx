'use client';

// ─── VantageMark — Constellation Brand Symbol ───────────────
// 5 nodes representing investor archetypes, fully connected.
// Assembly animation on boot splash. Active node glow on
// style reveal. Subtle 60s idle rotation + organic micro-pulse.

import React, { useEffect, useRef, useState } from 'react';

type InvestorStyleKey = 'buffett' | 'lynch' | 'livermore' | 'munger' | 'soros';

/* ── Node positions in 100×100 viewBox ── */
const NODES: Record<InvestorStyleKey, { x: number; y: number }> = {
  buffett:   { x: 50, y: 15 },   // top
  lynch:     { x: 85, y: 38 },   // right top
  livermore: { x: 72, y: 80 },   // right bottom
  munger:    { x: 28, y: 80 },   // left bottom
  soros:     { x: 15, y: 38 },   // left top
};

const STYLE_ORDER: InvestorStyleKey[] = ['buffett', 'lynch', 'livermore', 'munger', 'soros'];

const NODE_COUNT = STYLE_ORDER.length;

/* ── All pairwise connections (10 edges) ── */
const EDGES: [InvestorStyleKey, InvestorStyleKey][] = [];
for (let i = 0; i < NODE_COUNT; i++) {
  for (let j = i + 1; j < NODE_COUNT; j++) {
    EDGES.push([STYLE_ORDER[i], STYLE_ORDER[j]]);
  }
}

const ACCENT = '#22d3ee';
const LINE_COLOR = 'rgba(34,211,238,0.25)';
const NODE_COLOR = 'rgba(34,211,238,0.6)';
const HALO_COLOR = 'rgba(34,211,238,0.1)';

interface VantageMarkProps {
  size: number;
  activeStyle?: InvestorStyleKey;
  animate?: boolean;
  showBurst?: boolean;
  onBurstComplete?: () => void;
}

export function VantageMark({
  size,
  activeStyle,
  animate = false,
  showBurst = false,
  onBurstComplete,
}: VantageMarkProps) {
  const [assemblyPhase, setAssemblyPhase] = useState<'idle' | 'lines' | 'nodes' | 'center' | 'done'>(
    showBurst ? 'lines' : 'done',
  );
  const burstDoneRef = useRef(false);

  // ── Assembly animation ──────────────────────────────────

  useEffect(() => {
    if (!showBurst) return;
    if (burstDoneRef.current) return;
    burstDoneRef.current = true;

    // Phase 1: lines draw in (0-600ms, 10 lines × 60ms stagger = 600ms)
    const nodeTimer = setTimeout(() => setAssemblyPhase('nodes'), 600);

    // Phase 2: nodes pop in (600-900ms, 5 nodes × 80ms stagger = 400ms)
    const centerTimer = setTimeout(() => setAssemblyPhase('center'), 900);

    // Phase 3: center diamond (900ms → 1100ms)
    const doneTimer = setTimeout(() => {
      setAssemblyPhase('done');
      onBurstComplete?.();
    }, 1100);

    return () => {
      clearTimeout(nodeTimer);
      clearTimeout(centerTimer);
      clearTimeout(doneTimer);
    };
  }, [showBurst, onBurstComplete]);

  const isBursting = assemblyPhase !== 'done';

  // ── Active style glow ───────────────────────────────────

  const activeCoords = activeStyle ? NODES[activeStyle] : null;

  // ── Render ──────────────────────────────────────────────

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{
          display: 'block',
          animation: animate && !isBursting
            ? 'vantage-spin 60s linear infinite'
            : 'none',
        }}
      >
        <defs>
          {/* Glow filter for active node */}
          <filter id="vantage-node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Connection lines ── */}
        {EDGES.map(([a, b], i) => {
          const from = NODES[a];
          const to = NODES[b];

          // Line length for stroke-dasharray/dashoffset
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.sqrt(dx * dx + dy * dy);

          const linePhase = showBurst && assemblyPhase === 'lines';
          const LINE_DURATION = 120;    // ms per line
          const LINE_STAGGER = 60;      // ms stagger

          return (
            <line
              key={`${a}-${b}`}
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke={LINE_COLOR}
              strokeWidth={0.5}
              strokeLinecap="round"
              strokeDasharray={len}
              strokeDashoffset={linePhase ? undefined : 0}
              opacity={linePhase ? undefined : 1}
              style={
                linePhase
                  ? {
                      animation: `vantage-line-draw-${i} ${LINE_DURATION}ms ease-out forwards`,
                      animationDelay: `${i * LINE_STAGGER}ms`,
                    }
                  : undefined
              }
            />
          );
        })}

        {/* ── Nodes (circles) ── */}
        {STYLE_ORDER.map((style, i) => {
          const pos = NODES[style];
          const isActive = activeStyle === style;

          const nodePhase = showBurst && assemblyPhase === 'nodes';
          const NODE_DURATION = 60;     // ms per node
          const NODE_STAGGER = 80;      // ms stagger

          return (
            <g key={style}>
              {/* Outer halo */}
              <circle
                cx={pos.x} cy={pos.y}
                r={isActive ? 12 : 6}
                fill={HALO_COLOR}
                style={
                  nodePhase
                    ? {
                        animation: `vantage-node-pop-${i} ${NODE_DURATION}ms var(--ease-spring) forwards`,
                        animationDelay: `${i * NODE_STAGGER}ms`,
                      }
                    : isActive
                      ? {
                          animation: 'vantage-node-pulse 3s ease-in-out infinite',
                          opacity: 0.3,
                        }
                      : undefined
                }
              />

              {/* Core node */}
              <circle
                cx={pos.x} cy={pos.y}
                r={isActive ? 5 : 3}
                fill={isActive ? ACCENT : NODE_COLOR}
                filter={isActive ? 'url(#vantage-node-glow)' : undefined}
                style={
                  nodePhase
                    ? {
                        animation: `vantage-node-pop-${i} ${NODE_DURATION}ms var(--ease-spring) forwards`,
                        animationDelay: `${i * NODE_STAGGER}ms`,
                      }
                    : isActive
                      ? {
                          animation: 'vantage-node-active-pulse 3s ease-in-out infinite',
                        }
                      : animate
                        ? {
                            animation: `vantage-node-micro-${i} ${3 + (i % 3)}s ease-in-out ${i * 0.7}s infinite`,
                          }
                        : undefined
                }
              />
            </g>
          );
        })}

        {/* ── Center diamond ("you" marker) ── */}
        {assemblyPhase === 'center' ? (
          <g>
            <polygon
              points="50,47 53,50 50,53 47,50"
              fill={ACCENT}
              style={{
                animation: 'vantage-center-pop 200ms var(--ease-spring) forwards',
              }}
            />
          </g>
        ) : assemblyPhase === 'done' || !showBurst ? (
          <polygon
            points="50,47 53,50 50,53 47,50"
            fill={ACCENT}
            opacity={0.9}
          />
        ) : null}
      </svg>

      {/* ── CSS Keyframes ── */}
      <style>{`
        /* Idle spin — 60s revolution, imperceptibly slow */
        @keyframes vantage-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        /* Line draw-in */
        ${EDGES.map((_, i) => `
        @keyframes vantage-line-draw-${i} {
          0%   { stroke-dashoffset: var(--line-len); }
          100% { stroke-dashoffset: 0; }
        }
        `).join('')}

        /* Node pop-in: 0 → 1.2 → 1.0, spring easing */
        ${STYLE_ORDER.map((_, i) => `
        @keyframes vantage-node-pop-${i} {
          0%   { transform-origin: center; transform: scale(0); opacity: 0; }
          70%  { transform-origin: center; transform: scale(1.2); opacity: 1; }
          100% { transform-origin: center; transform: scale(1);   opacity: 1; }
        }
        `).join('')}

        /* Center diamond pop-in */
        @keyframes vantage-center-pop {
          0%   { transform-origin: 50px 50px; transform: scale(0); opacity: 0; }
          70%  { transform-origin: 50px 50px; transform: scale(1.3); opacity: 1; }
          100% { transform-origin: 50px 50px; transform: scale(1);   opacity: 0.9; }
        }

        /* Active node micro-pulse: radius breathes 5→7→5 */
        @keyframes vantage-node-active-pulse {
          0%, 100% { r: 5; }
          50%      { r: 7; }
        }

        /* Active halo pulse: opacity breathes 0.1→0.3→0.1 */
        @keyframes vantage-node-pulse {
          0%, 100% { opacity: 0.1; }
          50%      { opacity: 0.3; }
        }

        /* Idle micro-pulse per node: organic opacity breathing */
        ${STYLE_ORDER.map((_, i) => `
        @keyframes vantage-node-micro-${i} {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 0.9; }
        }
        `).join('')}
      `}</style>
    </div>
  );
}
