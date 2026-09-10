// ─── Insights: "More from Rufus" ────────────────────────────
// The compact secondary list that sits DIRECTLY BELOW the hero deck's dot
// indicator and ABOVE the Portfolio Health card.
//
// It surfaces the items that are otherwise only reachable through the chat
// input's "Explore" (+) picker:
//   • event-impact INFO-tier notices — purely informational, no action link.
//   • position milestones / target-return crossings — actionable, with a
//     "Review" link that navigates EXACTLY like the existing REVIEW_POSITION
//     flow (setFocusPosition(ticker) + setTab('portfolio')).
//
// Every line is ONE row (icon + single-line copy + optional Review link).
// Copy comes from humanizeNoticedItem() — real generated copy, never the raw
// deterministic context. Items already shown in the hero deck are excluded.

'use client';

import React, { useMemo } from 'react';
import { useTabStore } from '@/store';
import {
  humanizeNoticedItem,
  isMoreFromRufusEligible,
  reviewTickerForItem,
} from '@/lib/insights/noticed-copy';

interface Props {
  /** All active noticed items (already fetched by InsightsTab). */
  items: any[];
  /** Ids of items already rendered in the hero deck — excluded here. */
  deckIds?: Set<string>;
}

interface Row {
  id: string;
  icon: string;
  text: string;
  ticker: string | null;
}

export function MoreFromRufus({ items, deckIds }: Props) {
  const { setFocusPosition, setTab } = useTabStore();

  const rows: Row[] = useMemo(
    () =>
      (items || [])
        .filter(isMoreFromRufusEligible)
        .filter((i) => !(deckIds && deckIds.has(String(i.id ?? i.triggerKey))))
        .map((i) => ({
          id: String(i.id ?? i.triggerKey),
          icon: (typeof i.icon === 'string' && i.icon.trim()) || '•',
          text: humanizeNoticedItem(i),
          ticker: reviewTickerForItem(i),
        })),
    [items, deckIds],
  );

  // Nothing to surface → render nothing (no empty card, no layout gap).
  if (rows.length === 0) return null;

  const onReview = (ticker: string) => {
    setFocusPosition(ticker);
    setTab('portfolio');
  };

  return (
    <section data-testid="more-from-rufus" style={{ margin: '18px 20px 0' }}>
      <div
        data-testid="more-from-rufus-card"
        style={{
          background: 'var(--v-card)',
          border: '0.5px solid var(--v-card-border)',
          borderRadius: 16,
          padding: '14px 16px 4px',
        }}
      >
        {/* label row — matches the balance / health card label treatment */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            aria-hidden="true"
            style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--v-orb)', flexShrink: 0 }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)' }}>
            MORE FROM RUFUS
          </span>
        </div>

        <ul
          data-testid="more-from-rufus-list"
          style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}
        >
          {rows.map((r, idx) => (
            <li
              key={r.id}
              data-testid="more-from-rufus-row"
              data-actionable={r.ticker ? 'true' : 'false'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 0',
                borderTop: idx === 0 ? 'none' : '0.5px solid var(--v-card-border)',
              }}
            >
              <span
                aria-hidden="true"
                data-testid="more-from-rufus-icon"
                style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}
              >
                {r.icon}
              </span>
              <span
                data-testid="more-from-rufus-text"
                title={r.text}
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  fontSize: 13,
                  lineHeight: 1.3,
                  color: 'var(--v-text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {r.text}
              </span>
              {r.ticker && (
                <button
                  type="button"
                  data-testid="more-from-rufus-review"
                  data-ticker={r.ticker}
                  onClick={() => onReview(r.ticker as string)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--v-accent)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    padding: '2px 0',
                  }}
                >
                  Review
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default MoreFromRufus;
