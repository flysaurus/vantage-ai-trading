/**
 * core-engine.ts
 * ---------------------------------------------------------------------------
 * The three.js engine behind the Portfolio Intelligence Core.
 *
 * THE ONLY MODULE ALLOWED TO IMPORT `three`. The React island dynamic-imports
 * this file inside an effect, so three.js is code-split out of the main bundle
 * and only fetched when the component actually mounts.
 *
 * Renders a dense, self-illuminated "fibre web" sphere (the target look):
 *   fibres  → thousands of thin electric-cyan line segments forming a shell
 *             mesh (k-nearest-neighbour links) + a minority of interior chords
 *   nodes   → bright near-white nodes at fibre intersections (flare on beat)
 *   dust    → faint shell speckle filling the gaps between fibres
 *   flow    → energy particles travelling ALONG the fibres
 *   plate   → an internal near-black radial backdrop drawn in the final pass
 *   composer→ RenderPass → UnrealBloomPass → OutputPass → alpha+plate composite
 *
 * The centre is deliberately DARK: all light belongs to the fibres and nodes.
 * The canvas itself stays transparent at its outer edges (clear α=0) so it
 * still drops cleanly onto the host card.
 *
 * Motion: a slow global breathing pulse (radius + brightness), expanding
 * energy rings that travel outward through the web, and breath-synced node
 * flares. The 4 state semantics (idle/thinking/insight/risk) modulate speed
 * and energy, always eased.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { TIERS, nextTierBelow, type Tier, type TierConfig } from './core-tiers';

export type CoreState = 'idle' | 'thinking' | 'insight' | 'risk';

export interface CoreStats {
  tier: Tier;
  particles: number;
  nodes: number;
  edges: number;
  fps: number;
  reducedMotion: boolean;
}

export interface CoreEngineOptions {
  /** Element the canvas is appended to. */
  host: HTMLElement;
  tierConfig: TierConfig;
  /** When true the engine may step tiers down if sustained FPS is poor. */
  qualityAuto?: boolean;
  /** Initial state / energy. */
  state?: CoreState;
  intensity?: number;
  reducedMotion?: boolean;
}

/* -------------------------------------------------------------------------- */
/* palette                                                                    */
/* -------------------------------------------------------------------------- */

const HEX = {
  a: '#9FF0F4', // bright cyan — hottest highlights only
  hot: '#EAFEFF', // near-white — brightest intersections / flares
  mid: '#4FA8FF', // mid blue — the body colour of the cords
  b: '#12456E', // deep blue — faintest dust
  risk: '#D64545', // loss accent — accent only
  gain: '#1E9E5A', // gain accent — accent only
} as const;

const TWO_PI = Math.PI * 2;

function linear(hex: string): THREE.Vector3 {
  const c = new THREE.Color().setStyle(hex).convertSRGBToLinear();
  return new THREE.Vector3(c.r, c.g, c.b);
}

/* -------------------------------------------------------------------------- */
/* canvas sprite generators (no external textures)                           */
/* -------------------------------------------------------------------------- */

/** Compact, bright point sprite — a tight core with a short soft skirt. */
function makeSpriteTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.96)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.58, 'rgba(255,255,255,0.09)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/* geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Evenly-distributed direction vectors on the unit sphere (Fibonacci). */
function sphereDirs(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * golden;
    out[i * 3] = Math.cos(theta) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(theta) * r;
  }
  return out;
}

interface DustBuffers {
  position: Float32Array;
  aRadial: Float32Array;
  aSeed: Float32Array;
  aSize: Float32Array;
  aBright: Float32Array;
  count: number;
}

/** Faint shell speckle — fills the gaps between the fibres with tiny points. */
function buildDust(n: number): DustBuffers {
  const dirs = sphereDirs(n);
  const position = new Float32Array(n * 3);
  const aRadial = new Float32Array(n);
  const aSeed = new Float32Array(n * 3);
  const aSize = new Float32Array(n);
  const aBright = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const jitter = 1 + (Math.random() - 0.5) * 0.06;
    aRadial[i] = jitter;
    position[i * 3] = dirs[i * 3];
    position[i * 3 + 1] = dirs[i * 3 + 1];
    position[i * 3 + 2] = dirs[i * 3 + 2];
    aSeed[i * 3] = Math.random();
    aSeed[i * 3 + 1] = Math.random();
    aSeed[i * 3 + 2] = Math.random();
    aSize[i] = 0.35 + Math.random() * 0.45;
    aBright[i] = 0.08 + Math.random() * 0.25;
  }
  return { position, aRadial, aSeed, aSize, aBright, count: n };
}

interface WebData {
  /** Web vertices in world units (radius ~1), the fibre endpoints. */
  web: Float32Array;
  /** Subset of web indices that become bright nodes. */
  nodeIdx: Int32Array;
  nodePositions: Float32Array;
  nodeCount: number;
  webCount: number;
  /** Per-node radial + seed for the node sprite layer. */
  nodeRadial: Float32Array;
  nodeSeed: Float32Array;
}

/** Build the fibre-web vertex set (a slightly-jittered Fibonacci shell). */
function buildWeb(webCount: number, nodeCount: number): WebData {
  const dirs = sphereDirs(webCount);
  const web = new Float32Array(webCount * 3);
  for (let i = 0; i < webCount; i++) {
    const r = 1 + (Math.random() - 0.5) * 0.05;
    web[i * 3] = dirs[i * 3] * r;
    web[i * 3 + 1] = dirs[i * 3 + 1] * r;
    web[i * 3 + 2] = dirs[i * 3 + 2] * r;
  }

  const nNodes = Math.max(1, Math.min(nodeCount, webCount));
  const nodeIdx = new Int32Array(nNodes);
  const nodePositions = new Float32Array(nNodes * 3);
  const nodeRadial = new Float32Array(nNodes);
  const nodeSeed = new Float32Array(nNodes * 3);
  const stride = webCount / nNodes;

  for (let t = 0; t < nNodes; t++) {
    const i = Math.min(webCount - 1, Math.floor(t * stride));
    nodeIdx[t] = i;
    nodePositions[t * 3] = web[i * 3];
    nodePositions[t * 3 + 1] = web[i * 3 + 1];
    nodePositions[t * 3 + 2] = web[i * 3 + 2];
    nodeRadial[t] = Math.hypot(web[i * 3], web[i * 3 + 1], web[i * 3 + 2]);
    nodeSeed[t * 3] = Math.random();
    nodeSeed[t * 3 + 1] = Math.random();
    nodeSeed[t * 3 + 2] = Math.random();
  }

  return { web, nodeIdx, nodePositions, nodeCount: nNodes, webCount, nodeRadial, nodeSeed };
}

interface FiberData {
  /** 4 ribbon corners per edge (indexed). `position` = this corner's own endpoint. */
  positions: Float32Array;
  /** The opposite endpoint of this edge (same for both corners on that end). */
  aOther: Float32Array;
  /** -1 / +1 cross coordinate, drives the soft ribbon edge. */
  aSide: Float32Array;
  /** Half-width of the ribbon in device pixels. */
  aWidth: Float32Array;
  aBright: Float32Array;
  aMidPos: Float32Array;
  indices: Uint32Array;
  pairs: Int32Array; // [a0,b0, a1,b1, ...]
  count: number;
}

/**
 * Build the fibre mesh: k nearest neighbours per web vertex plus a minority of
 * long interior chords. Nearest-neighbour links are short chords that hug the
 * surface, which is what draws the sharp spherical silhouette; the chords make
 * the ball read as three-dimensional.
 *
 * Brute force over ≤ ~2600 points is fine (~7M distance evals, one-off).
 */
