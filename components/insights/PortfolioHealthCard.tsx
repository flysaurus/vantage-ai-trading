// ─── Insights: Portfolio Health card ───────────────────────
// Renders the DETERMINISTIC score from lib/insights/health-score.ts.
// The number is computed client-side from real holdings data — no LLM,
// no cached prose. "Ask Rufus to explain" only *interprets* it.

'use client';

import React, { useMemo } from 'react';
import type { Position } from '@/types';
import { useTabStore } from '@/store';
import { computePortfolioHealth } from '@/lib/insights/health-score';

interface Props {
  positions: Position[];
  cash: number;
  totalPnlPercent: number;
  riskTolerance?: string | null;
}

const SUB_LABELS: { key: 'diversification' | 'riskBalance' | 'returns'; label: string }[] = [
  { key: 'diversification', label: 'Diversification' },
  { key: 'riskBalance', label: 'Risk balance' },
  { key: 'returns', label: 'Returns' },
];

export function PortfolioHealthCard({ positions, cash, totalPnlPercent, riskTolerance }: Props) {
  const { setChatOpen, setPendingPrompt } = useTabStore();

  const health = useMemo(
    () =>
      computePortfolioHealth({
        positions: positions.map((p) => ({
          symbol: p.symbol,
          marketValue: p.marketValue || p.qty * (p.currentPrice || p.avgCost) || 0,
          sector: (p as any).sector ?? null,
        })),
        cash,
        totalPnlPercent,
        riskTolerance,
      }),
    [positions, cash, totalPnlPercent, riskTolerance],
  );

  return (
    <section
      data-testid="portfolio-health-card"
      data-health-score={health.score}
      style={{
        margin: '24px 20px 0',
        background: 'var(--v-card)',
        border: '0.5px solid var(--v-card-border)',
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)' }}>
        PORTFOLIO HEALTH
      </div>

      {/* deterministic score */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
        <span
          data-testid="health-score"
          style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: 40,
            lineHeight: 1,
            color: 'var(--v-text-primary)',
          }}
        >
          {health.score}
        </span>
        <span style={{ fontSize: 15, color: 'var(--v-text-muted)' }}>/100</span>
        <span
          data-testid="health-grade"
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color:
              health.grade === 'Strong'
                ? 'var(--v-gain)'
                : health.grade === 'Fair'
                  ? 'var(--v-accent)'
                  : 'var(--v-loss)',
          }}
        >
          {health.grade.toUpperCase()}
        </span>
      </div>

      {/* three sub-scores */}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SUB_LABELS.map(({ key, label }) => {
          const v = health.subScores[key];
          return (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 12.5, color: 'var(--v-text-secondary)' }}>{label}</span>
                <span
                  data-testid={`health-subscore-${key}`}
                  data-value={v}
                  style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--v-text-primary)' }}
                >
                  {v}
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 999,
                  background: 'var(--v-card-border)',
                  marginTop: 6,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${v}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: v >= 70 ? 'var(--v-gain)' : v >= 45 ? 'var(--v-accent)' : 'var(--v-loss)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* data-derived line — always names a real holding + real % */}
      <p
        data-testid="health-supporting-line"
        style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v-text-secondary)', marginTop: 16 }}
      >
        {health.supportingLine}
      </p>

      <button
        type="button"
        data-testid="health-ask-rufus"
        onClick={() => {
          setPendingPrompt(health.explainPrompt);
          setChatOpen(true);
        }}
        style={{
          marginTop: 12,
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--v-accent)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
        }}
      >
        Ask Rufus to explain
      </button>
    </section>
  );
}

export default PortfolioHealthCard;
