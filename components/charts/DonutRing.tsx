'use client';

// ─── DonutRing — the generic SVG ring ────────────────────────────
// Extracted from components/insights/InsightCard.tsx (line ~59) so the insights
// card and the chat charts share ONE implementation. Geometry is unchanged.
//
// The ring is data-generic: it renders whatever slice list it is handed.

export interface DonutRingSlice {
  /** Preferred key/label (the insights card passes `symbol`). */
  symbol?: string;
  label?: string;
  pct: number;
  color: string;
}

export default function DonutRing({
  slices,
  size,
  stroke,
}: {
  slices: DonutRingSlice[];
  size: number;
  stroke: number;
}) {
  const box = 80;
  const R = (box - stroke) / 2 - 1;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <g transform={`rotate(-90 ${box / 2} ${box / 2})`}>
        {slices.map((s, i) => {
          const len = (s.pct / 100) * C;
          const el = (
            <circle
              key={s.symbol ?? s.label ?? i}
              cx={box / 2}
              cy={box / 2}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </g>
    </svg>
  );
}