function buildFibers(
  web: Float32Array,
  webCount: number,
  k: number,
  chordRatio: number,
  bend: number,
): FiberData {
  const pairs: number[] = [];
  const seen = new Set<number>();
  const kk = Math.max(1, Math.min(k, webCount - 1));
  const bestJ = new Int32Array(kk).fill(-1);
  const bestD = new Float32Array(kk).fill(Infinity);

  for (let i = 0; i < webCount; i++) {
    bestJ.fill(-1);
    bestD.fill(Infinity);
    const ax = web[i * 3];
    const ay = web[i * 3 + 1];
    const az = web[i * 3 + 2];
    for (let j = 0; j < webCount; j++) {
      if (j === i) continue;
      const dx = ax - web[j * 3];
      const dy = ay - web[j * 3 + 1];
      const dz = az - web[j * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d >= bestD[kk - 1]) continue;
      let p = kk - 1;
      while (p > 0 && bestD[p - 1] > d) {
        bestD[p] = bestD[p - 1];
        bestJ[p] = bestJ[p - 1];
        p--;
      }
      bestD[p] = d;
      bestJ[p] = j;
    }
    for (let q = 0; q < kk; q++) {
      const j = bestJ[q];
      if (j < 0) continue;
      const lo = i < j ? i : j;
      const hi = i < j ? j : i;
      const key = lo * webCount + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(lo, hi);
    }
  }

  // interior chords — long links that cut across the middle of the ball
  const baseCount = pairs.length / 2;
  const extra = Math.floor(baseCount * chordRatio);
  for (let c = 0; c < extra; c++) {
    const i = Math.floor(Math.random() * webCount);
    const j = (i + Math.floor(webCount / 2) + Math.floor(Math.random() * Math.max(1, webCount >> 2))) % webCount;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    if (lo === hi) continue;
    const key = lo * webCount + hi;
    if (seen.has(key)) continue;
    const dx = web[lo * 3] - web[hi * 3];
    const dy = web[lo * 3 + 1] - web[hi * 3 + 1];
    const dz = web[lo * 3 + 2] - web[hi * 3 + 2];
    if (dx * dx + dy * dy + dz * dz < 0.9) continue; // keep them genuinely long
    seen.add(key);
    pairs.push(lo, hi);
  }

  const count = pairs.length / 2;

  // --- strand list: most edges are straight, a fraction get a gentle bend ---
  type Seg = { ax: number; ay: number; az: number; bx: number; by: number; bz: number; bright: number; w: number };
  const segs: Seg[] = [];
  for (let e = 0; e < count; e++) {
    const ia = pairs[e * 2];
    const ib = pairs[e * 2 + 1];
    const p0 = [web[ia * 3], web[ia * 3 + 1], web[ia * 3 + 2]];
    const p1 = [web[ib * 3], web[ib * 3 + 1], web[ib * 3 + 2]];
    const bright = 0.62 + Math.random() * 0.9;
    // bimodal width: a minority of thick cords over a bed of fine fibres.
    // Cords must dominate — hair-thin lines read as a "plexus mesh", not fibre.
    // strand thickness: thickest cords ≈ 1% of the sphere diameter, finest
    // filaments ≈ 0.2-0.3% — roughly a 4-5x spread.
    const w = (Math.random() < 0.5 ? 6.5 + Math.random() * 3.4 : 2.0 + Math.random() * 0.9) * (0.85 + 0.25 * bright);

    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);

    if (bend > 0 && len > 0.06 && Math.random() < bend) {
      // midpoint pushed off-axis → the strand reads as a gentle curve
      let nx = Math.random() - 0.5;
      let ny = Math.random() - 0.5;
      let nz = Math.random() - 0.5;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const s = 0.22 * len * (0.5 + Math.random() * 1.4);
      const mx = (p0[0] + p1[0]) / 2 + nx * s;
      const my = (p0[1] + p1[1]) / 2 + ny * s;
      const mz = (p0[2] + p1[2]) / 2 + nz * s;
      segs.push({ ax: p0[0], ay: p0[1], az: p0[2], bx: mx, by: my, bz: mz, bright, w });
      segs.push({ ax: mx, ay: my, az: mz, bx: p1[0], by: p1[1], bz: p1[2], bright, w });
    } else {
      segs.push({ ax: p0[0], ay: p0[1], az: p0[2], bx: p1[0], by: p1[1], bz: p1[2], bright, w });
    }
  }

  const segCount = segs.length;
  // 4 corners per segment; corner order a(-1), a(+1), b(-1), b(+1)
  const positions = new Float32Array(segCount * 4 * 3);
  const aOther = new Float32Array(segCount * 4 * 3);
  const aSide = new Float32Array(segCount * 4);
  const aWidth = new Float32Array(segCount * 4);
  const aBright = new Float32Array(segCount * 4);
  const aMidPos = new Float32Array(segCount * 4 * 3);
  const indices = new Uint32Array(segCount * 6);

  for (let e = 0; e < segCount; e++) {
    const sg = segs[e];
    const { ax, ay, az, bx, by, bz, bright, w } = sg;
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const mz = (az + bz) * 0.5;

    const corners = [
      [ax, ay, az, bx, by, bz, -1],
      [ax, ay, az, bx, by, bz, 1],
      [bx, by, bz, ax, ay, az, -1],
      [bx, by, bz, ax, ay, az, 1],
    ];
    for (let c = 0; c < 4; c++) {
      const v = e * 4 + c;
      positions[v * 3 + 0] = corners[c][0];
      positions[v * 3 + 1] = corners[c][1];
      positions[v * 3 + 2] = corners[c][2];
      aOther[v * 3 + 0] = corners[c][3];
      aOther[v * 3 + 1] = corners[c][4];
      aOther[v * 3 + 2] = corners[c][5];
      aSide[v] = corners[c][6];
      aWidth[v] = w;
      aBright[v] = bright;
      aMidPos[v * 3 + 0] = mx;
      aMidPos[v * 3 + 1] = my;
      aMidPos[v * 3 + 2] = mz;
    }
    const o = e * 6;
    indices[o + 0] = e * 4 + 0;
    indices[o + 1] = e * 4 + 1;
    indices[o + 2] = e * 4 + 2;
    indices[o + 3] = e * 4 + 2;
    indices[o + 4] = e * 4 + 1;
    indices[o + 5] = e * 4 + 3;
  }

  return { positions, aOther, aSide, aWidth, aBright, aMidPos, indices, pairs: Int32Array.from(pairs), count };
}

interface FlowData {
  aA: Float32Array;
  aB: Float32Array;
  aT: Float32Array;
  aSpeed: Float32Array;
  aSize: Float32Array;
  aSeed: Float32Array;
  count: number;
}

function buildFlow(fibers: FiberData, web: Float32Array, maxFlow: number): FlowData {
  const count = Math.min(maxFlow, Math.max(0, fibers.count));
  const aA = new Float32Array(count * 3);
  const aB = new Float32Array(count * 3);
  const aT = new Float32Array(count);
  const aSpeed = new Float32Array(count);
  const aSize = new Float32Array(count);
  const aSeed = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const e = i % fibers.count;
    const na = fibers.pairs[e * 2];
    const nb = fibers.pairs[e * 2 + 1];
    aA[i * 3 + 0] = web[na * 3 + 0];
    aA[i * 3 + 1] = web[na * 3 + 1];
    aA[i * 3 + 2] = web[na * 3 + 2];
    aB[i * 3 + 0] = web[nb * 3 + 0];
    aB[i * 3 + 1] = web[nb * 3 + 1];
    aB[i * 3 + 2] = web[nb * 3 + 2];
    aT[i] = Math.random();
    aSpeed[i] = 0.3 + Math.random() * 0.7;
    aSize[i] = 1.6 + Math.random() * 1.6;
    aSeed[i * 3 + 0] = Math.random();
    aSeed[i * 3 + 1] = Math.random();
    aSeed[i * 3 + 2] = Math.random();
  }
  return { aA, aB, aT, aSpeed, aSize, aSeed, count };
}

