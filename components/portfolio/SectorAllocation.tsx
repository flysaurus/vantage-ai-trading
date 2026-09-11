'use client';

// ─── SectorAllocation (PART 3.4 / Task 9 Part 2) ────────────
// Stacked bar + legend of the portfolio's sector mix, weighted by MARKET VALUE.
//
// Two modes:
//   1. DECOMPOSED (preferred) — pass `mix` from POST /api/portfolio/sector-mix.
//      Each fund's underlying sector weights (Yahoo `topHoldings`, resolved by
//      lib/etf-sectors.ts) are folded in, so a broad-market ETF shows up as
//      Technology / Financial Services / Healthcare / … instead of one opaque
//      "ETF"/"Broad Market" slice. Buckets use the same vocabulary as the drift
//      engine (normalizeSectorBucket) so stocks and funds share one axis.
//   2. FALLBACK — no `mix` yet (first paint / provider down): the original
//      per-position `sector` grouping, unchanged.
//
// Colours are a fixed, theme-safe palette (they read on both the light canvas
// and the dark panel) — the markup itself uses no hardcoded hex outside this
// palette.
import { useMemo } from 'react';
import type { Position } from '@/types';
import type { AssetMix } from '@/lib/portfolio/sector-mix';

const PALETTE = [
  '#0e8c99',
  '#3ddc84',
  '#5b4bc4',
  '#d9a94a',
  '#d64545',
  '#3a6ecd',
  '#a97bd6',
  '#7c8899',
];

/** Legend labels are tight at 430px — shorten the two longest buckets so they
 *  never get ellipsised. (Keys are the canonical bucket vocabulary.) */
const SHORT_BUCKET: Record<string, string> = {
  'Media & Entertainment': 'Media & Ent.',
  'Financial Services': 'Financials',
  'Broad Market': 'Broad Mkt',
  'Fixed Income': 'Fixed Inc.',
};

interface Row {
  sector: string;
  value: number;
  pct: number;
  color: string;
}

export function SectorAllocation({
  positions,
  mix,
}: {
  positions: Position[];
  /** Decomposed sector mix (Part 2). When present it is the source of truth. */
  mix?: AssetMix | null;
}) {
  const rows = useMemo<Row[]>(() => {
    // ── 1. Decomposed ETF-aware mix ──
    if (mix && mix.buckets.length > 0 && mix.total > 0) {
      return mix.buckets.map((b, i) => ({
        sector: SHORT_BUCKET[b.bucket] || b.bucket,
        value: b.value,
        pct: b.pct,
        color: PALETTE[i % PALETTE.length],
      }));
    }

    // ── 2. Fallback: position sectors as-reported ──
    const byValue = new Map<string, number>();
    let total = 0;
    for (const p of positions) {
      const v = p.marketValue || p.qty * (p.currentPrice || p.avgCost) || 0;
      if (!v) continue;
      const key = (p.sector && p.sector.trim()) || 'Other';
      byValue.set(key, (byValue.get(key) || 0) + v);
      total += v;
    }
    if (total <= 0) return [];
    return Array.from(byValue.entries())
      .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100, color: '' }))
      .sort((a, b) => b.pct - a.pct)
      .map((r, i) => ({ ...r, color: PALETTE[i % PALETTE.length] }));
  }, [positions, mix]);

  if (rows.length === 0) return null;

  const decomposed = !!mix && mix.buckets.length > 0 && mix.total > 0;

  return (
    <section style={{ margin: '0 20px 16px' }} data-testid="sector-allocation">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)', marginBottom: 10 }}>
        SECTOR ALLOCATION
      </div>
      <div style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 16, padding: 16 }}>
        {/* Stacked bar */}
        <div
          data-testid="sector-bar"
          data-decomposed={decomposed ? 'true' : 'false'}
          style={{ display: 'flex', width: '100%', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--v-skel-a)' }}
        >
          {rows.map((r) => (
            <span
              key={r.sector}
              title={`${r.sector} · ${r.pct.toFixed(1)}%`}
              style={{ width: `${r.pct}%`, background: r.color, flexShrink: 0 }}
            />
          ))}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 12 }}>
          {rows.map((r) => (
            <div key={r.sector} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--v-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '16ch' }}>
                {r.sector}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--v-text-primary)' }}>{r.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
        {decomposed && (
          <div data-testid="sector-decomposed-note" style={{ fontSize: 11, color: 'var(--v-text-muted)', marginTop: 10 }}>
            ETF sector exposure decomposed into its underlying holdings.
          </div>
        )}
        {decomposed && (mix?.unresolvedFundish?.length ?? 0) > 0 && (
          <div data-testid="sector-unresolved-note" style={{ fontSize: 11, color: 'var(--v-text-muted)', marginTop: 4 }}>
            {mix!.unresolvedFundish!.length === 1
              ? `${mix!.unresolvedFundish![0]} has no sector breakdown yet — its value sits under “Other”.`
              : `${mix!.unresolvedFundish!.length} funds have no sector breakdown yet — their value sits under “Other”.`}
          </div>
        )}
        {decomposed && (mix?.otherSymbols?.length ?? 0) > 0 && (
          <div data-testid="sector-other-note" style={{ fontSize: 11, color: 'var(--v-text-muted)', marginTop: 4 }}>
            {mix!.otherSymbols!.length === 1
              ? `${mix!.otherSymbols![0]} has no sector on file yet — grouped under “Other”.`
              : `${mix!.otherSymbols!.length} holdings have no sector on file yet — grouped under “Other” (${mix!.otherSymbols!.slice(0, 4).join(', ')}${mix!.otherSymbols!.length > 4 ? '…' : ''}).`}
          </div>
        )}
      </div>
    </section>
  );
}

export default SectorAllocation;
