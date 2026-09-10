// ─── Threshold-crossing pill ────────────────────────────────
// One shared pill for the inline threshold badge ("▲ crossed +250%" /
// "▼ crossed -20%") that sits NEXT TO THE TICKER on a position row.
//
// It is rendered on the position cards, which live on the always-dark card
// surface (`--bg-card: #1a2235` in both themes — see app/globals.css), so the
// pill uses its own badge tokens rather than --v-gain/--v-loss (which are
// tuned for the theme canvas and would be unreadable there in light mode).

'use client';

import React from 'react';
import type { ThresholdCrossing } from '@/lib/insights/threshold-badge';

interface Props {
  crossing: ThresholdCrossing | null | undefined;
  /** Extra test ids are derived from the symbol so harnesses can target one row. */
  testId?: string;
}

export function ThresholdBadgePill({ crossing, testId }: Props) {
  if (!crossing) return null;
  const gain = crossing.tone === 'gain';

  return (
    <span
      data-testid={testId || 'threshold-badge'}
      data-symbol={crossing.symbol}
      data-tone={crossing.tone}
      data-threshold={crossing.threshold}
      title={
        crossing.currentPnlPct != null
          ? `${crossing.symbol} is currently at ${crossing.currentPnlPct > 0 ? '+' : ''}${crossing.currentPnlPct}% total return`
          : undefined
      }
      style={{
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.4,
        padding: '1px 6px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        fontFamily: 'inherit',
        color: gain ? 'var(--v-badge-gain)' : 'var(--v-badge-loss)',
        background: gain ? 'var(--v-badge-gain-bg)' : 'var(--v-badge-loss-bg)',
      }}
    >
      {crossing.text}
    </span>
  );
}

export default ThresholdBadgePill;