/* -------------------------------------------------------------------------- */
/* shaders                                                                    */
/* -------------------------------------------------------------------------- */

const DUST_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPointScale;
  uniform float uCamDist;
  uniform float uRadius;
  uniform float uRim;
  uniform float uTurb;
  uniform float uWave;
  uniform float uBreathAmt;
  uniform float uBreathPhase;
  uniform float uPulseFront;
  uniform float uPulseWidth;
  uniform float uPulseAmt;
  uniform float uOpacity;

  attribute float aRadial;
  attribute vec3 aSeed;
  attribute float aSize;
  attribute float aBright;

  varying float vA;
  varying float vBright;
  varying float vPulse;

  void main() {
    vec3 dir = normalize(position);
    float polar = acos(clamp(dir.y, -1.0, 1.0));

    float breathe = 1.0 + uBreathAmt * 0.05 * uBreathPhase;
    float wave = uWave * 0.03 * sin(polar * 3.0 - uTime * 2.0);
    vec3 pos = dir * (aRadial * (breathe + wave)) + (aSeed - 0.5) * uTurb * 0.05;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(0.001, -mv.z);
    float front = clamp((uCamDist + mv.z) / (2.0 * uRadius) + 0.5, 0.0, 1.0);
    float depthFactor = mix(0.06, 1.0, front);

    float pr = clamp(length(mv.xy) / uRadius, 0.0, 1.5);
    float p = min(pr, 1.0);
    float rim = clamp(inversesqrt(max(0.18, 1.0 - p * p)), 1.0, 3.0);
    float shell = mix(1.0, rim, uRim);

    float band = exp(-pow((pr - uPulseFront) / uPulseWidth, 2.0));
    band *= smoothstep(0.06, 0.3, pr); // never lights the dead centre
    vPulse = clamp(uPulseAmt * band, 0.0, 1.0);

    gl_PointSize = clamp(aSize * uPointScale * depthFactor * (uCamDist / depth) * (0.85 + 0.3 * front), 1.0, 72.0);

    vBright = aBright;
    vA = uOpacity * depthFactor * shell
       * (0.8 + 0.35 * uBreathPhase * uBreathAmt)
       * (1.0 + vPulse * 1.6);
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform sampler2D uSprite;
  uniform vec3 uColorDim;
  uniform vec3 uColorBright;
  uniform vec3 uRisk;
  uniform float uRiskMix;

  varying float vA;
  varying float vBright;
  varying float vPulse;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float sp = texture2D(uSprite, gl_PointCoord).a;
    float falloff = pow(clamp(1.0 - d * 2.0, 0.0, 1.0), 2.0);
    float a = (sp * 0.7 + falloff * 0.3) * vA;
    if (a < 0.012) discard;

    vec3 col = mix(uColorDim, uColorBright, clamp(vBright, 0.0, 1.0));
    col += vPulse * 0.35;
    col = mix(col, uRisk, uRiskMix * 0.55);
    gl_FragColor = vec4(col, a);
  }
`;

const NODE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPointScale;
  uniform float uCamDist;
  uniform float uRadius;
  uniform float uRim;
  uniform float uWave;
  uniform float uBreathAmt;
  uniform float uBreathPhase;
  uniform float uPulseFront;
  uniform float uPulseWidth;
  uniform float uPulseAmt;
  uniform float uOpacity;
  uniform float uFlareDecay;
  uniform float uNodeCount;
  uniform sampler2D uFlares;

  attribute float aRadial;
  attribute vec3 aSeed;
  attribute float aSize;
  attribute float aBright;
  attribute float aNodeId;

  varying float vA;
  varying float vFlash;
  varying float vPulse;

  void main() {
    vec3 dir = normalize(position);
    float polar = acos(clamp(dir.y, -1.0, 1.0));

    float breathe = 1.0 + uBreathAmt * 0.05 * uBreathPhase;
    float wave = uWave * 0.03 * sin(polar * 3.0 - uTime * 2.0);
    vec3 pos = dir * (aRadial * (breathe + wave));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(0.001, -mv.z);
    float front = clamp((uCamDist + mv.z) / (2.0 * uRadius) + 0.5, 0.0, 1.0);
    float depthFactor = mix(0.08, 1.0, front);

    float pr = clamp(length(mv.xy) / uRadius, 0.0, 1.5);
    float p = min(pr, 1.0);
    float rim = clamp(inversesqrt(max(0.18, 1.0 - p * p)), 1.0, 3.0);
    float shell = mix(1.0, rim, uRim);

    float start = texture2D(uFlares, vec2((aNodeId + 0.5) / uNodeCount, 0.5)).r;
    float dtf = uTime - start;
    float flare = dtf >= 0.0 ? exp(-dtf * uFlareDecay) : 0.0;

    float band = exp(-pow((pr - uPulseFront) / uPulseWidth, 2.0));
    band *= smoothstep(0.06, 0.3, pr); // never lights the dead centre
    vPulse = clamp(uPulseAmt * band, 0.0, 1.0);
    vFlash = flare;

    gl_PointSize = clamp(aSize * uPointScale * depthFactor * shell * (uCamDist / depth) * (0.9 + 0.35 * front) * (1.0 + flare * 0.5 + vPulse * 0.3), 1.0, 96.0);

    vA = uOpacity * depthFactor * shell
       * (0.85 + 0.4 * uBreathPhase * uBreathAmt)
       * (1.0 + vPulse * 2.2 + flare * 1.8);
  }
`;

const NODE_FRAG = /* glsl */ `
  uniform sampler2D uSprite;
  uniform vec3 uColorBright;
  uniform vec3 uColorHot;
  uniform vec3 uRisk;
  uniform float uRiskMix;

  varying float vA;
  varying float vFlash;
  varying float vPulse;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float sp = texture2D(uSprite, gl_PointCoord).a;
    float falloff = pow(clamp(1.0 - d * 2.0, 0.0, 1.0), 1.8);
    float a = (sp * 0.85 + falloff * 0.4) * vA;
    if (a < 0.003) discard;

    float heat = clamp(vFlash * 0.9 + vPulse * 0.7, 0.0, 1.0);
    vec3 col = mix(uColorBright, uColorHot, heat);
    col = mix(col, uRisk, uRiskMix * 0.7);
    gl_FragColor = vec4(col, a);
  }
`;

