# Portfolio Intelligence Core

A **premium, procedurally-rendered WebGL sphere** — the flagship Vantage AI visual
identity moment. A dense, luminous *fibre-web* that reads as "the AI thinking about
your portfolio": securities as bright nodes, thousands of fine electric-blue strands
linking them node-to-node, a dark hollow core, and energy discharging outward along
the web.

It **breathes**. A slow global pulse swells the shell and its light a few percent
per cycle, and ring-shaped energy pulses travel from the dark centre out to the limb.

It is **not** a texture, an image, or a GIF. Everything — the particle shell, the
nodes, the edges, the travelling energy, the glow — is generated at runtime.

```
components/ai/core/
  PortfolioIntelligenceCore.tsx   the React island (public API)
  core-engine.ts                  the three.js engine (ONLY file importing three)
  core-tiers.ts                   device capability ladder (no three, no React)
  README.md                       this file
```

> This is a **feature-flagged island**. Nothing else in the app imports it yet.
> Integration is a separate task. A bug here cannot take a page down — see
> "Failure behaviour" below.

---

## Quick start

```tsx
import { PortfolioIntelligenceCore } from '@/components/ai/core/PortfolioIntelligenceCore';

<PortfolioIntelligenceCore state="thinking" intensity={0.7} />
```

The container fills its parent (`width/height: 100%`) and has a `220px` minimum
height, so drop it into a card with a fixed height (or a flex child) and it sizes
itself responsively via a `ResizeObserver`.

---

## Public API (frozen — integration depends on it)

```tsx
export type CoreState = 'idle' | 'thinking' | 'insight' | 'risk';

export interface PortfolioIntelligenceCoreProps {
  state?: CoreState;                                   // default 'idle'
  intensity?: number;                                  // 0..1, default 0.5
  paused?: boolean;                                    // default false
  quality?: 'auto' | 'high' | 'medium' | 'low';        // default 'auto'
  className?: string;
  style?: React.CSSProperties;
  onStats?: (s: CoreStatsPayload) => void;
  onReady?: (s: { tier: string; particles: number }) => void;
  ariaLabel?: string;                                  // default 'Portfolio intelligence'
}

export interface CoreStatsPayload {
  tier: 'high' | 'medium' | 'low';
  particles: number;   // shell particle count
  nodes: number;       // bright node subset
  edges: number;       // network edges
  fps: number;         // rolling average
  reducedMotion: boolean;
}
```

The component is `'use client'`, returns `React.JSX.Element`, and **never imports
`three` at module top level** — `core-engine` is dynamic-imported inside an effect,
so three.js is code-split and only downloaded when the component actually mounts.

### Props explained

| Prop | Effect |
| --- | --- |
| `state` | Animation state; crossfades smoothly (~0.9s eased), never hard-cuts. |
| `intensity` | `0..1` overall energy — scales rotation, flow speed, bloom strength, turbulence and flash frequency. |
| `paused` | Freezes the render loop, keeping the last frame on screen. Auto-pauses on `document.hidden` too. |
| `quality` | Forces a tier; `'auto'` uses the capability probe + adaptive downgrade. |
| `onStats` | Live tier / counts / fps / reducedMotion. Throttled to ~2/s. |
| `onReady` | Fires once after the engine is constructed and sized. |
| `ariaLabel` | Accessible name for the `role="img"` container. |

---

## Animation states

Transitions between states are eased parameter lerps (~0.9s time constant) so the
core never snaps.

- **idle** — slow rotation (`~0.05 rad/s` at low intensity), a slow breathing pulse
  that rhythmically swells the shell, drifting motes, node flares synced to the breath
  cycle, and a pulse ring discharging outward every few seconds.
- **thinking** — the breath and the outward pulses speed up, the web tightens ~6%
  then releases, more strands illuminate, and travelling waves sweep the surface.
- **insight** — a **one-shot** that decays: a soft radial pulse, a short-lived
  spherical-harmonic perturbation that reorganises the web, glow intensifies then
  settles back to idle. Also lifts the core subtly toward the gain accent.
- **risk** — the web is more turbulent (higher jitter, less coherent flow), the
  pulse ring runs hotter and irregular, and the **loss accent `#D64545`** appears as
  an accent only. Cyan stays dominant.

### Motion model (the headline effect)

Three coupled oscillators run in every state, always eased, never hard-cut:

1. **Breath** — `uBreathPhase` drives a radial scale
   (`1 + breathAmt * 0.05 * sin(phase)`) in the vertex shaders *and* a matching
   line/node brightness swell. This is the effect Em asked for: the whole sphere
   visibly inhales and exhales.
2. **Outward pulse** — a Gaussian band in *projected* radius
   (`pr = length(mv.xy) / R`) sweeps from the centre to beyond the limb and wraps,
   lighting the strands, nodes, motes and flow particles it passes. It is suppressed
   in the innermost ~6% so the dead centre never lights up.
3. **Node flares** — one burst per breath cycle (synced, not random) plus a small
   random tail, decaying via a `uFlares` data texture.

### Positive portfolio state → `insight` + high `intensity`

