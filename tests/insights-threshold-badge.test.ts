import { describe, expect, it } from 'vitest';
import {
  humanizeNoticedItem,
  isMoreFromRufusEligible,
  reviewTickerForItem,
} from '@/lib/insights/noticed-copy';
import {
  computeThresholdCrossings,
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

/**
 * PART 6 — the Insights rollup count is a TRUTH count, never a page size.
 *
 * Regression guard for the ROUND 24 confusion: the Insights line said "5
 * positions crossed a threshold" while Holdings showed 14 badges. Root cause
 * was a hard `.limit(5)` page size on the NOTICED feed — an API pagination
 * constant, not a materiality threshold. The rollup now derives from the same
 * live computation as the badges, so it must count EVERY crossed position.
 *
 * Fixture = the 14 real crossings on the connected Fidelity account.
 */
describe('computeThresholdCrossings — rollup count (every crossing, uncapped)', () => {
  // Live totalPnlPercent values for the positions that crossed a band…
  const crossed: Array<{ symbol: string; totalPnlPercent: number }> = [
    { symbol: 'PEP', totalPnlPercent: -19.62 },
    { symbol: 'AAPL', totalPnlPercent: 53.59 },
    { symbol: 'BX', totalPnlPercent: -24.21 },
    { symbol: 'AMD', totalPnlPercent: 257.82 },
    { symbol: 'PAHC', totalPnlPercent: -24.21 },
    { symbol: 'BROS', totalPnlPercent: 25.4 },
    { symbol: 'QUBT', totalPnlPercent: -33.14 },
    { symbol: 'TSM', totalPnlPercent: 100.8 },
    { symbol: 'SPY', totalPnlPercent: 15.9 },
    { symbol: 'RKLB', totalPnlPercent: -44.99 },
    { symbol: 'IBKR', totalPnlPercent: 51.2 },
    { symbol: 'TSLA', totalPnlPercent: 108.4 },
    { symbol: 'MSFT', totalPnlPercent: 16.7 },
    { symbol: 'CHWY', totalPnlPercent: -31.87 },
  ];

  // …plus positions sitting between bands, and junk rows that must be skipped.
  const between: Array<{ symbol: string; totalPnlPercent: number }> = [
    { symbol: 'GLD', totalPnlPercent: 2.1 },
    { symbol: 'CVX', totalPnlPercent: -4.6 },
    { symbol: 'BLK', totalPnlPercent: -2.53 },
    { symbol: 'QQQ', totalPnlPercent: -0.92 },
  ];

  const all = [...crossed, ...between];

  it('counts all 14 crossed positions — not the noticed feed\u2019s page size of 5', () => {
    const map = computeThresholdCrossings(all);
    expect(Object.keys(map)).toHaveLength(14);
    expect(Object.keys(map).length).toBeGreaterThan(5);
  });

  it('membership matches the Holdings badges exactly (one shared source)', () => {
    const map = computeThresholdCrossings(all);
    for (const p of crossed) expect(map[p.symbol]).toBeDefined();
    for (const p of between) expect(map[p.symbol]).toBeUndefined();
  });

  it('is not slice-limited: everyone past the 5th crossing still counts', () => {
    // Order the crossed list so a naive `.slice(0, 5)` would drop 9 of them.
    const map = computeThresholdCrossings(crossed);
    const last5 = crossed.slice(-5).map((p) => p.symbol);
    expect(Object.keys(map).length).toBe(crossed.length);
    for (const sym of last5) expect(map[sym]).toBeDefined();
  });

  it('each entry carries its own band + tone, and null itemId (live-derived)', () => {
    const map = computeThresholdCrossings(crossed);
    expect(map.PEP.tone).toBe('loss');
    expect(map.PEP.threshold).toBe(-20);
    expect(map.AAPL.tone).toBe('gain');
    expect(map.AAPL.threshold).toBe(50);
    expect(map.AMD.threshold).toBe(250);
    expect(map.RKLB.threshold).toBe(-35);
    expect(map.SPY.threshold).toBe(15);
    for (const c of Object.values(map)) expect(c.itemId).toBeNull();
  });

  it('skips rows with no symbol or an unusable percentage', () => {
    const map = computeThresholdCrossings([
      { symbol: '', totalPnlPercent: 60 },
      { symbol: null, totalPnlPercent: -60 },
      { symbol: 'ZZZ', totalPnlPercent: null },
      { symbol: 'YYY', totalPnlPercent: NaN },
    ]);
    expect(Object.keys(map)).toEqual([]);
  });
});