const FIBER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uCamDist;
  uniform vec2 uResolution;
  uniform float uWave;
  uniform float uBreathAmt;
  uniform float uBreathPhase;
  uniform float uPulseFront;
  uniform float uPulseWidth;
  uniform float uPulseAmt;
  uniform float uOpacity;
  uniform float uIllum;
  uniform float uRim;

  attribute vec3 aOther;
  attribute float aSide;
  attribute float aWidth;
  attribute float aBright;
  attribute vec3 aMidPos;

  varying float vA;
  varying float vHot;
  varying float vPulse;
  varying float vCross;
  varying float vFront;

  vec3 motion(vec3 p) {
    vec3 d = normalize(p);
    float polar = acos(clamp(d.y, -1.0, 1.0));
    float b = 1.0 + uBreathAmt * 0.05 * uBreathPhase;
    float w = uWave * 0.03 * sin(polar * 3.0 - uTime * 2.0);
    return d * (length(p) * (b + w));
  }

  void main() {
    vec4 ca = projectionMatrix * modelViewMatrix * vec4(motion(position), 1.0);
    vec4 cb = projectionMatrix * modelViewMatrix * vec4(motion(aOther), 1.0);

    // screen-space ribbon: offset this corner perpendicular to the edge
    vec2 sa = ca.xy / max(1e-5, ca.w) * 0.5 * uResolution;
    vec2 sb = cb.xy / max(1e-5, cb.w) * 0.5 * uResolution;
    vec2 dir = sb - sa;
    dir = length(dir) > 1e-4 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 sp = sa + nrm * (aWidth * aSide);

    gl_Position = vec4(sp / (0.5 * uResolution) * ca.w, ca.z, ca.w);

    // 1 = front hemisphere, 0 = back hemisphere (the centre stays dark)
    vec4 vm = modelViewMatrix * vec4(motion(position), 1.0);
    float front = clamp((uCamDist + vm.z) / (2.0 * uRadius) + 0.5, 0.0, 1.0);
    // 1 = front hemisphere, 0 = back hemisphere. The shell is hollow: the rear
    // strands stay visible (0.32) through the gaps in the front, but the very
    // centre stays darker and more open than the rim.
    float d = mix(0.25, 1.0, front);

    vec4 mmv = modelViewMatrix * vec4(aMidPos, 1.0);
    float pr = clamp(length(mmv.xy) / uRadius, 0.0, 1.5);
    float band = exp(-pow((pr - uPulseFront) / uPulseWidth, 2.0));
    band *= smoothstep(0.06, 0.3, pr); // never lights the dead centre
    vPulse = clamp(uPulseAmt * band, 0.0, 1.0);

    // silhouette emphasis: the projected density of a shell spikes at the limb,
    // so bias brightness outward — keeps the centre dark and the rim hot.
    float p = min(pr, 1.0);
    float rim = clamp(inversesqrt(max(0.25, 1.0 - p * p)), 1.0, 2.2);
    float rb = mix(1.0, rim, uRim);

    float brew = 0.82 + 0.42 * uBreathPhase * uBreathAmt;
    vA = uOpacity * d * rb * (0.8 + uIllum * 0.5) * brew * aBright * (1.0 + vPulse * 2.0);
    vHot = clamp(aBright * 1.05 - 0.15, 0.0, 1.0) * 0.35 + vPulse * 0.5;
    vCross = aSide;
    vFront = front;
  }
`;

const FIBER_FRAG = /* glsl */ `
  uniform vec3 uColorCore;
  uniform vec3 uColorHot;
  uniform vec3 uRisk;
  uniform float uRiskMix;

  varying float vA;
  varying float vHot;
  varying float vPulse;
  varying float vCross;
  varying float vFront;

  void main() {
    float ax = abs(vCross);
    float edge = smoothstep(1.0, 0.30, ax);          // soft ribbon edge, tighter
    float core = pow(1.0 - ax, 0.9);                 // hot centre of the strand
    vec3 c = mix(uColorCore, uColorHot, clamp(vHot + core * 0.20, 0.0, 1.0));
    c += vPulse * 0.3;
    c = mix(c, uRisk, uRiskMix * 0.8);
    float a = vA * edge * (0.15 + 0.85 * core);
    if (a < 0.004) discard;
    gl_FragColor = vec4(c, a);
  }
`;

const FLOW_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uInward;
  uniform float uOpacity;
  uniform float uTurb;
  uniform float uPointScale;
  uniform float uCamDist;
  uniform float uRadius;
  uniform float uBreathAmt;
  uniform float uBreathPhase;
  uniform float uPulseFront;
  uniform float uPulseWidth;
  uniform float uPulseAmt;

  attribute vec3 aA;
  attribute vec3 aB;
  attribute float aT;
  attribute float aSpeed;
  attribute float aSize;
  attribute vec3 aSeed;

  varying float vA;
  varying float vPulse;

  void main() {
    float t = fract(aT + uTime * aSpeed * uFlowSpeed);
    vec3 pos = mix(aA, aB, t);
    pos = mix(pos, pos * 0.12, uInward);
    pos *= 1.0 + uBreathAmt * 0.05 * uBreathPhase;
    pos += (aSeed - 0.5) * uTurb * 0.05;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(0.001, -mv.z);
    float front = clamp((uCamDist + mv.z) / (2.0 * uRadius) + 0.5, 0.0, 1.0);
    float df = mix(0.08, 1.0, front);
    gl_PointSize = clamp(aSize * uPointScale * df * (uCamDist / depth), 1.0, 48.0);

    float ends = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.7, 1.0, t));

    float pr = clamp(length(mv.xy) / uRadius, 0.0, 1.5);
    float band = exp(-pow((pr - uPulseFront) / uPulseWidth, 2.0));
    band *= smoothstep(0.06, 0.3, pr); // never lights the dead centre
    vPulse = clamp(uPulseAmt * band, 0.0, 1.0);

    vA = uOpacity * df * (0.4 + 1.0 * ends) * (1.0 + vPulse * 1.6);
  }
`;

const FLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColorHot;
  uniform vec3 uRisk;
  uniform float uRiskMix;

  varying float vA;
  varying float vPulse;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float falloff = pow(clamp(1.0 - d * 2.0, 0.0, 1.0), 1.6);
    vec3 c = mix(uColor, uColorHot, vPulse * 0.7);
    c = mix(c, uRisk, uRiskMix * 0.85);
    gl_FragColor = vec4(c, falloff * vA);
  }
`;

/**
 * Final pass: draws the internal near-black backdrop plate UNDER the additive
 * scene, then recovers straight alpha from the accumulated luminance so the
 * outer canvas stays transparent and the island still drops onto the card.
 */
const ALPHA_COMPOSITE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uGain: { value: 1.0 },
    uAspect: { value: 1.0 },
    uSphereRad: { value: 0.4 },
    uPlateInner: { value: 0.4 },
    uPlateOuter: { value: 0.62 },
    uPlateAmt: { value: 1.0 },
    uPlateCenter: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    uPlateEdge: { value: new THREE.Vector3(0, 0, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGain;
    uniform float uAspect;
    uniform float uSphereRad;
    uniform float uPlateInner;
    uniform float uPlateOuter;
    uniform float uPlateAmt;
    uniform vec3 uPlateCenter;
    uniform vec3 uPlateEdge;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // kill banding in the very faint glow film
      float dith = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      vec3 rgb = clamp(c.rgb + dith, 0.0, 8.0);

      float lum = max(max(rgb.r, rgb.g), rgb.b);
      float a = clamp(lum * uGain, 0.0, 1.0);

      // internal backdrop: a radial near-black plate, opaque behind the core
      // and fading to fully transparent well before the outer canvas edge.
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float rad = length(p) / 0.5;
      float pl = uPlateAmt * smoothstep(uPlateOuter, uPlateInner, rad);
      float core = smoothstep(uSphereRad * 1.0, uSphereRad * 0.15, rad);
      vec3 plateCol = mix(uPlateEdge, uPlateCenter, core);

      // the fibres/nodes are EMISSIVE: the plate sits *under* them, and their
      // light is added on top (never attenuated by the backdrop).
      vec3 Pout = plateCol * pl + rgb;
      float Aout = clamp(pl + a, 0.0, 1.0);
      vec3 straight = Pout / max(Aout, 1e-4);

      gl_FragColor = vec4(straight, Aout);
    }
  `,
};

