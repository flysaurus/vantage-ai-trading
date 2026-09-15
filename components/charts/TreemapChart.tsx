'use client';

// ─── TreemapChart — composition with a second dimension ──────────
// recharts <Treemap> (already a dependency). Node colour = the sign of the
// position's P&L (gain/loss/flat), so value AND direction read at a glance.

import { Treemap, ResponsiveContainer } from 'recharts';

export interface TreemapNode {
  name: string;
  label?: string;
  size: number;
  pct: number;
  /** Server-preformatted, e.g. "21%". Rendered verbatim. */
  pctDisplay?: string;
  pnlPct?: number;
  colorSign: 'gain' | 'loss' | 'flat';
}

const SIGN_FILL: Record<string, string> = {
  gain: 'var(--v-hero-gain)',
  loss: 'var(--v-hero-loss)',
  flat: 'var(--v-text-faint)',
};

// NOTE: recharts passes each node's fields as DIRECT props on the content element
// (name/size/pctDisplay/colorSign/...) — it does NOT wrap them in `payload`.
// Reading `payload.*` silently yields undefined: sign falls back to 'flat' (so every
// tile renders the same grey) and pctDisplay renders as an empty string.
function Tile(props: any) {
  const { x, y, width, height, name } = props;
  // Depth 0 is the synthetic root node recharts adds for a flat node list: it spans
  // the whole chart area and, painted at 0.3 opacity, darkens every tile underneath
  // it (the labels lose ~5:1 of contrast). The root carries no data, so skip it.
  if (props.depth === 0) return null;
  const sign = (props.colorSign as string) || (props.payload?.colorSign as string) || 'flat';
  const fill = SIGN_FILL[sign] || SIGN_FILL.flat;
  const pctDisplay = props.pctDisplay ?? props.payload?.pctDisplay ?? '';
  const showName = width > 44 && height > 22;
  const showPct = width > 44 && height > 38;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        rx={3}
        ry={3}
        style={{ fill, fillOpacity: 0.3, stroke: 'var(--v-card-border)', strokeWidth: 1 }}
      />
      {showName && (
        // Fill goes through the style prop (verified equivalent to the attribute form:
        // Chrome resolves var() in presentation attributes too — measured identical
        // computed styles — but style keeps the token in one place with the other props).
        <text
          x={x + 6}
          y={y + 15}
          style={{ fontSize: 11, fontWeight: 600, fill: 'var(--v-text-primary)' }}
        >
          {name}
        </text>
      )}
      {showPct && (
        // Same token as the name on purpose: the tile fill is a translucent accent,
        // so any dimmer secondary token drops under AA on it. Hierarchy comes from
        // size/weight, not from contrast (house rule in app/theme.css).
        <text x={x + 6} y={y + 28} style={{ fontSize: 10, fill: 'var(--v-text-primary)', opacity: 0.85 }}>
          {pctDisplay}
        </text>
      )}
    </g>
  );
}

export default function TreemapChart({ nodes }: { nodes: TreemapNode[] }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={nodes as any}
          dataKey="size"
          nameKey="name"
          aspectRatio={4 / 3}
          stroke="var(--v-card-border)"
          content={<Tile />}
          isAnimationActive={false}
        />
      </ResponsiveContainer>
    </div>
  );
}
