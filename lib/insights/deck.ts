// ─── Insights hero deck: membership + deterministic ordering ───
// Pure logic — the deck is built from the SAME trigger objects the
// existing noticed pipeline produces. This module never creates,
// mutates, or re-evaluates a trigger; it only decides which ones are
// allowed into the hero deck and in what order.
//
// ⚠️ DECK MEMBERSHIP IS DELIBERATELY NARROW (PART 2 spec):
//   IN:  concentration_single, concentration_top3,
//        event_impact (severity === 'review' ONLY),
//        bounce_back, idle_cash,
//        + Daily Brief teaser, + Weekly Snapshot teaser.
//   OUT: position_milestone, sentiment_shift, portfolio_drift,
//        earnings_proximity, event_impact severity === 'info',
//        wash_sale.
//   Milestones and info-tier events must never appear in this deck.
//   (They belong to the secondary-notices pattern, which is NOT part
//   of this screen.)

export type DeckCardKind = 'trigger' | 'daily_brief' | 'weekly_snapshot';

export interface DeckTeaser {
  /** Small label above the headline, e.g. "DAILY BRIEF". */
  label: string;
  /** The headline synthesis line. */
  headline: string;
  /** Optional one-line supporting body. */
  body?: string;
}

export interface DeckCard {
  kind: DeckCardKind;
  /** Stable key for React lists + dot tracking. */
  id: string;
  /** Present when kind === 'trigger'. */
  item?: any;
  /** Present when kind is a teaser. */
  teaser?: DeckTeaser;
}

/** Deck priority — lower sorts first. */
export const DECK_PRIORITY: Record<string, number> = {
  concentration_single: 0,
  concentration_top3: 1,
  event_impact: 2,
  idle_cash: 3,
  bounce_back: 4,
  __daily_brief: 5,
  __weekly_snapshot: 6,
};

/**
 * Is this trigger allowed in the hero deck?
 * `event_impact` is review-tier only — info-tier events are excluded.
 */
export function isDeckEligible(item: any): boolean {
  if (!item || typeof item.triggerType !== 'string') return false;
  switch (item.triggerType) {
    case 'concentration_single':
    case 'concentration_top3':
    case 'idle_cash':
    case 'bounce_back':
      return true;
    case 'event_impact':
      return item?.meta?.severity === 'review';
    default:
      return false;
  }
}

/** Sort key for an eligible trigger. */
export function deckPriority(item: any): number {
  const p = DECK_PRIORITY[item?.triggerType];
  return typeof p === 'number' ? p : 99;
}

/** Deterministic tiebreak inside a priority band (newest first, then id). */
function tiebreak(a: any, b: any): number {
  const at = a?.createdAt ? Date.parse(a.createdAt) : 0;
  const bt = b?.createdAt ? Date.parse(b.createdAt) : 0;
  if (bt !== at) return bt - at;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export interface BuildDeckInput {
  items: any[];
  dailyBrief?: DeckTeaser | null;
  weeklySnapshot?: DeckTeaser | null;
}

/**
 * Build the ordered hero deck.
 * Returns [] when nothing is active → caller renders the single
 * "no action needed" fallback card (no deck, no dots).
 */
export function buildDeck({ items, dailyBrief, weeklySnapshot }: BuildDeckInput): DeckCard[] {
  const triggers = (items || [])
    .filter(isDeckEligible)
    .sort((a, b) => deckPriority(a) - deckPriority(b) || tiebreak(a, b));

  const cards: DeckCard[] = triggers.map((item) => ({
    kind: 'trigger',
    id: String(item.id ?? item.triggerKey ?? Math.random()),
    item,
  }));

  if (dailyBrief && dailyBrief.headline) {
    cards.push({ kind: 'daily_brief', id: '__daily_brief', teaser: dailyBrief });
  }
  if (weeklySnapshot && weeklySnapshot.headline) {
    cards.push({ kind: 'weekly_snapshot', id: '__weekly_snapshot', teaser: weeklySnapshot });
  }

  return cards;
}
