// ─── Insights: quick-links 2×2 ─────────────────────────────
// Rebalance plan · Risk reduction · Tax optimization · Goal tracker
//
// Two of them DEEP-LINK into an existing trigger flow when that trigger
// is active (no new logic — it routes into the same chat/position flow
// the deck cards use). When nothing is active they fall back to an Ask
// Rufus prompt. The other two are Ask-Rufus-only, and say so plainly —
// no copy implying a feature that doesn't exist.
// `data-branch` exposes which path was taken (trigger | ask) so it is
// verifiable in screenshots/tests.

'use client';

import React from 'react';
import { useTabStore } from '@/store';

interface Props {
  /** All active noticed items (already fetched by the Insights tab). */
  items: any[];
}

export function QuickLinks({ items }: Props) {
  const { setChatOpen, setPendingPrompt, setTab, setFocusPosition } = useTabStore();

  const drift = items.find((i) => i?.triggerType === 'portfolio_drift') || null;
  const concentration =
    items.find((i) => i?.triggerType === 'concentration_single' || i?.triggerType === 'concentration_top3') || null;

  const ask = (prompt: string) => {
    setPendingPrompt(prompt);
    setChatOpen(true);
  };

  const links = [
    {
      id: 'rebalance',
      title: 'Rebalance plan',
      sub: drift ? 'Uses your active drift alert' : 'Ask Rufus',
      branch: drift ? 'trigger' : 'ask',
      onClick: () => {
        if (drift) ask('rebalance');
        else ask('Build me a rebalance plan for my current portfolio.');
      },
    },
    {
      id: 'risk',
      title: 'Risk reduction',
      sub: concentration ? 'Uses your active concentration alert' : 'Ask Rufus',
      branch: concentration ? 'trigger' : 'ask',
      onClick: () => {
        if (concentration) {
          const sym =
            concentration?.meta?.symbol ||
            (Array.isArray(concentration?.meta?.symbols) ? concentration.meta.symbols[0] : null);
          if (sym) {
            setFocusPosition(sym);
            setTab('portfolio');
            return;
          }
        }
        ask('How can I reduce the risk in my portfolio?');
      },
    },
    {
      id: 'tax',
      title: 'Tax optimization',
      sub: 'Ask Rufus',
      branch: 'ask',
      onClick: () => ask('What tax-optimization moves make sense in my portfolio right now?'),
    },
    {
      id: 'goals',
      title: 'Goal tracker',
      sub: 'Ask Rufus',
      branch: 'ask',
      onClick: () => ask('How am I tracking against my investing goals?'),
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
            <span style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>{l.sub}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default QuickLinks;
