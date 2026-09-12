// ─── Insights: quick-links 2×2 ─────────────────────────────
// Rebalance plan · Risk reduction · Tax optimization · Goal tracker
//
// Rebalance plan and Tax optimization DEEP-LINK into the REAL activation
// flows the Invest tab uses (`/strategies/setup/rebalancing` and
// `/strategies/setup/tax-harvesting`) — the same routes StrategySheet's
// Execute button pushes. No parallel flow, no new router: plain
// `useRouter().push`, exactly like components/trade/TradeTab.tsx.
//
// Risk reduction deep-links into the ACTIVE risk trigger when one exists
// (opens the over-concentrated position's detail — the same flow the deck
// card's "Review …" CTA uses); with no active trigger it falls back to an
// Ask Rufus prompt. Goal tracker stays Ask-Rufus-only.
//
// The trailing link line uses the shared canvas accent treatment (accent
// colour, trailing arrow, no underline). Its label reflects the tile's real
// destination — "Set up →" when it opens a live flow, "Ask Rufus →" when
// it opens chat — so no tile implies a feature it does not perform.
// `data-branch` exposes which path was taken (flow | trigger | ask) so it is
// verifiable in screenshots/tests.

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useTabStore } from '@/store';

interface Props {
  /** All active noticed items (already fetched by the Insights tab). */
  items: any[];
}

export function QuickLinks({ items }: Props) {
  const router = useRouter();
  const { setChatOpen, setPendingPrompt, openPositionDetail } = useTabStore();

  const drift = items.find((i) => i?.triggerType === 'portfolio_drift') || null;
  const concentration =
    items.find((i) => i?.triggerType === 'concentration_single' || i?.triggerType === 'concentration_top3') || null;

  const ask = (prompt: string) => {
    setPendingPrompt(prompt);
    setChatOpen(true);
  };

  // Risk reduction: when a concentration trigger is live we open the
  // over-concentrated position's detail (the deck card's "Review <sym>"
  // flow) — so the label must say so, not "Ask Rufus →". The symbol is
  // resolved here ONCE and reused by both the label and the handler, so the
  // two can never disagree.
  const riskSymbol: string | null = concentration
    ? (concentration?.meta?.symbol ||
        (Array.isArray(concentration?.meta?.symbols) ? concentration.meta.symbols[0] : null) ||
        null)
    : null;

  const links = [
    {
      id: 'rebalance',
      title: 'Rebalance plan',
      sub: drift ? 'Uses your active drift alert' : '',
      branch: 'flow',
      cta: 'Set up →',
      // The REAL Portfolio Rebalancing activation flow — same route the
      // Invest tab and StrategySheet's Execute button push.
      onClick: () => router.push('/strategies/setup/rebalancing'),
    },
    {
      id: 'risk',
      title: 'Risk reduction',
      sub: concentration ? 'Uses your active concentration alert' : '',
      branch: riskSymbol ? 'trigger' : 'ask',
      cta: riskSymbol ? `Review ${riskSymbol} →` : 'Ask Rufus →',
      onClick: () => {
        if (riskSymbol) {
          openPositionDetail(riskSymbol, 'insights');
          return;
        }
        ask('How can I reduce the risk in my portfolio?');
      },
    },
    {
      id: 'tax',
      title: 'Tax optimization',
      sub: 'Open tax-loss harvesting',
      branch: 'flow',
      cta: 'Set up →',
      // The REAL Tax Loss Harvesting activation flow.
      onClick: () => router.push('/strategies/setup/tax-harvesting'),
    },
    {
      id: 'goals',
      title: 'Goal tracker',
      sub: 'Ask Rufus',
      branch: 'ask',
      cta: 'Ask Rufus →',
      onClick: () => ask('Help me set a savings/investing goal based on my current portfolio.'),
    },
  ];

  return (
    <section style={{ margin: '24px 20px 0' }} data-testid="quick-links">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {links.map((l) => (
          <button
            key={l.id}
            type="button"
            data-testid={`quick-link-${l.id}`}
            data-branch={l.branch}
            onClick={l.onClick}
            style={{
              textAlign: 'left',
              background: 'var(--v-card)',
              border: '0.5px solid var(--v-card-border)',
              borderRadius: 14,
              padding: '14px 14px 13px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minHeight: 72,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--v-text-primary)' }}>{l.title}</span>
            {l.sub && <span style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>{l.sub}</span>}
            {/* Shared canvas link treatment (health card + hero cards): accent
                colour, trailing arrow, no underline. The label reflects the
                tile's real destination (flow vs chat). */}
            <span
              data-testid={`quick-link-${l.id}-ask`}
              data-branch={l.branch}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--v-accent-label)', marginTop: 'auto' }}
            >
              {l.cta}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default QuickLinks;
