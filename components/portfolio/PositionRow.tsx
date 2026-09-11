'use client';

// ─── PositionRow (PART 3.7) ─────────────────────────────────
// The Holdings position-list row. Lightweight by design: the ONLY detail view
// is the canonical full-screen PositionDetail (opened via onOpen). Left = icon
// avatar (coloured initials) + ticker (with inline threshold-crossing badge) +
// company name + share count. Right = MARKET VALUE + TOTAL gain % (no Today
// column — Today lives on the detail screen). All colours are `--v-*` tokens.
import React from 'react';
import type { Position } from '@/types';
import type { ThresholdCrossing } from '@/lib/insights/threshold-badge';
import { avatarColor, initials } from '@/lib/position-avatar';
import { ThresholdBadgePill } from './ThresholdBadgePill';

interface Props {
  pos: Position;
  crossing?: ThresholdCrossing | null;
  onOpen: () => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctStr = (n: number | null | undefined) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);

export function PositionRow({ pos, crossing, onOpen, selectMode = false, isSelected = false, onToggleSelect }: Props) {
  const symbol = (pos.symbol || '').toUpperCase();
  const tint = avatarColor(symbol);
  const marketValue = pos.marketValue || pos.qty * (pos.currentPrice || pos.avgCost) || 0;
  const costBasis = pos.totalCost ?? pos.qty * pos.avgCost;
  const totalPnl = pos.totalPnl ?? marketValue - costBasis;
  const totalPnlPct = pos.totalPnlPercent ?? (costBasis > 0 ? (totalPnl / costBasis) * 100 : 0);
  const shares = pos.qty % 1 === 0 ? String(pos.qty) : pos.qty.toFixed(4);

  return (
    <div
      data-testid={`position-row-${symbol}`}
      role="button"
      tabIndex={0}
      onClick={() => (selectMode ? onToggleSelect?.() : onOpen())}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode ? onToggleSelect?.() : onOpen(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', cursor: 'pointer',
        borderBottom: '0.5px solid var(--v-card-border)',
        background: isSelected ? 'var(--v-badge-gain-bg)' : 'transparent',
      }}
    >
      {selectMode && (
        <span
          aria-hidden="true"
          style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
            border: `1.5px solid ${isSelected ? 'var(--v-accent)' : 'var(--v-text-faint)'}`,
            background: isSelected ? 'var(--v-accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--v-accent-text)', fontSize: 12, fontWeight: 900,
          }}
        >
          {isSelected ? '✓' : ''}
        </span>
      )}

      <span
        aria-hidden="true"
        style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tint.bg, color: tint.fg, fontWeight: 800, fontSize: 12.5 }}
      >
        {initials(symbol)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--v-text-primary)', letterSpacing: '-0.01em' }}>{symbol}</span>
          <ThresholdBadgePill crossing={crossing} testId={`threshold-badge-${symbol}`} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--v-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {pos.name && pos.name !== symbol ? pos.name : (pos.type || 'Holding')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--v-text-muted)', marginTop: 1 }}>
          {shares} {Number(shares) === 1 ? 'share' : 'shares'}{pos.sector ? ` · ${pos.sector}` : ''}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--v-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(marketValue)}</div>
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2, color: totalPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontVariantNumeric: 'tabular-nums' }}>
          {pctStr(totalPnlPct)}
        </div>
      </div>
    </div>
  );
}

export default PositionRow;
