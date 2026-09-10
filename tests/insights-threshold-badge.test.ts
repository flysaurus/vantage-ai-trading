import { describe, expect, it } from 'vitest';
import {
  humanizeNoticedItem,
  isMoreFromRufusEligible,
  reviewTickerForItem,
} from '@/lib/insights/noticed-copy';
import {
  crossingFor,
  formatThresholdBadge,
  thresholdCrossings,
} from '@/lib/insights/threshold-badge';

/**
 * PART 1 — the "More from Rufus" / threshold-badge split.
 *
 * The secondary Insights list is EVENT-IMPACT ONLY (review + info tier).
 * Target-return / target-loss crossings left the list entirely: they are an
 * inline badge on the affected position's row.
 */

const eventInfo = {
  id: 'e1',
  triggerType: 'event_impact',
  icon: '📰',
  title: 'NVDA — earnings update',
  body: 'NVDA posted an earnings update — Q3 beat and raised guidance.',
  meta: { symbol: 'NVDA', severity: 'info', category: 'earnings' },
};

const eventReview = {
  id: 'e2',
  triggerType: 'event_impact',
  icon: '📰',
  title: 'XLF — regulatory update',
  body: 'XLF has a regulatory update — the SEC opened a comment window.',
  meta: { symbol: 'XLF', severity: 'review', category: 'regulatory' },
  action: 'REVIEW_POSITION:XLF',
};

const milestone = {
  id: 'm1',
  triggerType: 'position_milestone',
  icon: '📉',
  title: 'BX -20%',
  body: 'BX crossed -20% (now -24%) — worth a look.',
  meta: { symbol: 'BX', threshold: -20, currentPnlPct: -23.9, action: 'REVIEW_POSITION:BX' },
};

const deckTypes = [
  { id: 'd1', triggerType: 'concentration_single', meta: {} },
  { id: 'd2', triggerType: 'idle_cash', meta: { amount: 25000 } },
  { id: 'd3', triggerType: 'bounce_back', meta: {} },
  { id: 'd4', triggerType: 'portfolio_drift', meta: {} },
];

describe('isMoreFromRufusEligible', () => {
  it('accepts BOTH event-impact tiers', () => {
    expect(isMoreFromRufusEligible(eventInfo)).toBe(true);
    expect(isMoreFromRufusEligible(eventReview)).toBe(true);
  });

  it('rejects threshold/milestone crossings — they are a row badge, not a list item', () => {
    expect(isMoreFromRufusEligible(milestone)).toBe(false);
  });

  it('rejects every deck-eligible type (no duplication of the hero deck)', () => {
    for (const t of deckTypes) expect(isMoreFromRufusEligible(t)).toBe(false);
  });

  it('rejects junk without throwing', () => {
    expect(isMoreFromRufusEligible(null)).toBe(false);
    expect(isMoreFromRufusEligible({})).toBe(false);
    expect(isMoreFromRufusEligible({ triggerType: 42 })).toBe(false);
  });
});

describe('reviewTickerForItem', () => {
  it('returns the ticker only for a review-tier item with a real action', () => {
    expect(reviewTickerForItem(eventReview)).toBe('XLF');
    expect(reviewTickerForItem(milestone)).toBe('BX');
  });

  it('never renders a Review link for info-tier items', () => {
    expect(reviewTickerForItem(eventInfo)).toBeNull();
    expect(
      reviewTickerForItem({ ...eventInfo, action: 'REVIEW_POSITION:NVDA' }),
    ).toBeNull();
  });

  it('returns null when there is no REVIEW_POSITION marker', () => {
    expect(reviewTickerForItem({ meta: { severity: 'review' } })).toBeNull();
    expect(reviewTickerForItem({ meta: { severity: 'review', action: 'REBALANCE' } })).toBeNull();
  });
});

describe('humanizeNoticedItem — neither content type leaks the raw context', () => {
  const RAWS = [
    'severity: info. Informational only — no action needed.',
    'BX: crossed -20% total return threshold (currently at -23.9%). Position value: $129.07.',
    '$100,865 in available cash (after open orders) has been idle for 3 consecutive trading days. Investor style: snaptrade.',
  ];

  it('rejects a raw body and rebuilds from structured fields', () => {
    const raw = { ...milestone, body: RAWS[1] };
    const line = humanizeNoticedItem(raw);
    expect(line).not.toMatch(/total return threshold|position value/i);
    expect(line).toBe('BX crossed -20% (now -24%) — worth a look.');
  });

  it('passes through real generated copy untouched', () => {
    expect(humanizeNoticedItem(eventInfo)).toBe(eventInfo.body);
  });

  it('never emits a marker for any of the known machine strings', () => {
    for (const body of RAWS) {
      const line = humanizeNoticedItem({ ...eventInfo, body });
      expect(line).not.toMatch(
        /severity:|informational only|total return threshold|position value:|investor style:|after open orders/i,
      );
      expect(line.length).toBeGreaterThan(0);
    }
  });
});

describe('thresholdCrossings', () => {
  it('keeps only milestone items, keyed by upper-case symbol', () => {
    const map = thresholdCrossings([eventInfo, eventReview, milestone, ...deckTypes]);
    expect(Object.keys(map)).toEqual(['BX']);
    expect(map.BX).toMatchObject({ symbol: 'BX', threshold: -20, tone: 'loss' });
  });

  it('formats the pill exactly as specified', () => {
    expect(formatThresholdBadge(-20, 'loss')).toBe('▼ crossed -20%');
    expect(formatThresholdBadge(250, 'gain')).toBe('▲ crossed +250%');
  });

  it('treats a positive threshold as a gain and a negative one as a loss', () => {
    const map = thresholdCrossings([
      { id: 'g', triggerType: 'position_milestone', meta: { symbol: 'nvda', threshold: 250, currentPnlPct: 261.4 } },
    ]);
    expect(map.NVDA.tone).toBe('gain');
    expect(map.NVDA.text).toBe('▲ crossed +250%');
    expect(map.NVDA.currentPnlPct).toBe(261.4);
  });

  it('keeps the WIDEST band when a symbol has several crossings', () => {
    const map = thresholdCrossings([
      { id: 'a', triggerType: 'position_milestone', meta: { symbol: 'BX', threshold: -10, currentPnlPct: -12 } },
      { id: 'b', triggerType: 'position_milestone', meta: { symbol: 'BX', threshold: -20, currentPnlPct: -23.9 } },
    ]);
    expect(map.BX.threshold).toBe(-20);
    expect(map.BX.itemId).toBe('b');
  });

  it('ignores malformed milestones (no threshold / no symbol)', () => {
    const map = thresholdCrossings([
      { triggerType: 'position_milestone', meta: { symbol: 'BX' } },
      { triggerType: 'position_milestone', meta: { threshold: 20 } },
      { triggerType: 'position_milestone', meta: { symbol: 'BX', threshold: 0 } },
      { triggerType: 'position_milestone', meta: { symbol: 'BX', threshold: 'nope' } },
    ]);
    expect(Object.keys(map)).toEqual([]);
  });

  it('handles empty / null input', () => {
    expect(thresholdCrossings(null)).toEqual({});
    expect(thresholdCrossings([])).toEqual({});
  });

  it('crossingFor is case-insensitive and null-safe', () => {
    const map = thresholdCrossings([milestone]);
    expect(crossingFor(map, 'bx')).not.toBeNull();
    expect(crossingFor(map, 'nvda')).toBeNull();
    expect(crossingFor(null, 'BX')).toBeNull();
    expect(crossingFor(map, null)).toBeNull();
  });
});
