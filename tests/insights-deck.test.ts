import { describe, it, expect } from 'vitest';
import { buildDeck, isDeckEligible, deckPriority } from '@/lib/insights/deck';

const t = (over: Record<string, any>) => ({
  id: over.id ?? 'x',
  triggerType: over.triggerType,
  title: over.title ?? 'title',
  body: over.body ?? 'body',
  variant: over.variant ?? 'accent',
  meta: over.meta ?? {},
  createdAt: over.createdAt ?? '2026-09-10T00:00:00Z',
});

describe('insights deck — membership (PART 2 spec)', () => {
  it('admits the four hero trigger types', () => {
    expect(isDeckEligible(t({ triggerType: 'concentration_single' }))).toBe(true);
    expect(isDeckEligible(t({ triggerType: 'concentration_top3' }))).toBe(true);
    expect(isDeckEligible(t({ triggerType: 'idle_cash' }))).toBe(true);
    expect(isDeckEligible(t({ triggerType: 'bounce_back' }))).toBe(true);
  });

  it('admits event_impact ONLY at review severity', () => {
    expect(isDeckEligible(t({ triggerType: 'event_impact', meta: { severity: 'review' } }))).toBe(true);
    expect(isDeckEligible(t({ triggerType: 'event_impact', meta: { severity: 'info' } }))).toBe(false);
    expect(isDeckEligible(t({ triggerType: 'event_impact', meta: {} }))).toBe(false);
  });

  it('EXCLUDES milestones, sentiment, drift, earnings and wash_sale', () => {
    for (const type of [
      'position_milestone',
      'sentiment_shift',
      'portfolio_drift',
      'earnings_proximity',
      'wash_sale',
    ]) {
      expect(isDeckEligible(t({ triggerType: type })), `${type} must not be in the deck`).toBe(false);
    }
  });

  it('rejects junk input without throwing', () => {
    expect(isDeckEligible(null)).toBe(false);
    expect(isDeckEligible({})).toBe(false);
    expect(isDeckEligible({ triggerType: 42 })).toBe(false);
  });
});

describe('insights deck — deterministic ordering', () => {
  it('orders concentration > event-impact(review) > idle-cash > bounce-back > brief > snapshot', () => {
    const deck = buildDeck({
      items: [
        t({ id: 'bb', triggerType: 'bounce_back' }),
        t({ id: 'ev', triggerType: 'event_impact', meta: { severity: 'review' } }),
        t({ id: 'cash', triggerType: 'idle_cash' }),
        t({ id: 'c3', triggerType: 'concentration_top3' }),
        t({ id: 'c1', triggerType: 'concentration_single' }),
        t({ id: 'ms', triggerType: 'position_milestone' }),
      ],
      dailyBrief: { label: 'DAILY BRIEF', headline: 'brief head' },
      weeklySnapshot: { label: 'WEEKLY SNAPSHOT', headline: 'snap head' },
    });

    expect(deck.map((c) => c.id)).toEqual([
      'c1',
      'c3',
      'ev',
      'cash',
      'bb',
      '__daily_brief',
      '__weekly_snapshot',
    ]);
  });

  it('is stable regardless of input order', () => {
    const items = [
      t({ id: 'a', triggerType: 'idle_cash', createdAt: '2026-09-01T00:00:00Z' }),
      t({ id: 'b', triggerType: 'idle_cash', createdAt: '2026-09-05T00:00:00Z' }),
      t({ id: 'c', triggerType: 'concentration_single', createdAt: '2026-09-02T00:00:00Z' }),
    ];
    const one = buildDeck({ items }).map((x) => x.id);
    const two = buildDeck({ items: [...items].reverse() }).map((x) => x.id);
    expect(one).toEqual(two);
    // newest-first inside the same priority band
    expect(one).toEqual(['c', 'b', 'a']);
  });

  it('returns an empty deck ONLY for the genuinely-empty case (caller renders the fallback)', () => {
    const deck = buildDeck({
      items: [t({ id: 'ms', triggerType: 'position_milestone' })],
      dailyBrief: null,
      weeklySnapshot: null,
    });
    expect(deck).toEqual([]);
  });

  it('a teaser ALONE is still a real deck — no fallback, dots included', () => {
    // no eligible trigger, only brief content → teaser-only deck, NOT the fallback
    const one = buildDeck({
      items: [t({ id: 'ms', triggerType: 'position_milestone' })],
      dailyBrief: { label: 'DAILY BRIEF', headline: 'Tech leads the tape' },
      weeklySnapshot: null,
    });
    expect(one.map((c) => c.id)).toEqual(['__daily_brief']);

    const two = buildDeck({
      items: [],
      dailyBrief: { label: 'DAILY BRIEF', headline: 'Tech leads the tape' },
      weeklySnapshot: { label: 'WEEKLY SNAPSHOT', headline: 'Week in review' },
    });
    expect(two.map((c) => c.id)).toEqual(['__daily_brief', '__weekly_snapshot']);
    expect(two.every((c) => c.kind !== 'trigger')).toBe(true);
  });

  it('an empty/blank teaser is not content — must not fake a non-empty deck', () => {
    const deck = buildDeck({
      items: [t({ id: 'ms', triggerType: 'position_milestone' })],
      dailyBrief: { label: 'DAILY BRIEF', headline: '   ' },
      weeklySnapshot: { label: 'WEEKLY SNAPSHOT', headline: '' },
    });
    expect(deck).toEqual([]);
  });

  it('priority lookup is total and ordered', () => {
    expect(deckPriority({ triggerType: 'concentration_single' })).toBeLessThan(
      deckPriority({ triggerType: 'event_impact' }),
    );
    expect(deckPriority({ triggerType: 'idle_cash' })).toBeLessThan(
      deckPriority({ triggerType: 'bounce_back' }),
    );
    expect(deckPriority({ triggerType: 'nonsense' })).toBe(99);
  });
});
