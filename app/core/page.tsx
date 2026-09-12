'use client';

/**
 * /core — live preview of the Portfolio Intelligence Core.
 *
 * Public, unlisted route so the visual can be reviewed (and shared) without a
 * session. It renders nothing but the WebGL island and its controls: no data,
 * no API calls, no auth.
 *
 * Deep links / harness use:
 *   /core?state=idle|thinking|insight|risk&intensity=0.5&quality=auto&bg=card|light|dark
 *
 * Live stats are mirrored onto window.__coreStats and into [data-testid="core-stats"].
 */

import React, { useEffect, useState } from 'react';
import {
  PortfolioIntelligenceCore,
  type CoreState,
  type CoreStatsPayload,
} from '@/components/ai/core/PortfolioIntelligenceCore';

declare global {
  interface Window {
    __coreStats?: CoreStatsPayload & { ready?: { tier: string; particles: number } };
  }
}

const STATES: CoreState[] = ['idle', 'thinking', 'insight', 'risk'];
const QUALITIES: Array<'auto' | 'high' | 'medium' | 'low'> = ['auto', 'high', 'medium', 'low'];
const BACKGROUNDS: Array<'card' | 'light' | 'dark'> = ['card', 'light', 'dark'];

const SURFACE: Record<'card' | 'light' | 'dark', string> = {
  card: '#17323B',
  dark: '#000814',
  light: '#f5f7f4',
};

const chip = (active: boolean): React.CSSProperties => ({
  font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
  padding: '5px 9px',
  borderRadius: 999,
  border: `1px solid ${active ? '#5FD8DE' : 'rgba(255,255,255,0.18)'}`,
  background: active ? 'rgba(95,216,222,0.16)' : 'rgba(255,255,255,0.04)',
  color: active ? '#9FF0F4' : 'rgba(233,245,246,0.75)',
  cursor: 'pointer',
  textTransform: 'capitalize',
});

export default function CorePreviewPage() {
  const [state, setState] = useState<CoreState>('idle');
  const [intensity, setIntensity] = useState(0.5);
  const [quality, setQuality] = useState<'auto' | 'high' | 'medium' | 'low'>('auto');
  const [bg, setBg] = useState<'card' | 'light' | 'dark'>('card');
  const [stats, setStats] = useState<Window['__coreStats']>(undefined);

  // Honour deep links (?state=…&intensity=…) without breaking hydration.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get('state') as CoreState | null;
    if (s && STATES.includes(s)) setState(s);
    const i = p.get('intensity');
    if (i !== null && Number.isFinite(Number(i))) {
      setIntensity(Math.max(0, Math.min(1, Number(i))));
    }
    const q = p.get('quality') as (typeof QUALITIES)[number] | null;
    if (q && QUALITIES.includes(q)) setQuality(q);
    const b = p.get('bg') as (typeof BACKGROUNDS)[number] | null;
    if (b && BACKGROUNDS.includes(b)) setBg(b);
  }, []);

  const surface = SURFACE[bg];
  const onLight = bg === 'light';

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: surface,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '44px 16px 104px',
        margin: 0,
        boxSizing: 'border-box',
      }}
    >
      <header style={{ textAlign: 'center' }}>
        <p
          style={{
            margin: 0,
            font: '600 11px ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: onLight ? 'rgba(23,50,59,0.55)' : 'rgba(159,240,244,0.7)',
          }}
        >
          Vantage · Portfolio Intelligence
        </p>
        <h1
          style={{
            margin: '6px 0 0',
            font: '400 22px/1.2 ui-serif, Georgia, "Times New Roman", serif',
            fontStyle: 'italic',
            color: onLight ? '#17323B' : '#E9F5F6',
          }}
        >
          The Core
        </h1>
      </header>

      <div
        style={{
          width: 'min(92vw, 74vh, 620px)',
          height: 'min(92vw, 74vh, 620px)',
          position: 'relative',
        }}
      >
        <PortfolioIntelligenceCore
          state={state}
          intensity={intensity}
          quality={quality}
          ariaLabel="Portfolio intelligence core"
          onReady={(r) => {
            window.__coreStats = { ...(window.__coreStats as CoreStatsPayload), ready: r } as never;
          }}
          onStats={(s) => {
            window.__coreStats = { ...s, ready: window.__coreStats?.ready } as never;
            setStats(window.__coreStats);
          }}
        />
      </div>

      <div
        data-testid="core-stats"
        style={{
          font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
          color: onLight ? 'rgba(23,50,59,0.6)' : 'rgba(233,245,246,0.6)',
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        {stats
          ? `${stats.tier} · ${stats.particles} particles · ${stats.nodes} nodes · ${stats.fps} fps${stats.reducedMotion ? ' · reduced motion' : ''}`
          : 'bringing the core online…'}
      </div>

      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 14px calc(14px + env(safe-area-inset-bottom, 0px))',
          background: 'rgba(4,14,18,0.82)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(95,216,222,0.16)',
          zIndex: 5,
        }}
      >
        {STATES.map((s) => (
          <button key={s} data-state={s} onClick={() => setState(s)} style={chip(state === s)}>
            {s}
          </button>
        ))}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            font: '11px ui-monospace, monospace',
            color: 'rgba(233,245,246,0.75)',
          }}
        >
          intensity {intensity.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            style={{ width: 96 }}
          />
        </label>

        {QUALITIES.map((q) => (
          <button key={q} onClick={() => setQuality(q)} style={chip(quality === q)}>
            {q}
          </button>
        ))}

        {BACKGROUNDS.map((b) => (
          <button key={b} onClick={() => setBg(b)} style={chip(bg === b)}>
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}
