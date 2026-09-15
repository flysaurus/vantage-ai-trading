'use client';

// ─── ScatterChart — return (x) vs sector risk proxy (y) ──────────
// The y-axis is a SECTOR-LEVEL risk proxy, not beta and not position-level
// precision — the axis label and the footnote say so explicitly.
//
// No number is formatted here: the tooltip renders the server's preformatted
// `xDisplay` / `yDisplay` / `sizeDisplay`. Plot coordinates come from the
// numeric fields unchanged.

import {
  ScatterChart as RScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface ScatterPoint {
  symbol: string;
  x: number;
  y: number;
  size: number;
  xDisplay?: string;
  yDisplay?: string;
  sizeDisplay?: string;
}

export default function ScatterChart({
  points,
  xLabel,
  yLabel,
}: {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
}) {
  if (!points || points.length === 0) return null;

  const riskAxisLabel = yLabel ?? 'risk proxy (sector-based)';

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as ScatterPoint;
    if (!p) return null;
    return (
      <div
        style={{
          background: 'var(--v-panel)',
          border: '1px solid var(--v-card-border)',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 11,
          color: 'var(--v-text-primary)',
        }}
      >
        <div style={{ fontWeight: 600 }}>{p.symbol}</div>
        <div style={{ color: 'var(--v-text-secondary)' }}>
          {xLabel ?? 'return'} {p.xDisplay ?? ''}
        </div>
        <div style={{ color: 'var(--v-text-secondary)' }}>
          risk proxy {p.yDisplay ?? ''} · {p.sizeDisplay ?? ''} of account
        </div>
      </div>
    );
  };
  CustomTooltip.displayName = 'ScatterTooltip';

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
          <CartesianGrid stroke="var(--v-rule)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel ?? 'return'}
            tick={{ fill: 'var(--v-text-faint)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={riskAxisLabel}
            tick={{ fill: 'var(--v-text-faint)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={78}
            label={{
              value: riskAxisLabel,
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'var(--v-text-secondary)', fontSize: 10, textAnchor: 'middle' },
            }}
          />
          <ZAxis type="number" dataKey="size" range={[40, 380]} name="% of account" />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '4 3' }} />
          <Scatter data={points as any} fill="var(--v-accent)" fillOpacity={0.8} isAnimationActive={false} />
        </RScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
