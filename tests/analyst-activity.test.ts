import { describe, it, expect } from 'vitest';
import { summarizeRatingActivity, consensusFromDistribution } from '../lib/market-data';

// Fixed clock so the 90-day window is deterministic.
const NOW = Date.parse('2026-09-13T00:00:00Z');
const day = 24 * 60 * 60; // seconds
const epoch = (daysAgo: number) => Math.floor(NOW / 1000) - daysAgo * day;

describe('summarizeRatingActivity (90-day recent-firm count)', () => {
  it('counts distinct firms inside the window and ignores stale rows', () => {
    const history = [
      { firm: 'Morgan Stanley', epochGradeDate: epoch(5) },
      { firm: 'Goldman Sachs', epochGradeDate: epoch(40) },
      { firm: 'Barclays', epochGradeDate: epoch(2000) }, // ~2012-era stale row
    ];
    const r = summarizeRatingActivity(history, NOW);
    expect(r.recentFirmCount90d).toBe(2);
    // Most-recent date is computed over ALL rows, stale ones included.
    expect(r.latestRatingDate).toBe(new Date(epoch(5) * 1000).toISOString().slice(0, 10));
  });

  it('dedupes repeat actions by the same firm (case/whitespace insensitive)', () => {
    const history = [
      { firm: 'Jefferies', epochGradeDate: epoch(3) },
      { firm: ' Jefferies ', epochGradeDate: epoch(9) },
      { firm: 'JEFFERIES', epochGradeDate: epoch(30) },
    ];
    expect(summarizeRatingActivity(history, NOW).recentFirmCount90d).toBe(1);
  });

  it('includes a row exactly 90 days old, excludes 91 days old', () => {
    const at90 = summarizeRatingActivity([{ firm: 'A', epochGradeDate: epoch(90) }], NOW);
    const at91 = summarizeRatingActivity([{ firm: 'A', epochGradeDate: epoch(91) }], NOW);
    expect(at90.recentFirmCount90d).toBe(1);
    expect(at91.recentFirmCount90d).toBe(0);
  });

  it('returns 0 (module present, nobody active) but still reports the latest date', () => {
    const r = summarizeRatingActivity([{ firm: 'Old Co', epochGradeDate: epoch(1800) }], NOW);
    expect(r.recentFirmCount90d).toBe(0);
    expect(r.latestRatingDate).toBe(new Date(epoch(1800) * 1000).toISOString().slice(0, 10));
  });

  it('never coerces malformed rows into a firm or a date', () => {
    const history = [
      { firm: '', epochGradeDate: epoch(10) },
      { firm: '   ', epochGradeDate: epoch(10) },
      { firm: 'Valid', epochGradeDate: '2026-09-01' }, // string epoch (the "unusable real data" shape)
      { firm: 'Valid2' },
      { firm: null, epochGradeDate: null },
      { epochGradeDate: epoch(10) }, // no firm at all
      { firm: 'Good Firm', epochGradeDate: epoch(10) },
    ];
    const r = summarizeRatingActivity(history, NOW);
    expect(r.recentFirmCount90d).toBe(1); // only 'Good Firm' survives
    // The valid numeric epochs (10 days ago) still drive the latest date; the
    // string/null/missing epochs contribute nothing.
    expect(r.latestRatingDate).toBe(new Date(epoch(10) * 1000).toISOString().slice(0, 10));
  });

  it('yields no date at all when every epoch is unusable', () => {
    const history = [
      { firm: 'A', epochGradeDate: '2026-09-01' },
      { firm: 'B' },
      { firm: 'C', epochGradeDate: null },
      { firm: 'D', epochGradeDate: Number.NaN },
    ];
    const r = summarizeRatingActivity(history, NOW);
    expect(r.recentFirmCount90d).toBe(0); // module present, nobody countable
    expect(r.latestRatingDate).toBeNull(); // not 1970-01-01
  });

  it('handles a missing module (different from an empty window)', () => {
    expect(summarizeRatingActivity(undefined, NOW)).toEqual({ recentFirmCount90d: null, latestRatingDate: null });
    expect(summarizeRatingActivity(null, NOW)).toEqual({ recentFirmCount90d: null, latestRatingDate: null });
    expect(summarizeRatingActivity({ history: [] }, NOW)).toEqual({ recentFirmCount90d: null, latestRatingDate: null });
    expect(summarizeRatingActivity([], NOW)).toEqual({ recentFirmCount90d: null, latestRatingDate: null });
  });

  it('handles a large history without dropping the newest row', () => {
    const history = Array.from({ length: 500 }, (_, i) => ({ firm: `Firm ${i}`, epochGradeDate: epoch(1 + i * 3) }));
    const r = summarizeRatingActivity(history, NOW);
    expect(r.recentFirmCount90d).toBe(30); // days 1,4,...,88 → 30 rows inside the window
    expect(r.latestRatingDate).toBe(new Date(epoch(1) * 1000).toISOString().slice(0, 10));
  });
});

describe('consensusFromDistribution (label agreement with the bar counts)', () => {
  it('matches the KO current-month snapshot → Buy (7/12/4/0/1)', () => {
    expect(consensusFromDistribution({ strongBuy: 7, buy: 12, hold: 4, sell: 0, strongSell: 1 })).toBe('Buy');
  });

  it('bands at the documented thresholds', () => {
    expect(consensusFromDistribution({ strongBuy: 10, buy: 0, hold: 0, sell: 0, strongSell: 0 })).toBe('Strong Buy');
    expect(consensusFromDistribution({ strongBuy: 5, buy: 5, hold: 0, sell: 0, strongSell: 0 })).toBe('Strong Buy');
    expect(consensusFromDistribution({ strongBuy: 0, buy: 10, hold: 0, sell: 0, strongSell: 0 })).toBe('Buy');
    expect(consensusFromDistribution({ strongBuy: 0, buy: 0, hold: 10, sell: 0, strongSell: 0 })).toBe('Hold');
    expect(consensusFromDistribution({ strongBuy: 0, buy: 0, hold: 0, sell: 10, strongSell: 0 })).toBe('Sell');
  });

  it('returns null for an all-zero distribution instead of defaulting to a label', () => {
    expect(consensusFromDistribution({ strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 })).toBeNull();
  });
});
