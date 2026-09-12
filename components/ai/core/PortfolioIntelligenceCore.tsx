'use client';

/**
 * PortfolioIntelligenceCore.tsx
 * ---------------------------------------------------------------------------
 * The Vantage AI visual-identity island: a luminous, procedurally-generated
 * particle constellation.
 *
 * This component is deliberately paranoid. It is a feature-flagged island, so a
 * failure here must never be able to take down the page:
 *   • `three` is NEVER imported at module scope — the engine is dynamic-imported
 *     inside an effect, so three.js is code-split and only fetched on mount.
 *   • every step (probe, import, construct, resize, prop sync) is wrapped so a
 *     missing WebGL context, a missing canvas, or a thrown engine error simply
 *     leaves an empty, correctly-sized container behind.
 *
 * Public API is frozen — integration depends on it. See ./README.md.
 */

import React, { useEffect, useRef } from 'react';
import { detectCapability, TIERS, type Tier, type TierConfig } from './core-tiers';
import type { CoreEngine, CoreStats } from './core-engine';

export type CoreState = 'idle' | 'thinking' | 'insight' | 'risk';

export interface CoreStatsPayload {
  tier: 'high' | 'medium' | 'low';
  particles: number;
  nodes: number;
  edges: number;
  fps: number;
  reducedMotion: boolean;
}

export interface PortfolioIntelligenceCoreProps {
  state?: CoreState;
  intensity?: number;
  paused?: boolean;
  quality?: 'auto' | 'high' | 'medium' | 'low';
  className?: string;
  style?: React.CSSProperties;
  onStats?: (s: CoreStatsPayload) => void;
  onReady?: (s: { tier: string; particles: number }) => void;
  ariaLabel?: string;
}

const DEFAULT_ARIA = 'Portfolio intelligence';

export function PortfolioIntelligenceCore({
  state = 'idle',
  intensity = 0.5,
  paused = false,
  quality = 'auto',
  className,
  style,
  onStats,
  onReady,
  ariaLabel = DEFAULT_ARIA,
}: PortfolioIntelligenceCoreProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CoreEngine | null>(null);
  const detectedTierRef = useRef<Tier>('medium');

  // Keep the latest callbacks / props without re-running the mount effect.
  const cbRef = useRef({ onStats, onReady });
  cbRef.current = { onStats, onReady };
  const stateRef = useRef(state);
  stateRef.current = state;
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  /* ----------------------------- mount once ----------------------------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let mq: MediaQueryList | null = null;
    let onMq: ((e: MediaQueryListEvent) => void) | null = null;
    let onVis: (() => void) | null = null;

    const start = async () => {
      // 1. capability probe on a throwaway context
      let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
      try {
        const probe = document.createElement('canvas');
        gl = (probe.getContext('webgl2') || probe.getContext('webgl')) as
          | WebGLRenderingContext
          | WebGL2RenderingContext
          | null;
      } catch {
        gl = null;
      }
      if (!gl) return; // no WebGL → leave empty container, no crash

      const cap = detectCapability(gl);
      detectedTierRef.current = cap.tier;
      try {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        /* ignore */
      }

      const q = qualityRef.current;
      const auto = q === 'auto';
      const cfg: TierConfig = auto ? TIERS[cap.tier] : TIERS[q];

      // 2. reduced-motion preference
      try {
        mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      } catch {
        mq = null;
      }
      const reduced = !!mq && mq.matches;

      // 3. dynamic import — three.js is fetched lazily here and nowhere else
      let mod: typeof import('./core-engine');
      try {
        mod = await import('./core-engine');
      } catch {
        return; // engine failed to load → empty container
      }
      if (cancelled) return;

      // 4. construct
      let engine: CoreEngine;
      try {
        engine = new mod.CoreEngine({
          host,
          tierConfig: cfg,
          qualityAuto: auto,
          state: stateRef.current,
          intensity: intensityRef.current,
          reducedMotion: reduced,
        });
      } catch {
        return;
      }
      engineRef.current = engine;

      engine.onStats = (s: CoreStats) => {
        cbRef.current.onStats?.({
          tier: s.tier,
          particles: s.particles,
          nodes: s.nodes,
          edges: s.edges,
          fps: s.fps,
          reducedMotion: s.reducedMotion,
        });
      };

      // The engine is constructed asynchronously. Any prop that changed between
      // first paint and this point would otherwise be stranded: the prop-sync
      // effects ran while `engineRef.current` was still null. Re-apply them here.
      try {
        const q0 = qualityRef.current;
        if (q0 === 'auto') engine.setAutoQuality(true);
        else engine.setQualityExplicit(q0);
        engine.setState(stateRef.current);
        engine.setIntensity(intensityRef.current);
      } catch {
        /* ignore */
      }

      // Push one payload up front. In reduced-motion mode no loop ever runs, so
      // this is the only chance the consumer gets to see `reducedMotion: true`.
      try {
        const s0 = engine.getStats();
        cbRef.current.onStats?.({ ...s0 });
      } catch {
        /* ignore */
      }

      // 5. size + start
      try {
        const rect = host.getBoundingClientRect();
        engine.setSize(rect.width || 300, rect.height || 300);
        cbRef.current.onReady?.({ tier: cfg.tier, particles: cfg.particles });

        engine.setPaused(pausedRef.current || document.hidden);
        if (reduced) engine.renderStatic(2);
        else engine.start();
      } catch {
        /* keep the container; never throw */
      }

      // 6. responsive sizing
      try {
        ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const cr = entry.contentRect;
            try {
              engine.setSize(cr.width, cr.height);
            } catch {
              /* ignore */
            }
          }
        });
        ro.observe(host);
      } catch {
        ro = null;
      }

      // 7. live reduced-motion switching
      onMq = () => {
        try {
          engine.setReducedMotion(!!mq && mq.matches);
        } catch {
          /* ignore */
        }
      };
      try {
        mq?.addEventListener?.('change', onMq);
      } catch {
        /* ignore */
      }

      // 8. auto-pause when the tab is hidden
      onVis = () => {
        try {
          engine.setPaused(pausedRef.current || document.hidden);
        } catch {
          /* ignore */
        }
      };
      document.addEventListener('visibilitychange', onVis);
    };

    void start();

    return () => {
      cancelled = true;
      try {
        ro?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        if (mq && onMq) mq.removeEventListener?.('change', onMq);
      } catch {
        /* ignore */
      }
      try {
        if (onVis) document.removeEventListener('visibilitychange', onVis);
      } catch {
        /* ignore */
      }
      try {
        engineRef.current?.dispose();
      } catch {
        /* ignore */
      }
      engineRef.current = null;
    };
  }, []);

  /* ----------------------------- prop sync ------------------------------ */
  useEffect(() => {
    try {
      engineRef.current?.setState(state);
    } catch {
      /* ignore */
    }
  }, [state]);

  useEffect(() => {
    try {
      engineRef.current?.setIntensity(intensity);
    } catch {
      /* ignore */
    }
  }, [intensity]);

  useEffect(() => {
    try {
      engineRef.current?.setPaused(!!paused || document.hidden);
    } catch {
      /* ignore */
    }
  }, [paused]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      if (quality === 'auto') engine.setAutoQuality(true);
      else engine.setQualityExplicit(quality);
    } catch {
      /* ignore */
    }
  }, [quality]);

  return (
    <div
      ref={hostRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 220,
        overflow: 'hidden',
        ...style,
      }}
    />
  );
}

export default PortfolioIntelligenceCore;
