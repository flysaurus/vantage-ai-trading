'use client';

// ─── AssetMixChart (Task 9, Part 1) ──────────────────────────
// "How much of my portfolio is ETFs vs individual stocks?"
// A question about the STRUCTURE of the book — deliberately NOT the sector
// chart (Sector Allocation answers exposure, this answers composition).
//
// One two-segment bar + a two-line legend, styled to match SectorAllocation
// (same card, same 12px bar, same label rhythm).

import type { AssetMix } from '@/lib/portfolio/sector-mix';

const ETF_COLOR = '#0e8c99';
const STOCK_COLOR = '#5b4bc4';

function usd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function Segment({
  label,
  pct,
  value,
  color,
  testId,
}: {
  label: string;
  pct: number;
  value: number;
  color: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      data-pct={pct.toFixed(1)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--v-text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--v-text-primary)' }}>{pct.toFixed(1)}%</span>
      <span style={{ fontSize: 11, color: 'var(--v-text-faint)', whiteSpace: 'nowrap' }}>{usd(value)}</span>
    </div>
  );
}

export function AssetMixChart({ mix }: { mix: AssetMix | null }) {
  if (!mix || mix.total <= 0) return null;

  const segments = [
    { label: 'ETFs', pct: mix.etfPct, value: mix.etfValue, color: ETF_COLOR, testId: 'asset-mix-segment-etf' },
    { label: 'Stocks', pct: mix.stockPct, value: mix.stockValue, color: STOCK_COLOR, testId: 'asset-mix-segment-stock' },
  ].filter((s) => s.pct > 0);

  return (
    <section style={{ margin: '0 20px 16px' }} data-testid="asset-mix">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)', marginBottom: 10 }}>
        ETF VS STOCKS
      </div>
      <div
        style={{
          background: 'var(--v-card)',
          border: '0.5px solid var(--v-card-border)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div
          data-testid="asset-mix-bar"
          style={{ display: 'flex', width: '100%', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--v-skel-a)' }}
        >
          {segments.map((s) => (
            <span
              key={s.label}
              title={`${s.label} · ${s.pct.toFixed(1)}%`}
              style={{ width: `${s.pct}%`, background: s.color, flexShrink: 0 }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 12 }}>
          {segments.map((s) => (
            <Segment key={s.label} {...s} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--v-text-muted)', marginTop: 10 }}>
          {mix.etfCount} ETF{mix.etfCount === 1 ? '' : 's'} · {mix.stockCount} individual holding
          {mix.stockCount === 1 ? '' : 's'}
        </div>
      </div>
    </section>
  );
}

export default AssetMixChart;
