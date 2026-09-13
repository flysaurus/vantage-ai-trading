// ─── NetworkIcon — ICON identity mark ───────────────────────────────
// The REDUCED hub-node glyph (1 hub + 3 satellites = 4 nodes) for top-bar
// (44px) and minimal (36px) use. Pure vector, self-contained, no deps.
//
// `badge` (default true) paints the mark on a #17323B rounded chip. This is
// required: the bright teal ramp is a "glow-on-dark" treatment and must not sit
// directly on the light canvas (#F5F7F4) where it would lose contrast. Set
// `badge={false}` only when placing the mark on a surface you have already
// made dark. With badge={false} the colours flip per theme (like NetworkMark).
//
// Same LOCKED teal ramp as NetworkMark / the FULL mark:
//   #9FF0F4 highlight · #0E8C99 accent · #0A5A62 deep · #17323B dark-chip.

import React from 'react';

export interface NetworkIconProps {
  /** Rendered px size (square). Default 44 (the top-bar size). */
  size?: number;
  /** Paint on the dark #17323B chip. Default true. */
  badge?: boolean;
  /**
   * Tightest variant — drops the outer ring, leaving hub + 3 spokes. Opt-in
   * (default false); use only below ~32px where the ring would smear. The
   * default glyph keeps the ring so the constellation identity survives at 36px.
   */
  minimal?: boolean;
  /** Extra class on the root <svg>. */
  className?: string;
  /** Accessible name. When omitted the icon is aria-hidden (decorative). */
  title?: string;
}

/* Reduced 3-satellite (top / lower-left / lower-right) + hub constellation.
 * Recentred so the 100×100 bounding box is optically centred; hub at centroid. */
const SATELLITES = [
  { x: 50, y: 24.5 }, // top
  { x: 79.4, y: 75.5 }, // lower-right
  { x: 20.6, y: 75.5 }, // lower-left
] as const;
const HUB = { x: 50, y: 58.5 } as const;

const SPOKES = SATELLITES.map((n) => ({ x1: HUB.x, y1: HUB.y, x2: n.x, y2: n.y }));
const RING = SATELLITES.map((n, i) => {
  const m = SATELLITES[(i + 1) % SATELLITES.length];
  return { x1: n.x, y1: n.y, x2: m.x, y2: m.y };
});

const ICON_CSS = `
.v-network-icon {
  --ni-edge: rgba(14, 140, 153, 0.50); /* #0E8C99 @ 50% */
  --ni-node: #0E8C99;
  --ni-hub: #0A5A62;
  --ni-chip: transparent;
}
[data-theme='dark'] .v-network-icon {
  --ni-edge: rgba(95, 216, 222, 0.50); /* #5FD8DE @ 50% */
  --ni-node: #5FD8DE;
  --ni-hub: #9FF0F4;
}
/* Badge mode wins over both theme rules (compound selector, declared last):
   the on-chip treatment is the bright ramp on #17323B in BOTH themes. */
.v-network-icon.v-network-icon--badge {
  --ni-edge: rgba(95, 216, 222, 0.50);
  --ni-node: #5FD8DE;
  --ni-hub: #9FF0F4;
  --ni-chip: #17323B;
}
`;

export function NetworkIcon({
  size = 44,
  badge = true,
  minimal = false,
  className,
  title,
}: NetworkIconProps) {
  const classes = ['v-network-icon', badge ? 'v-network-icon--badge' : '', className]
    .filter(Boolean)
    .join(' ');

  // Slightly heavier strokes when minimal so the glyph still reads when tiny.
  const strokeWidth = minimal ? 3.0 : 2.8;

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      <style>{ICON_CSS}</style>

      {/* Dark chip (badge mode only) */}
      <rect x={0} y={0} width={100} height={100} rx={24} fill="var(--ni-chip)" />

      <g stroke="var(--ni-edge)" strokeWidth={strokeWidth} strokeLinecap="round" fill="none">
        {SPOKES.map((s, i) => (
          <line key={`s${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
        {!minimal &&
          RING.map((e, i) => (
            <line key={`r${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          ))}
      </g>

      {SATELLITES.map((n, i) => (
        <circle key={`n${i}`} cx={n.x} cy={n.y} r={9} fill="var(--ni-node)" />
      ))}

      <circle cx={HUB.x} cy={HUB.y} r={13.5} fill="var(--ni-hub)" />
    </svg>
  );
}

export default NetworkIcon;
