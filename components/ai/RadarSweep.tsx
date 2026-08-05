'use client';

// ═══════════════════════════════════════════════════════════════════════════
// RadarSweep — animated loading state for AI Advisor generation
// ═══════════════════════════════════════════════════════════════════════════
//
// Visual: rotating sweep line over a faint grid of dots (candidate universe).
// When screening results arrive, matching dots light up cyan.
// When no screening is happening, the sweep plays ambiently without dot lighting.
// Resolves cleanly into final response or error — no orphaned animation.
//
// Design: frosted glass + cyan (#22d3ee) — pure Vantage.

import { useEffect, useState, useRef, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScreeningDot {
  x: number;        // 0-100 percentage
  y: number;        // 0-100 percentage
  size: number;     // radius in px
  lit: boolean;     // true when a real candidate matches this dot
  symbol?: string;  // ticker if lit
}

export interface RadarSweepProps {
  /** True while AI is generating / screening */
  active: boolean;
  /** Optional screening step label shown below the radar */
  stageLabel?: string;
  /** Optional detail line (e.g. "Screening: Technology, >$10B — 14 matches") */
  stageDetail?: string;
  /** Array of dot positions to light up. If empty/undefined, ambient mode (sweep only). */
  dots?: ScreeningDot[];
  /** Called when the sweep should finish / animation resolves */
  onComplete?: () => void;
  /** Number of background dots in the ambient grid */
  ambientCount?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate pseudo-random ambient dot positions (seeded so they're stable) */
function generateAmbientDots(count: number): ScreeningDot[] {
  const dots: ScreeningDot[] = [];
  // Simple seeded-ish distribution — clustered toward center, edge-sparse
  for (let i = 0; i < count; i++) {
    // Golden-angle spiral distribution for even visual spread
    const angle = i * 2.39996; // golden angle in radians
    const radius = 15 + (i / count) * 38; // 15-53% from center
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius * 0.85; // slight vertical squish
    // Smaller dots toward center, larger toward edge
    const size = 1.0 + (radius / 50) * 2.0;
    dots.push({ x, y, size, lit: false });
  }
  return dots;
}

// ── Component ──────────────────────────────────────────────────────────────

export function RadarSweep({
  active,
  stageLabel,
  stageDetail,
  dots,
  ambientCount = 48,
  onComplete,
}: RadarSweepProps) {
  const [ambientDots] = useState(() => generateAmbientDots(ambientCount));
  const [sweepAngle, setSweepAngle] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // Fade in
  useEffect(() => {
    if (active) {
      setVisible(true);
      setExiting(false);
      const t = setTimeout(() => {}, 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [active]);

  // Continuous sweep rotation via requestAnimationFrame
  useEffect(() => {
    if (!active || exiting) return;
    startTimeRef.current = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      // 3 seconds per full rotation = 120 deg/s
      const angle = (elapsed / 3000) * 360 % 360;
      setSweepAngle(angle);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [active, exiting]);

  // Clean exit when !active
  useEffect(() => {
    if (!active && visible && !exiting) {
      setExiting(true);
      const t = setTimeout(() => {
        setVisible(false);
        setExiting(false);
        onComplete?.();
      }, 500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [active, visible, exiting, onComplete]);

  if (!visible && !active) return null;

  // Merge lit dots over ambient
  const displayDots = [...ambientDots];
  if (dots && dots.length > 0) {
    // Replace ambient dots at matching positions with lit real dots
    for (const rd of dots) {
      // Find nearest ambient dot and replace it
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < displayDots.length; i++) {
        const dx = displayDots[i].x - rd.x;
        const dy = displayDots[i].y - rd.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      displayDots[bestIdx] = { ...rd };
    }
  }

  const svgSize = 280;
  const center = svgSize / 2;
  const gridRadius = center - 20;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
      padding: '24px 0 8px 0',
      opacity: exiting ? 0 : 1,
      transform: exiting ? 'scale(0.95)' : 'scale(1)',
      transition: 'opacity 0.4s ease, transform 0.4s ease',
    }}>
      {/* ── Radar display ── */}
      <div style={{
        position: 'relative',
        width: svgSize,
        height: svgSize,
      }}>
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          style={{ display: 'block' }}
        >
          {/* Background disc */}
          <defs>
            <radialGradient id="radarBg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(34,211,238,0.08)" />
              <stop offset="60%" stopColor="rgba(34,211,238,0.03)" />
              <stop offset="100%" stopColor="rgba(34,211,238,0.0)" />
            </radialGradient>
            <radialGradient id="sweepGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(34,211,238,0.15)" />
              <stop offset="100%" stopColor="rgba(34,211,238,0.0)" />
            </radialGradient>
          </defs>

          {/* Circular field */}
          <circle cx={center} cy={center} r={gridRadius} fill="rgba(255,255,255,0.02)" stroke="rgba(34,211,238,0.1)" strokeWidth="1" />
          <circle cx={center} cy={center} r={gridRadius * 0.66} fill="none" stroke="rgba(34,211,238,0.05)" strokeWidth="0.5" strokeDasharray="4 12" />
          <circle cx={center} cy={center} r={gridRadius * 0.33} fill="none" stroke="rgba(34,211,238,0.04)" strokeWidth="0.5" strokeDasharray="2 10" />

          {/* Crosshairs */}
          <line x1={center} y1={center - gridRadius} x2={center} y2={center + gridRadius} stroke="rgba(34,211,238,0.04)" strokeWidth="0.5" />
          <line x1={center - gridRadius} y1={center} x2={center + gridRadius} y2={center} stroke="rgba(34,211,238,0.04)" strokeWidth="0.5" />

          {/* Ambient / lit dots */}
          {displayDots.map((dot, i) => {
            const px = center + (dot.x - 50) / 50 * gridRadius;
            const py = center + (dot.y - 50) / 50 * gridRadius;
            const isLit = dot.lit;
            return (
              <circle
                key={i}
                cx={px}
                cy={py}
                r={isLit ? dot.size * 1.3 : dot.size}
                fill={isLit ? '#22d3ee' : 'rgba(255,255,255,0.08)'}
                opacity={isLit ? 0.9 : 0.3}
                style={{
                  transition: 'fill 0.6s ease, opacity 0.6s ease, r 0.3s ease',
                }}
              >
                {isLit && (
                  <animate
                    attributeName="opacity"
                    values="0.9;0.4;0.9"
                    dur={`${1.5 + Math.random() * 1.5}s`}
                    repeatCount="indefinite"
                  />
                )}
              </circle>
            );
          })}

          {/* Sweep line */}
          <g transform={`rotate(${sweepAngle}, ${center}, ${center})`}>
            <line
              x1={center}
              y1={center}
              x2={center}
              y2={center - gridRadius}
              stroke="#22d3ee"
              strokeWidth="1.5"
              opacity="0.7"
            />
            {/* Sweep glow */}
            <line
              x1={center}
              y1={center}
              x2={center}
              y2={center - gridRadius}
              stroke="#22d3ee"
              strokeWidth="3"
              opacity="0.15"
              style={{ filter: 'blur(2px)' }}
            />
            {/* Trailing glow */}
            <path
              d={`M ${center} ${center} L ${center} ${center - gridRadius} A ${gridRadius} ${gridRadius} 0 0 1 ${center + gridRadius * Math.sin(0.25)} ${center - gridRadius * Math.cos(0.25)} Z`}
              fill="rgba(34,211,238,0.03)"
            />
          </g>

          {/* Center hub */}
          <circle cx={center} cy={center} r="4" fill="#22d3ee" opacity="0.6">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>

        {/* Overlaid compass rose ticks (CSS, outside SVG for crisp rendering) */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
          <div
            key={deg}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '1px',
              height: deg % 90 === 0 ? '8px' : '4px',
              background: 'rgba(34,211,238,0.25)',
              transform: `rotate(${deg}deg) translateY(-${gridRadius + 7}px)`,
              transformOrigin: '0 0',
            }}
          />
        ))}
      </div>

      {/* ── Stage label ── */}
      {stageLabel && (
        <div style={{
          fontSize: '13px',
          color: 'rgba(34,211,238,0.8)',
          fontWeight: 500,
          letterSpacing: '0.02em',
          textAlign: 'center',
        }}>
          {stageLabel}
        </div>
      )}

      {/* ── Stage detail (real screening results) ── */}
      {stageDetail && (
        <div style={{
          fontSize: '11.5px',
          color: 'rgba(255,255,255,0.45)',
          textAlign: 'center',
          maxWidth: '320px',
          lineHeight: '1.5',
          transition: 'opacity 0.3s ease',
        }}>
          {stageDetail}
        </div>
      )}
    </div>
  );
}