/* -------------------------------------------------------------------------- */
/* smoothing helper                                                           */
/* -------------------------------------------------------------------------- */

interface ParamState {
  rot: number;
  flow: number;
  turb: number;
  wave: number;
  inward: number;
  illum: number;
  contract: number;
  bloom: number;
  breathAmt: number;
  breathSpeed: number; // radians / second
  pulseAmt: number;
  pulseSpeed: number; // front travel per second (0..~1.35)
  risk: number;
  gain: number;
  flash: number;
}

const PARAM_TAU = 0.9; // seconds — eased crossfade between states
const PULSE_SPAN = 1.35; // front wraps once it leaves the visible disc

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/* -------------------------------------------------------------------------- */
/* the engine                                                                 */
/* -------------------------------------------------------------------------- */

export class CoreEngine {
  readonly canvas: HTMLCanvasElement;

  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world: THREE.Group;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private alphaPass: ShaderPass | null = null;

  private cfg: TierConfig;
  private qualityAuto: boolean;
  private intensity: number;
  private state: CoreState;
  private reducedMotion: boolean;
  private paused = false;
  private hidden = false;
  private disposed = false;
  private contextLost = false;

  private width = 1;
  private height = 1;
  private dpr = 1;
  private camDist = 3.6;
  private radius = 1.0;
  private sphereRad = 0.4; // projected sphere radius / half-height

  // render resources (rebuilt on tier change)
  private fibers: THREE.Mesh | null = null;
  private fiberGeo: THREE.BufferGeometry | null = null;
  private fiberMat: THREE.ShaderMaterial | null = null;
  private dust: THREE.Points | null = null;
  private dustGeo: THREE.BufferGeometry | null = null;
  private dustMat: THREE.ShaderMaterial | null = null;
  private nodes: THREE.Points | null = null;
  private nodeGeo: THREE.BufferGeometry | null = null;
  private nodeMat: THREE.ShaderMaterial | null = null;
  private flow: THREE.Points | null = null;
  private flowGeo: THREE.BufferGeometry | null = null;
  private flowMat: THREE.ShaderMaterial | null = null;
  private spriteTex: THREE.Texture | null = null;
  private flareTex: THREE.DataTexture | null = null;
  private flareData: Float32Array | null = null;
  private nodeCount = 0;
  private edgeCount = 0;
  private particleCount = 0;

  // animation
  private raf = 0;
  private last = 0;
  private time = 0;
  private pulse = 0; // insight one-shot
  private breathAngle = 1.1;
  private pulseFront = 0.62;
  private breathCycle = 0;
  private flareTimer = 0;
  private cur: ParamState;
  private tgt: ParamState;
  private fpsEma = 60;
  private fpsRoll: number[] = [];
  private lastStats = 0;
  private lowFpsSince = 0;
  private downgraded = new Set<Tier>();

  onStats?: (s: CoreStats) => void;
  onReady?: (s: { tier: string; particles: number }) => void;
  onTierChange?: (t: Tier) => void;

