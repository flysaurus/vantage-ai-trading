'use client';

// ─── DonutChart — composition ring + legend ──────────────────────
// Built on the shared DonutRing (extracted from the insights card). Colour is
// assigned by the server resolver from --v-* tokens; this component only lays
// out the ring + legend.

import DonutRing, { type DonutRingSlice } from './DonutRing';

/** Ring geometry needs `pct`; the legend renders the SERVER's `pctDisplay`. */
export interface DonutChartSlice extends DonutRingSlice {
  pctDisplay: string;
}

export default function DonutChart({
  slices,
  size = 92,
  stroke = 12,
}: {
  slices: DonutChartSlice[];
  size?: number;
  stroke?: number;
}) {
  if (!slices || slices.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <DonutRing slices={slices} size={size} stroke={stroke} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
        {slices.slice(0, 7).map((s, i) => (
          <div
            key={s.symbol ?? s.label ?? i}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
          >
            <span
              style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }}
            />
            <span
              style={{
                color: 'var(--v-text-primary)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 120,
              }}
            >
              {s.label ?? s.symbol}
            </span>
            <span style={{ color: 'var(--v-text-secondary)', marginLeft: 'auto' }}>
              {s.pctDisplay}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
