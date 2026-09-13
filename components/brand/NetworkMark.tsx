// ─── NetworkMark — MEDIUM identity mark ─────────────────────────────
// Lightweight, static SVG network/constellation mark (1 hub + 5 satellites)
// for arrival screens and static card contexts. Scales cleanly ~48–120px.
// Pure vector: NO WebGL, no animation, no external dependencies.
//
// Same "network / constellation" identity as the FULL mark sources
// (`components/brand/VantageOrb.tsx`, `components/ai/core/core-engine.ts`)
// and the legacy `VantageMark` archetype pentagon — simplified to a single
// flat SVG so it renders anywhere (server component, static card, arrival).
//
// Colours come from the LOCKED teal ramp (qa-agent/design-tokens-context.md):
//   #9FF0F4 highlight · #0E8C99 accent · #0A5A62 deep · #17323B dark-chip.
// The flat tiers live in app/theme.css as the orb family (`--v-orb-node`,
// `--v-orb-hub`, `--v-orb-edge`) — reconciled with the `--v-orb` gradient, one
// source of truth, no per-theme pair hardcoded here. Theme is read off the
// <html data-theme> attribute by those tokens. The mapping inverts LUMINANCE per
// theme (deepest element on the light canvas, brightest on the dark canvas) so
// the mark keeps the same visual weight in both.

import React from 'react';

export interface NetworkMarkProps {
  /** Rendered px size (square). Default 96 — the top of the MEDIUM band. */
  size?: number;
  /** Extra class on the root <svg>. */
  className?: string;
  /** Accessible name. When omitted the mark is aria-hidden (decorative). */
  title?: string;
}

/* 5 satellites on a vertical-symmetric pentagon (same family as the legacy
 * VantageMark archetype symbols), recentred so the 100×100 bounding box is
 * optically centred, plus the hub at the pentagon centroid. */
const NODES = [
  { x: 50, y: 14 }, // top
  { x: 84, y: 40 }, // upper-right
  { x: 71, y: 86 }, // lower-right
  { x: 29, y: 86 }, // lower-left
  { x: 16, y: 40 }, // upper-left
] as const;

const HUB = { x: 50, y: 53 } as const;

const SPOKES = NODES.map((n) => ({ x1: HUB.x, y1: HUB.y, x2: n.x, y2: n.y }));
const RING = NODES.map((n, i) => {
  const m = NODES[(i + 1) % NODES.length];
  return { x1: n.x, y1: n.y, x2: m.x, y2: m.y };
});

// Token-driven — all three tiers come from app/theme.css (the orb family), so
// the ramp has one source of truth. Fallbacks mirror the light values so the
// mark still renders if the tokens are absent (e.g. an isolated preview).
const MARK_CSS = `
.v-network-mark {
  --nm-edge: var(--v-orb-edge, rgba(14, 140, 153, 0.50));
  --nm-node: var(--v-orb-node, #0E8C99);
  --nm-hub: var(--v-orb-hub, #0A5A62);
}
`;

export function NetworkMark({ size = 96, className, title }: NetworkMarkProps) {
  return (
    <svg
      className={className ? `v-network-mark ${className}` : 'v-network-mark'}
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
      <style>{MARK_CSS}</style>

      {/* Constellation edges — spokes + outer ring, one soft weight */}
      <g stroke="var(--nm-edge)" strokeWidth={1.6} strokeLinecap="round" fill="none">
        {SPOKES.map((s, i) => (
          <line key={`s${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
        {RING.map((e, i) => (
          <line key={`r${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
        ))}
      </g>

      {/* Satellite nodes */}
      {NODES.map((n, i) => (
        <circle key={`n${i}`} cx={n.x} cy={n.y} r={5} fill="var(--nm-node)" />
      ))}

      {/* Flat hub — the deepest element on light, the brightest on dark */}
      <circle cx={HUB.x} cy={HUB.y} r={9.5} fill="var(--nm-hub)" />
    </svg>
  );
}

export default NetworkMark;