  constructor(opts: CoreEngineOptions) {
    this.host = opts.host;
    this.cfg = opts.tierConfig;
    this.qualityAuto = opts.qualityAuto ?? true;
    this.intensity = clamp01(opts.intensity ?? 0.5);
    this.state = opts.state ?? 'idle';
    this.reducedMotion = !!opts.reducedMotion;

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
    } as Partial<CSSStyleDeclaration>);
    this.host.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.6);
    this.world = new THREE.Group();
    this.scene.add(this.world);

    const zero: ParamState = {
      rot: 0.05,
      flow: 1,
      turb: 0.12,
      wave: 0,
      inward: 0,
      illum: 0.35,
      contract: 1,
      bloom: this.cfg.bloomStrength,
      breathAmt: 0.6,
      breathSpeed: TWO_PI / 4.4,
      pulseAmt: 0.5,
      pulseSpeed: 0.32,
      risk: 0,
      gain: 0,
      flash: 0.6,
    };
    this.cur = { ...zero };
    this.tgt = { ...zero };

    this.build();
    this.applyStateTargets();

    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);

    this.resizeNow();
  }

  /* ----------------------------- lifecycle ------------------------------ */

  start(): void {
    if (this.disposed || this.reducedMotion) return;
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /** Render a single frame (used by reduced-motion + as a warmup). */
  renderStatic(frames = 3): void {
    if (this.disposed) return;
    for (let i = 0; i < frames; i++) {
      this.time += 0.5;
      this.updateUniforms(0.5);
      this.composer?.render();
    }
    // In reduced-motion mode the rAF loop never runs, so the periodic
    // emitStats() in tick() never fires. Report from here instead.
    if (this.reducedMotion) this.emitStats(true);
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  setHidden(h: boolean): void {
    this.hidden = h;
  }

  setReducedMotion(b: boolean): void {
    this.reducedMotion = b;
    if (b) {
      this.stop();
      this.renderStatic(1);
    } else {
      this.start();
    }
  }

  /* ------------------------------- props -------------------------------- */

  setState(s: CoreState): void {
    if (s === this.state) return;
    if (s === 'insight') this.pulse = 1; // one-shot
    this.state = s;
    this.applyStateTargets();
  }

  setIntensity(n: number): void {
    this.intensity = clamp01(n);
    this.applyStateTargets();
  }

  setQuality(tier: Tier): void {
    if (tier === this.cfg.tier) return;
    this.applyTier(TIERS[tier]);
  }

  /**
   * An explicit tier request always wins over the adaptive downgrade: once a
   * caller names a tier, we stop second-guessing it (otherwise a slow device
   * immediately downgrades the tier the caller explicitly asked for).
   */
  setQualityExplicit(tier: Tier): void {
    this.qualityAuto = false;
    this.lowFpsSince = 0;
    if (tier === this.cfg.tier) return;
    this.applyTier(TIERS[tier]);
  }

  /** Re-arm (or disable) the adaptive downgrade for `quality="auto"`. */
  setAutoQuality(auto: boolean): void {
    this.qualityAuto = auto;
    if (!auto) this.lowFpsSince = 0;
  }

  /* ------------------------------ sizing -------------------------------- */

  setSize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.width = w;
    this.height = h;
    this.resizeNow();
  }

  private resizeNow(): void {
    const aspect = this.width / Math.max(1, this.height);
    const dpr = Math.min(window.devicePixelRatio || 1, this.cfg.dprClamp);
    this.dpr = dpr;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);

    this.camera.aspect = aspect;

    // frame the sphere so it comfortably fills the host
    const fov = (this.camera.fov * Math.PI) / 180;
    const fill = 0.84;
    const dV = this.radius / (fill * Math.tan(fov / 2));
    const dH = dV / Math.max(0.0001, aspect);
    this.camDist = Math.max(dV, dH);
    this.camera.position.set(0, 0, this.camDist);
    this.camera.updateProjectionMatrix();

    // projected sphere radius in half-height units (drives the plate extent)
    this.sphereRad = fill * Math.min(1, aspect);

    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(this.width, this.height);
      this.applyBloomSize();
    }
    if (this.alphaPass) {
      const u = this.alphaPass.uniforms;
      u.uAspect.value = aspect;
      u.uSphereRad.value = this.sphereRad;
      u.uPlateInner.value = this.sphereRad * 1.35;
      u.uPlateOuter.value = this.sphereRad * 2.4;
    }
    for (const m of [this.dustMat, this.nodeMat, this.flowMat]) {
      if (m) {
        m.uniforms.uCamDist.value = this.camDist;
        m.uniforms.uPointScale.value = this.pointScale();
      }
    }
    if (this.fiberMat) {
      this.fiberMat.uniforms.uCamDist.value = this.camDist;
      (this.fiberMat.uniforms.uResolution.value as THREE.Vector2).set(this.dbWidth(), this.dbHeight());
    }
    if (!this.reducedMotion) this.renderStatic(1);
  }

  private pointScale(): number {
    return ((this.height * this.dpr) / 700) * 2.1;
  }

  private dbWidth(): number {
    return Math.max(2, this.width * this.dpr);
  }

  private dbHeight(): number {
    return Math.max(2, this.height * this.dpr);
  }

  private applyBloomSize(): void {
    if (!this.bloomPass) return;
    const s = this.cfg.bloomResolution;
    this.bloomPass.setSize(
      Math.max(2, this.width * this.dpr * s),
      Math.max(2, this.height * this.dpr * s),
    );
  }

  /* ------------------------------ building ------------------------------ */

  private build(): void {
    this.buildGeometry();
    this.buildComposer();
  }

  private buildGeometry(): void {
    this.particleCount = this.cfg.particles;
    this.spriteTex = makeSpriteTexture();

    // ---- dust ----
    const dust = buildDust(this.cfg.particles);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dust.position, 3));
    dg.setAttribute('aRadial', new THREE.BufferAttribute(dust.aRadial, 1));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(dust.aSeed, 3));
    dg.setAttribute('aSize', new THREE.BufferAttribute(dust.aSize, 1));
    dg.setAttribute('aBright', new THREE.BufferAttribute(dust.aBright, 1));
    const dm = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPointScale: { value: this.pointScale() },
        uCamDist: { value: this.camDist },
        uRadius: { value: this.radius },
        uRim: { value: 0.95 },
        uTurb: { value: 0.12 },
        uWave: { value: 0 },
        uBreathAmt: { value: 0.6 },
        uBreathPhase: { value: Math.sin(this.breathAngle) },
        uPulseFront: { value: this.pulseFront },
        uPulseWidth: { value: 0.2 },
        uPulseAmt: { value: 0.5 },
        uOpacity: { value: 0.025 },
        uSprite: { value: this.spriteTex },
        uColorDim: { value: linear(HEX.b) },
        uColorBright: { value: linear(HEX.mid) },
        uRisk: { value: linear(HEX.risk) },
        uRiskMix: { value: 0 },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const dustPts = new THREE.Points(dg, dm);
    dustPts.frustumCulled = false;
    this.world.add(dustPts);
    this.dust = dustPts;
    this.dustGeo = dg;
    this.dustMat = dm;

    // ---- web + fibres ----
    const web = buildWeb(this.cfg.webPoints, this.cfg.nodes);
    this.nodeCount = web.nodeCount;

    const fibers = buildFibers(web.web, web.webCount, this.cfg.fibersPerNode, this.cfg.chordRatio, this.cfg.fiberBend);
    this.edgeCount = fibers.count;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fibers.positions, 3));
    fg.setAttribute('aOther', new THREE.BufferAttribute(fibers.aOther, 3));
    fg.setAttribute('aSide', new THREE.BufferAttribute(fibers.aSide, 1));
    fg.setAttribute('aWidth', new THREE.BufferAttribute(fibers.aWidth, 1));
    fg.setAttribute('aMidPos', new THREE.BufferAttribute(fibers.aMidPos, 3));
    fg.setAttribute('aBright', new THREE.BufferAttribute(fibers.aBright, 1));
    fg.setIndex(new THREE.BufferAttribute(fibers.indices, 1));
    const fm = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: this.radius },
        uCamDist: { value: this.camDist },
        uResolution: { value: new THREE.Vector2(this.dbWidth(), this.dbHeight()) },
        uWave: { value: 0 },
        uBreathAmt: { value: 0.6 },
        uBreathPhase: { value: Math.sin(this.breathAngle) },
        uPulseFront: { value: this.pulseFront },
        uPulseWidth: { value: 0.2 },
        uPulseAmt: { value: 0.5 },
        uOpacity: { value: 1.35 },
        uIllum: { value: 0.5 },
        uRim: { value: 0.85 },
        uColorCore: { value: linear(HEX.mid) },
        uColorHot: { value: linear(HEX.hot) },
        uRisk: { value: linear(HEX.risk) },
        uRiskMix: { value: 0 },
      },
      vertexShader: FIBER_VERT,
      fragmentShader: FIBER_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const lines = new THREE.Mesh(fg, fm);
    lines.frustumCulled = false;
    this.world.add(lines);
    this.fibers = lines;
    this.fiberGeo = fg;
    this.fiberMat = fm;

    // ---- flare texture (one float per node: flare START TIME) ----
    const flareData = new Float32Array(this.nodeCount * 4).fill(-1000);
    this.flareData = flareData;
    const flareTex = new THREE.DataTexture(
      flareData,
      Math.max(1, this.nodeCount),
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    flareTex.minFilter = THREE.NearestFilter;
    flareTex.magFilter = THREE.NearestFilter;
    flareTex.needsUpdate = true;
    this.flareTex = flareTex;

    // ---- nodes ----
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(web.nodePositions, 3));
    ng.setAttribute('aRadial', new THREE.BufferAttribute(web.nodeRadial, 1));
    ng.setAttribute('aSeed', new THREE.BufferAttribute(web.nodeSeed, 3));
    const nodeSize = new Float32Array(this.nodeCount);
    const nodeBright = new Float32Array(this.nodeCount);
    const nodeId = new Float32Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      nodeSize[i] = 1.15 + Math.random() * 1.2;
      nodeBright[i] = 0.8 + Math.random() * 0.35;
      nodeId[i] = i;
    }
    ng.setAttribute('aSize', new THREE.BufferAttribute(nodeSize, 1));
    ng.setAttribute('aBright', new THREE.BufferAttribute(nodeBright, 1));
    ng.setAttribute('aNodeId', new THREE.BufferAttribute(nodeId, 1));
    const nm = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPointScale: { value: this.pointScale() },
        uCamDist: { value: this.camDist },
        uRadius: { value: this.radius },
        uRim: { value: 0.9 },
        uWave: { value: 0 },
        uBreathAmt: { value: 0.6 },
        uBreathPhase: { value: Math.sin(this.breathAngle) },
        uPulseFront: { value: this.pulseFront },
        uPulseWidth: { value: 0.2 },
        uPulseAmt: { value: 0.5 },
        uOpacity: { value: 1.05 },
        uFlareDecay: { value: 2.4 },
        uNodeCount: { value: Math.max(1, this.nodeCount) },
        uFlares: { value: flareTex },
        uSprite: { value: this.spriteTex },
        uColorBright: { value: linear(HEX.mid).lerp(linear(HEX.a), 0.15) },
        uColorHot: { value: linear(HEX.hot) },
        uRisk: { value: linear(HEX.risk) },
        uRiskMix: { value: 0 },
      },
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const nodePts = new THREE.Points(ng, nm);
    nodePts.frustumCulled = false;
    this.world.add(nodePts);
    this.nodes = nodePts;
    this.nodeGeo = ng;
    this.nodeMat = nm;

    // ---- flow ----
    const flow = buildFlow(fibers, web.web, this.cfg.maxFlow);
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flow.count * 3), 3));
    fgeo.setAttribute('aA', new THREE.BufferAttribute(flow.aA, 3));
    fgeo.setAttribute('aB', new THREE.BufferAttribute(flow.aB, 3));
    fgeo.setAttribute('aT', new THREE.BufferAttribute(flow.aT, 1));
    fgeo.setAttribute('aSpeed', new THREE.BufferAttribute(flow.aSpeed, 1));
    fgeo.setAttribute('aSize', new THREE.BufferAttribute(flow.aSize, 1));
    fgeo.setAttribute('aSeed', new THREE.BufferAttribute(flow.aSeed, 3));
    const flm = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFlowSpeed: { value: 1 },
        uInward: { value: 0 },
        uOpacity: { value: 0.9 },
        uTurb: { value: 0.12 },
        uPointScale: { value: this.pointScale() },
        uCamDist: { value: this.camDist },
        uRadius: { value: this.radius },
        uBreathAmt: { value: 0.6 },
        uBreathPhase: { value: Math.sin(this.breathAngle) },
        uPulseFront: { value: this.pulseFront },
        uPulseWidth: { value: 0.2 },
        uPulseAmt: { value: 0.5 },
        uColor: { value: linear(HEX.a) },
        uColorHot: { value: linear(HEX.hot) },
        uRisk: { value: linear(HEX.risk) },
        uRiskMix: { value: 0 },
      },
      vertexShader: FLOW_VERT,
      fragmentShader: FLOW_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const flowPts = new THREE.Points(fgeo, flm);
    flowPts.frustumCulled = false;
    this.world.add(flowPts);
    this.flow = flowPts;
    this.flowGeo = fgeo;
    this.flowMat = flm;
  }

  private buildComposer(): void {
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.dpr);
    composer.setSize(this.width, this.height);

    composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      this.cfg.bloomStrength,
      0.20, // radius — tight, so bloom hugs cords/nodes instead of fogging the ball
      0.60, // threshold — only the hottest cords and flare cores bloom
    );
    composer.addPass(bloom);
    this.bloomPass = bloom;

    composer.addPass(new OutputPass());

    const alpha = new ShaderPass(ALPHA_COMPOSITE);
    composer.addPass(alpha);
    this.alphaPass = alpha;

    this.composer = composer;
    this.applyBloomSize();

    // plate uniforms are sized by resizeNow(); re-apply for the fresh pass
    const aspect = this.width / Math.max(1, this.height);
    alpha.uniforms.uAspect.value = aspect;
    alpha.uniforms.uSphereRad.value = this.sphereRad;
    alpha.uniforms.uPlateInner.value = this.sphereRad * 1.35;
    alpha.uniforms.uPlateOuter.value = this.sphereRad * 2.4;
  }

  private teardownRenderables(): void {
    for (const obj of [this.dust, this.fibers, this.nodes, this.flow]) {
      if (obj) this.world.remove(obj);
    }
    this.dustGeo?.dispose();
    this.dustMat?.dispose();
    this.fiberGeo?.dispose();
    this.fiberMat?.dispose();
    this.nodeGeo?.dispose();
    this.nodeMat?.dispose();
    this.flowGeo?.dispose();
    this.flowMat?.dispose();
    this.spriteTex?.dispose();
    this.flareTex?.dispose();
    this.dust = null;
    this.dustGeo = null;
    this.dustMat = null;
    this.fibers = null;
    this.fiberGeo = null;
    this.fiberMat = null;
    this.nodes = null;
    this.nodeGeo = null;
    this.nodeMat = null;
    this.flow = null;
    this.flowGeo = null;
    this.flowMat = null;
  }

  /** Swap to a new tier: rebuild geometry + bloom resolution, keep renderer. */
  private applyTier(cfg: TierConfig): void {
    this.cfg = cfg;
    this.teardownRenderables();
    this.buildGeometry();
    if (this.bloomPass) {
      this.bloomPass.strength = cfg.bloomStrength;
    }
    this.applyBloomSize();
    this.applyStateTargets();
    if (!this.reducedMotion) this.renderStatic(2);
    this.onTierChange?.(cfg.tier);
    // report immediately so consumers see the step-down
    this.emitStats(true);
  }

  /* --------------------------- state targets ---------------------------- */

  private applyStateTargets(): void {
    const i = this.intensity;
    const energy = 0.5 + i;
    const bloomScale = 0.72 + i * 0.5;

    const base: ParamState = {
      rot: 0.05,
      flow: 1,
      turb: 0.12,
      wave: 0,
      inward: 0,
      illum: 0.35,
      contract: 1,
      bloom: this.cfg.bloomStrength,
      breathAmt: 0.6,
      breathSpeed: TWO_PI / 4.4,
      pulseAmt: 0.5,
      pulseSpeed: 0.32,
      risk: 0,
      gain: 0,
      flash: 0.6,
    };

    switch (this.state) {
      case 'thinking':
        base.rot = 1.4;
        base.flow = 2.0;
        base.turb = 0.3;
        base.wave = 1;
        base.inward = 0.6;
        base.illum = 0.85;
        base.contract = 0.95;
        base.bloom = this.cfg.bloomStrength * 1.25;
        base.breathAmt = 1.0;
        base.breathSpeed = TWO_PI / 2.6;
        base.pulseAmt = 0.95;
        base.pulseSpeed = 0.52;
        base.risk = 0.05;
        base.flash = 1.5;
        break;
      case 'insight':
        base.rot = 1.0;
        base.flow = 1.5;
        base.turb = 0.2;
        base.wave = 0.3;
        base.inward = 0.12;
        base.illum = 0.6;
        base.contract = 1.05;
        base.bloom = this.cfg.bloomStrength * 1.45;
        base.breathAmt = 0.85;
        base.breathSpeed = TWO_PI / 3.4;
        base.pulseAmt = 1.25;
        base.pulseSpeed = 0.46;
        base.gain = 0.35;
        base.flash = 2.0;
        break;
      case 'risk':
        base.rot = 1.2;
        base.flow = 0.7;
        base.turb = 1.0;
        base.wave = 0.18;
        base.inward = 0;
        base.illum = 0.25;
        base.contract = 1.02;
        base.bloom = this.cfg.bloomStrength * 1.1;
        base.breathAmt = 0.5;
        base.breathSpeed = TWO_PI / 5.6;
        base.pulseAmt = 0.35;
        base.pulseSpeed = 0.22;
        base.risk = 1;
        base.flash = 2.3;
        break;
      case 'idle':
      default:
        break;
    }

    this.tgt = {
      rot: base.rot * energy,
      flow: base.flow * (0.65 + i * 0.85),
      turb: base.turb * (0.5 + i),
      wave: base.wave,
      inward: base.inward,
      illum: base.illum,
      contract: base.contract,
      bloom: base.bloom * bloomScale,
      breathAmt: base.breathAmt,
      breathSpeed: base.breathSpeed,
      pulseAmt: base.pulseAmt,
      pulseSpeed: base.pulseSpeed,
      risk: base.risk,
      gain: base.gain,
      flash: base.flash * (0.5 + i * 1.3),
    };
  }

  /* ------------------------------ the loop ------------------------------ */

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);

    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(0.05, dt);

    if (this.paused || this.hidden || this.contextLost) return;

    this.time += dt;

    // eased parameter crossfade
    const k = 1 - Math.exp(-dt / PARAM_TAU);
    const keys = Object.keys(this.cur) as (keyof ParamState)[];
    for (const key of keys) {
      this.cur[key] += (this.tgt[key] - this.cur[key]) * k;
    }

    // headline motion: breathing + outward pulse
    this.breathAngle += dt * this.cur.breathSpeed;
    const cycle = Math.floor(this.breathAngle / TWO_PI);
    if (cycle !== this.breathCycle) {
      this.breathCycle = cycle;
      this.triggerFlareBurst(); // node flares synced to the breath cycle
    }
    this.pulseFront += dt * this.cur.pulseSpeed;
    if (this.pulseFront > PULSE_SPAN) this.pulseFront -= PULSE_SPAN;

    // insight one-shot decay
    if (this.pulse > 0.0001) this.pulse *= Math.exp(-dt / 0.6);
    else this.pulse = 0;

    // additional random node flares on top of the breath-synced burst
    this.flareTimer += dt;
    const interval = 1 / Math.max(0.05, this.cur.flash);
    if (this.flareTimer >= interval) {
      this.flareTimer = 0;
      this.triggerFlare();
    }

    this.updateUniforms(dt);
    this.composer?.render();

    this.trackFps(dt, now);
  };

  private triggerFlare(): void {
    if (!this.flareData) return;
    const n = Math.max(1, this.nodeCount);
    const idx = Math.floor(Math.random() * n);
    this.flareData[idx * 4] = this.time;
    if (this.flareTex) this.flareTex.needsUpdate = true;
  }

  /** A burst of flares across the shell, fired once per breath cycle. */
  private triggerFlareBurst(): void {
    if (!this.flareData) return;
    const n = Math.max(1, this.nodeCount);
    const burst = Math.max(3, Math.round(n * 0.06));
    for (let i = 0; i < burst; i++) {
      const idx = Math.floor(Math.random() * n);
      this.flareData[idx * 4] = this.time;
    }
    if (this.flareTex) this.flareTex.needsUpdate = true;
  }

  private updateUniforms(dt: number): void {
    const c = this.cur;
    const pulse = this.pulse;
    const breathPhase = Math.sin(this.breathAngle);

    const radius = this.radius * (c.contract + pulse * 0.04);

    if (this.dustMat) {
      const u = this.dustMat.uniforms;
      u.uTime.value = this.time;
      u.uRadius.value = radius;
      u.uWave.value = c.wave;
      u.uTurb.value = c.turb;
      u.uBreathAmt.value = c.breathAmt;
      u.uBreathPhase.value = breathPhase;
      u.uPulseFront.value = this.pulseFront;
      u.uPulseAmt.value = c.pulseAmt * (1 + pulse * 0.6);
      u.uRiskMix.value = c.risk;
      u.uOpacity.value = 0.008 + 0.008 * clamp01(this.intensity);
    }
    // fibre brightness: additive ribbons overlap heavily, so keep it modest
    if (this.fiberMat) {
      const u = this.fiberMat.uniforms;
      u.uTime.value = this.time;
      u.uRadius.value = radius;
      u.uCamDist.value = this.camDist;
      u.uWave.value = c.wave;
      u.uBreathAmt.value = c.breathAmt;
      u.uBreathPhase.value = breathPhase;
      u.uPulseFront.value = this.pulseFront;
      u.uPulseAmt.value = c.pulseAmt * (1 + pulse * 0.8);
      u.uIllum.value = c.illum * (0.75 + pulse);
      u.uRiskMix.value = c.risk;
      u.uOpacity.value = (0.012 + 0.012 * clamp01(this.intensity) + pulse * 0.02) * (1.0 + c.risk * 0.25);
    }
    if (this.nodeMat) {
      const u = this.nodeMat.uniforms;
      u.uTime.value = this.time;
      u.uRadius.value = radius;
      u.uWave.value = c.wave;
      u.uBreathAmt.value = c.breathAmt;
      u.uBreathPhase.value = breathPhase;
      u.uPulseFront.value = this.pulseFront;
      u.uPulseAmt.value = c.pulseAmt * (1 + pulse * 0.8);
      u.uRiskMix.value = c.risk;
      u.uOpacity.value = 0.34 + 0.12 * clamp01(this.intensity) + pulse * 0.1;
      u.uRim.value = 0.55;
    }
    if (this.flowMat) {
      const u = this.flowMat.uniforms;
      u.uTime.value = this.time;
      u.uFlowSpeed.value = c.flow;
      u.uInward.value = c.inward;
      u.uTurb.value = c.turb;
      u.uRiskMix.value = c.risk;
      u.uBreathAmt.value = c.breathAmt;
      u.uBreathPhase.value = breathPhase;
      u.uPulseFront.value = this.pulseFront;
      u.uPulseAmt.value = c.pulseAmt * (1 + pulse * 0.8);
      u.uOpacity.value = (0.72 + 0.28 * clamp01(this.intensity)) * (1.0 + c.risk * 0.4);
    }
    if (this.bloomPass) {
      this.bloomPass.strength = c.bloom * (1 + pulse * 0.6);
    }

    // rotation
    this.world.rotation.y += c.rot * dt;
    this.world.rotation.x = Math.sin(this.time * 0.13) * 0.12;
  }

  /* ------------------------------- stats -------------------------------- */

  private trackFps(dt: number, now: number): void {
    const fps = 1 / dt;
    this.fpsEma = this.fpsEma * 0.9 + fps * 0.1;

    this.fpsRoll.push(fps);
    // keep ~1s of samples at 60fps
    if (this.fpsRoll.length > 90) this.fpsRoll.shift();
    const avg = this.fpsRoll.reduce((a, b) => a + b, 0) / this.fpsRoll.length;

    // adaptive downgrade: sustained < 45fps for ~3s while auto
    if (this.qualityAuto) {
      if (avg < 45 && this.fpsRoll.length > 30) {
        if (this.lowFpsSince === 0) this.lowFpsSince = now;
        else if (now - this.lowFpsSince > 3000) {
          this.lowFpsSince = 0;
          this.fpsRoll = [];
          this.maybeDowngrade();
        }
      } else {
        this.lowFpsSince = 0;
      }
    }

    this.emitStats(false);
  }

  private maybeDowngrade(): void {
    const next = nextTierBelow(this.cfg.tier);
    if (!next || this.downgraded.has(next)) return;
    this.downgraded.add(next);
    this.applyTier(TIERS[next]);
  }

  private emitStats(force: boolean): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this.lastStats < 500) return; // ~2/s
    this.lastStats = now;
    this.onStats?.({
      tier: this.cfg.tier,
      particles: this.particleCount,
      nodes: this.nodeCount,
      edges: this.edgeCount,
      // 0 in reduced-motion: there is no animation loop to measure.
      fps: this.reducedMotion ? 0 : Math.round(this.fpsEma * 10) / 10,
      reducedMotion: this.reducedMotion,
    });
  }

  getStats(): CoreStats {
    return {
      tier: this.cfg.tier,
      particles: this.particleCount,
      nodes: this.nodeCount,
      edges: this.edgeCount,
      fps: this.reducedMotion ? 0 : Math.round(this.fpsEma * 10) / 10,
      reducedMotion: this.reducedMotion,
    };
  }

  /* ----------------------------- context loss ---------------------------- */

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.last = performance.now();
    try {
      this.renderStatic(2);
    } catch {
      /* ignore — never throw from a context-restore handler */
    }
  };

  /* ------------------------------- dispose ------------------------------- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();

    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.teardownRenderables();

    try {
      this.alphaPass?.dispose?.();
      this.bloomPass?.dispose?.();
      this.composer?.dispose?.();
    } catch {
      /* ignore */
    }

    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* ignore */
    }

    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

export type { Tier, TierConfig } from './core-tiers';
