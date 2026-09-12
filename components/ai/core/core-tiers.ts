/**
 * core-tiers.ts
 * ---------------------------------------------------------------------------
 * Device capability ladder for the Portfolio Intelligence Core.
 *
 * This module is intentionally dependency-free (no `three`, no React) so it can
 * be imported from anywhere — including the React island, which must never pull
 * the three.js runtime at module scope.
 *
 * Detection is a real capability probe, not a user-agent sniff:
 *   • navigator.hardwareConcurrency  (logical cores)
 *   • navigator.deviceMemory         (GB, Chromium only)
 *   • devicePixelRatio + viewport area (pixels to shade)
 *   • the unmasked WebGL renderer string (software rasterisers ⇒ LOW)
 */

export type Tier = 'high' | 'medium' | 'low';

export interface TierConfig {
  tier: Tier;
  /** Faint shell "dust" particles (filler dots between the fibres). */
  particles: number;
  /** Bright "security/sector" nodes sitting on fibre intersections. */
  nodes: number;
  /** Fibre-web vertices — the yarn-ball points the edges connect. */
  webPoints: number;
  /** Nearest-neighbour links per web vertex (edge density driver). */
  fibersPerNode: number;
  /** Fraction of extra long chords that cross the interior of the sphere. */
  chordRatio: number;
  /** Cap on edge-riding energy-flow particles. */
  maxFlow: number;
  /** Fraction of edges that get a gentle mid-point bend (organic strands). */
  fiberBend: number;
  /** devicePixelRatio ceiling. */
  dprClamp: number;
  /** Bloom render-target resolution multiplier (1.0 = full res). */
  bloomResolution: number;
  /** Base bloom strength (scaled by `intensity`). */
  bloomStrength: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  high: {
    tier: 'high',
    particles: 1500,
    nodes: 280,
    webPoints: 3000,
    fibersPerNode: 4,
    chordRatio: 0.06,
    maxFlow: 380,
    fiberBend: 1.0,
    dprClamp: 1.8,
    bloomResolution: 0.9,
    bloomStrength: 0.34,
  },
  medium: {
    tier: 'medium',
    particles: 1100,
    nodes: 200,
    webPoints: 2100,
    fibersPerNode: 3,
    chordRatio: 0.06,
    maxFlow: 240,
    fiberBend: 0.9,
    dprClamp: 1.4,
    bloomResolution: 0.7,
    bloomStrength: 0.26,
  },
  low: {
    tier: 'low',
    particles: 800,
    nodes: 130,
    webPoints: 1100,
    fibersPerNode: 2,
    chordRatio: 0.06,
    maxFlow: 120,
    fiberBend: 0.8,
    dprClamp: 1.0,
    bloomResolution: 0.5,
    bloomStrength: 0.16,
  },
};

/** Ordered from richest to leanest — used by the adaptive downgrade. */
export const TIER_ORDER: readonly Tier[] = ['high', 'medium', 'low'];

/** The next leaner tier, or `null` when already at `low`. */
export function nextTierBelow(tier: Tier): Tier | null {
  const i = TIER_ORDER.indexOf(tier);
  if (i < 0 || i >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[i + 1];
}

export interface CapabilityReport {
  tier: Tier;
  reason: string;
  renderer: string;
  cores: number;
  memory: number;
  dpr: number;
  viewport: { w: number; h: number };
  software: boolean;
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

/** Read the unmasked GPU renderer string, if the context exposes it. */
export function readRendererString(gl?: GL | null): string {
  if (!gl) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    const s = gl.getParameter((ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL);
    return typeof s === 'string' ? s : '';
  } catch {
    return '';
  }
}

const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;

/**
 * Classify the current device into a rendering tier.
 *
 * `gl` is optional — passing the engine's live context lets us read the
 * renderer string; when omitted (or when WebGL is unavailable) we fall back to
 * heuristics only.
 */
export function detectCapability(gl?: GL | null): CapabilityReport {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | (Navigator & { deviceMemory?: number })
    | undefined;

  const cores = nav?.hardwareConcurrency ?? 4;
  const memory = nav?.deviceMemory ?? 4;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  const w = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight || 0 : 0;
  const area = w * h;

  const renderer = readRendererString(gl);
  const software = !!renderer && SOFTWARE_RE.test(renderer);

  const base: CapabilityReport = {
    tier: 'medium',
    reason: '',
    renderer,
    cores,
    memory,
    dpr,
    viewport: { w, h },
    software,
  };

  if (software) {
    return { ...base, tier: 'low', reason: `software renderer (${renderer})` };
  }
  if (!gl) {
    // Called without a live context — judge purely on heuristics, but stay
    // conservative: the caller will bail to an empty container anyway.
    return { ...base, tier: 'low', reason: 'no WebGL context' };
  }

  let score = 0;
  if (cores >= 8) score += 3;
  else if (cores >= 4) score += 2;
  else score += 0;

  if (memory >= 8) score += 2;
  else if (memory >= 4) score += 1;

  if (area >= 1_900_000) score += 0; // 1080p+
  else if (area >= 800_000) score += 1;
  else score += 0; // small screens get plenty of headroom

  if (dpr <= 1.51) score += 1; // low DPR ⇒ fewer shaded pixels

  const tier: Tier = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';
  return {
    ...base,
    tier,
    reason: `score ${score} (cores ${cores}, mem ${memory}GB, dpr ${dpr.toFixed(2)}, ${w}×${h})`,
  };
}