There is **no fifth state**. A positive/up portfolio is expressed as
`state="insight"` with a high `intensity` (e.g. `0.85–1`), which drives the gain
token `#1E9E5A` into a subtly brighter core while keeping the animation a decaying
one-shot. Do not add new states; map meanings onto the four above.

---

## Palette (hard constraint)

Primary illumination is the cyan/electric-blue family drawn from the existing
Vantage gradient:

```
#9FF0F4  (light)   →   #0E8C99  (mid)   →   #0A5A62  (deep)
```

Accents only:

```
#D64545  loss / risk accent
#1E9E5A  gain / positive core lift
```

**No other hues.** No violet, magenta, pink or orange. Dark/luminous by design.

### Internal backdrop (critical)

The core renders on top of the existing `#17323B` AI-surface card. The renderer is
created with `alpha: true` and `setClearColor(0x000000, 0)`, and a final `ShaderPass`
(ALPHA_COMPOSITE) recovers a straight-alpha image from the additive luminance so
nothing is painted behind the glow.

That same pass injects the island's **own** backdrop: a radial plate that fades from
`#000000` at the dead centre to a deep `#071518` at the limb, opaque behind the core
but fully transparent well before the outer canvas edge (outer radius ≈ `1.25 ×` the
sphere radius). This gives the electric blue something near-black to pop against
while the corners stay transparent, so the island still drops cleanly onto the card.
Do **not** give it a page background or a full-canvas near-black fill.

Forbidden inside the canvas: stock ticker labels, solar-system layouts, HUD
rings/crosshairs/scan lines, crypto-site aesthetics, and **any text**.

---

## Performance ladder

`core-tiers.ts` exports `detectCapability(gl)` — a real capability probe, not a
user-agent sniff. It reads `navigator.hardwareConcurrency`, `deviceMemory`,
`devicePixelRatio`, viewport area, and the unmasked WebGL renderer string
(`WEBGL_debug_renderer_info`). Known software rasterisers (SwiftShader, llvmpipe,
…) are forced to **low**.

| Tier | Dust particles | Nodes | Web points | Strands / node | DPR clamp | Bloom res | Bloom strength |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **high** | 9 000 | 320 | 1 700 | 5 | 1.8 | 0.90 | 0.55 |
| **medium** | 5 500 | 230 | 1 100 | 5 | 1.4 | 0.70 | 0.45 |
| **low** | 3 000 | 150 | 800 | 4 | 1.0 | 0.50 | 0.35 |

The web is built from a Fibonacci shell of `webPoints` directions. Every point links
to its `fibersPerNode` nearest neighbours (de-duplicated), plus a small fraction of
long interior **chords** (`chordRatio`) that cross the hollow. On `high` that is
~5 000 strands — ~6× denser than the original 3-NN lattice, so the mesh reads as a web — with
the limb naturally brighter than the hollow centre. A fraction of strands
(`fiberBend`) get a gentle mid-point bend so the mesh reads as fibre, not wireframe.
`low` uses `fiberBend: 0` and the smallest budgets so it still holds a real frame
rate under software GL.

**Framing:** the sphere fills `84%` of the stage's short axis, so it reads clearly at
430×932 mobile-probe size instead of as a small dot in a big glow.

### Adaptive downgrade

While `quality === 'auto'`, if the rolling FPS average stays below **45** for
~3 consecutive seconds the engine steps down one tier (`high → medium → low`, once
each) rather than stuttering forever. The step-down rebuilds geometry and bloom
resolution in place and reports the new tier immediately via `onStats`.

---

## Accessibility

- **Reduced motion** — when `prefers-reduced-motion: reduce` matches, the engine
  renders a single static frame and reports `reducedMotion: true`. A `change`
  listener starts/stops the loop live and is removed on unmount.
- **Paused** — `paused` freezes the loop keeping the last frame; the tab is
  auto-paused on `visibilitychange` and resumes on return.
- The container is `role="img"` with an `aria-label` (default
  `'Portfolio intelligence'`); `aria-hidden` is intentionally **not** set.
- `ResizeObserver` drives responsive sizing — never a fixed canvas size.
- WebGL context loss (`webglcontextlost` / `webglcontextrestored`) is handled
  without throwing.

## Failure behaviour

Every stage — WebGL probe, dynamic import, engine construction, resize, prop
sync — is individually guarded. Missing WebGL, a missing canvas, or a thrown
engine error all resolve to an **empty, correctly-sized container**. The parent
page is never affected. Full disposal on unmount releases geometries, materials,
textures, the composer, the renderer (`forceContextLoss()`), observers and
listeners.

## How to disable

The component is not wired into any page yet. To keep it out of the app entirely,
simply do not import it — because it is dynamic-imported, its engine (and the
`three` dependency) is not fetched unless the component mounts. If/when it is
integrated, gate the mount behind your existing feature-flag mechanism and
render `null` (or a static fallback) when the flag is off.

## Tests / verification

- `npx tsc --noEmit` — clean (no errors under `components/ai/core`).
- Engine smoke test: `/tmp/core-smoke.cjs` runs the built engine in a real
  Chromium (Playwright) page and reports measured FPS + tier.
