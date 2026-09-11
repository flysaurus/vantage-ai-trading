'use client';

// ─── SectorAllocation (PART 3.4) ────────────────────────────
// Stacked bar + legend of the portfolio's sector mix, weighted by MARKET VALUE.
// Positions carry `sector`; anything unclassified falls into "Other". Colours
// are a fixed, theme-safe palette (they read on both the light canvas and the
// dark panel) — the markup itself uses no hardcoded hex outside this palette.
import { useMemo } from 'react';
import type { Position } from '@/types';

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

export function SectorAllocation({ positions }: { positions: Position[] }) {
  const rows = useMemo(() => {
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
      .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.pct - a.pct)
      .map((r, i) => ({ ...r, color: PALETTE[i % PALETTE.length] }));
  }, [positions]);

  if (rows.length === 0) return null;

  return (
    <section style={{ margin: '0 20px 16px' }} data-testid="sector-allocation">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)', marginBottom: 10 }}>
        SECTOR ALLOCATION
      </div>
      <div style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 16, padding: 16 }}>
        {/* Stacked bar */}
        <div
          data-testid="sector-bar"
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
      </div>
    </section>
  );
}

export default SectorAllocation;
