'use client';

// ─── PositionDetailChart ────────────────────────────────────
// Inline SVG 52-week close-price line/area chart for the canonical
// Position Detail screen. Pure presentational; the geometry mirrors the
// approved PositionCardV3 sparkline but is restyled with --v-* theme tokens
// (light/dark safe). No interaction — the detail screen is a static read view.

import React from 'react';

export interface SparkPoint {
  t: number; // epoch seconds
  c: number; // close
}

interface PositionDetailChartProps {
  symbol: string;
  points: SparkPoint[];
  high52w?: number | null;
  low52w?: number | null;
  current?: number | null;
}

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PositionDetailChart({ symbol, points, high52w, low52w, current }: PositionDetailChartProps) {
  if (!points || points.length < 2) return null;

  const W = 320;
  const H = 120;
  const pad = 6;

  const closes = points.map((p) => p.c);
  const yMin = low52w != null && low52w > 0 ? low52w : Math.min(...closes);
  const yMax = high52w != null && high52w > 0 ? high52w : Math.max(...closes);
  const yRange = yMax - yMin || 1;

  const scaleX = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const scaleY = (v: number) => H - pad - ((v - yMin) / yRange) * (H - pad * 2);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(2)},${scaleY(p.c).toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L${scaleX(points.length - 1).toFixed(2)},${(H - pad).toFixed(2)} L${scaleX(0).toFixed(2)},${(H - pad).toFixed(2)} Z`;

  const lastC = current != null ? current : closes[closes.length - 1];
  const curX = scaleX(points.length - 1);
  const curY = scaleY(lastC);

  const gradId = `pdGrad-${symbol.replace(/[^A-Za-z0-9]/g, '')}`;

  const caption: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--v-text-muted)',
    letterSpacing: '0.01em',
  };

  return (
    <div data-testid="position-detail-chart" style={{ margin: '18px 20px 0' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: 'var(--v-text-muted)',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        52-WEEK PRICE
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 120, display: 'block' }}
        role="img"
        aria-label={`${symbol} 52-week price chart`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--v-accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--v-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--v-accent)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={curX} cy={curY} r={3} fill="var(--v-accent)" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={caption}>52W low {fmt(yMin)}</span>
        <span style={caption}>52W high {fmt(yMax)}</span>
      </div>
    </div>
  );
}

export default PositionDetailChart;
