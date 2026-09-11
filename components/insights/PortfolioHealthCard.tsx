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
  /** Account data has not resolved yet — render a skeleton rather than a
   *  score computed from an EMPTY portfolio (which would read as a real
   *  "0 / Needs attention" verdict). */
  pending?: boolean;
  /** The load reached a TERMINAL failure (or timed out). A skeleton is only
   *  ever correct while something is genuinely still in flight — a failed fetch
   *  must resolve to a visible error, never an endless shimmer. (PART 3) */
  failed?: boolean;
  /** Retry handler for the failed state — re-runs the account fetch. */
  onRetry?: () => void;
}

const SUB_LABELS: { key: 'diversification' | 'riskBalance' | 'returns'; label: string }[] = [
  { key: 'diversification', label: 'Diversification' },
  { key: 'riskBalance', label: 'Risk balance' },
  { key: 'returns', label: 'Returns' },
];

export function PortfolioHealthCard({ positions, cash, totalPnlPercent, riskTolerance, pending = false, failed = false, onRetry }: Props) {
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
      data-health-score={pending || failed ? undefined : health.score}
      data-pending={pending ? 'true' : undefined}
      data-failed={failed ? 'true' : undefined}
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

      {failed ? (
        /* TERMINAL FAILURE — never a skeleton. A fetch that died must resolve to
           something a human can act on (PART 3: the silent permanent skeleton). */
        <>
          <p
            data-testid="health-error"
            style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--v-text-secondary)', marginTop: 12 }}
          >
            Couldn’t load this account’s health.
          </p>
          <button
            type="button"
            data-testid="health-retry"
            onClick={() => onRetry?.()}
            style={{
              marginTop: 12, background: 'none', border: '0.5px solid var(--v-card-border)',
              borderRadius: 999, padding: '7px 14px', color: 'var(--v-accent)',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Retry
          </button>
        </>
      ) : pending ? (
        // Nothing to score yet — shimmer, never a number.
        <>
          <span
            data-testid="health-skeleton"
            className="v-skel"
            style={{ width: 96, height: 36, borderRadius: 8, marginTop: 12 }}
            aria-hidden="true"
          />
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {SUB_LABELS.map(({ key, label }) => (
              <div key={key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--v-text-secondary)' }}>{label}</span>
                  <span
                    className="v-skel"
                    style={{ width: 26, height: 12, borderRadius: 6 }}
                    aria-hidden="true"
                  />
                </div>
                <span
                  className="v-skel"
                  style={{ height: 4, borderRadius: 999, marginTop: 6 }}
                  aria-hidden="true"
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* deterministic score */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
        <span
          data-testid="health-score"
          style={{
            fontSize: 40,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.02em',
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
          textDecoration: 'none',
        }}
      >
        Ask Rufus to explain →
      </button>
        </>
      )}
    </section>
  );
}

export default PortfolioHealthCard;
