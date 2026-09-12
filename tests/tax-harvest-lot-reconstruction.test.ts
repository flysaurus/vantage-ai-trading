// ═══════════════════════════════════════════════════════════════
// tests/tax-harvest-lot-reconstruction.test.ts
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/tax-harvest-lot-reconstruction.test.ts
//
// Covers the pure activity→lot reconstruction:
//   - activity type classification
//   - FIFO replay (order, partial sells, lot qty preservation)
//   - Alpaca-style same-second partial fills stay separate lots
//   - non-trade activities never create lots
//   - oversell tracking (never throws)
//   - unknown-start detection + exact human labels
//   - window dates from unsorted/newest-first input
//   - SnapTrade positions payload mapping + numeric hygiene
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  classifyActivityType,
  reconstructLotsFromActivities,
  unknownStartLabel,
  positionQtyFromPositions,
  type ActivityRecord,
} from '../lib/tax-harvest/lot-reconstruction';

const act = (overrides: Partial<ActivityRecord> & { trade_date: string }): ActivityRecord => ({
  symbol: 'AAPL',
  type: 'BUY',
  units: 1,
  price: 100,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────
// classifyActivityType
// ─────────────────────────────────────────────────────────────

describe('classifyActivityType', () => {
  it('classifies every buy variant as buy', () => {
    for (const t of ['BUY', 'buy', 'BUY_TO_COVER', 'REINVEST', 'REINVESTMENT', 'BUY_TO_OPEN']) {
      expect(classifyActivityType(t)).toBe('buy');
    }
  });

  it('classifies every sell variant as sell', () => {
    for (const t of ['SELL', 'sell', 'SELL_SHORT', 'SELL_TO_CLOSE']) {
      expect(classifyActivityType(t)).toBe('sell');
    }
  });

  it('normalises spaces, dashes and casing', () => {
    expect(classifyActivityType('buy to cover')).toBe('buy');
    expect(classifyActivityType('sell-to-close')).toBe('sell');
    expect(classifyActivityType('  Reinvestment ')).toBe('buy');
  });

  it('treats everything else (and junk) as other', () => {
    for (const t of ['DIVIDEND', 'FEE', 'WITHDRAWAL', 'JOURNAL', 'SPLIT', 'TAX', 'TRANSFER']) {
      expect(classifyActivityType(t)).toBe('other');
    }
    expect(classifyActivityType(null)).toBe('other');
    expect(classifyActivityType(undefined)).toBe('other');
    expect(classifyActivityType('')).toBe('other');
  });
});

// ─────────────────────────────────────────────────────────────
// FIFO replay
// ─────────────────────────────────────────────────────────────

describe('reconstructLotsFromActivities — FIFO', () => {
  it('consumes oldest lots first across 3 lots with a partial sell', () => {
    const res = reconstructLotsFromActivities([
      act({ id: 'b1', units: 10, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      act({ id: 'b2', units: 5, price: 110, trade_date: '2026-02-01T10:00:00Z' }),
      act({ id: 'b3', units: 3, price: 120, trade_date: '2026-03-01T10:00:00Z' }),
      act({ id: 's1', type: 'SELL', units: 12, price: 130, trade_date: '2026-04-01T10:00:00Z' }),
    ]);

    const all = res.allLotsByTicker.AAPL;
    expect(all).toHaveLength(3);
    expect(all[0].remainingQty).toBe(0); // 10 fully consumed
    expect(all[1].remainingQty).toBe(3); // 5 - 2
    expect(all[2].remainingQty).toBe(3); // untouched
    expect(res.lotsByTicker.AAPL.map((l) => l.id)).toEqual(['act:b2', 'act:b3']);
  });

  it('preserves the original qty on a partially consumed lot', () => {
    const res = reconstructLotsFromActivities([
      act({ id: 'b1', units: 10, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      act({ id: 's1', type: 'SELL', units: 4, price: 120, trade_date: '2026-02-01T10:00:00Z' }),
    ]);
    const lot = res.allLotsByTicker.AAPL[0];
    expect(lot.qty).toBe(10);
    expect(lot.remainingQty).toBe(6);
    expect(lot.priceAtFill).toBe(100);
    expect(lot.filledAt).toBe('2026-01-01T10:00:00Z');
    expect(lot.activityId).toBe('b1');
  });

  it('keeps fully-consumed lots in allLotsByTicker but out of lotsByTicker', () => {
    const res = reconstructLotsFromActivities([
      act({ id: 'b1', units: 5, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      act({ id: 's1', type: 'SELL', units: 5, price: 120, trade_date: '2026-02-01T10:00:00Z' }),
    ]);
    expect(res.allLotsByTicker.AAPL).toHaveLength(1);
    expect(res.lotsByTicker.AAPL).toBeUndefined();
  });

  it('replays tickers independently', () => {
    const res = reconstructLotsFromActivities([
      act({ id: 'a', symbol: 'AAPL', units: 5, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      act({ id: 'm', symbol: 'MSFT', units: 2, price: 300, trade_date: '2026-01-02T10:00:00Z' }),
      act({ id: 's', symbol: 'AAPL', type: 'SELL', units: 5, price: 120, trade_date: '2026-02-01T10:00:00Z' }),
    ]);
    expect(res.lotsByTicker.AAPL).toBeUndefined();
    expect(res.lotsByTicker.MSFT).toHaveLength(1);
    expect(res.lotsByTicker.MSFT[0].qty).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Same-second partial fills
// ─────────────────────────────────────────────────────────────

describe('reconstructLotsFromActivities — same-second partial fills', () => {
  it('keeps three same-second BUY rows as three separate lots', () => {
    const res = reconstructLotsFromActivities([
      act({ symbol: 'AAPL', units: 1, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      act({ symbol: 'AAPL', units: 2, price: 101, trade_date: '2026-01-01T10:00:00Z' }),
      act({ symbol: 'AAPL', units: 3, price: 102, trade_date: '2026-01-01T10:00:00Z' }),
    ]);
    const lots = res.lotsByTicker.AAPL;
    expect(lots).toHaveLength(3);
    expect(lots.map((l) => l.qty)).toEqual([1, 2, 3]);
    expect(lots.map((l) => l.id)).toEqual(['act:0', 'act:1', 'act:2']);
  });

  it('is deterministic across repeated runs', () => {
    const input = [
      act({ symbol: 'AAPL', units: 1, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      act({ symbol: 'AAPL', units: 2, price: 101, trade_date: '2026-01-01T10:00:00Z' }),
      act({ symbol: 'AAPL', units: 3, price: 102, trade_date: '2026-01-01T10:00:00Z' }),
    ];
    expect(reconstructLotsFromActivities(input)).toEqual(reconstructLotsFromActivities(input));
  });

  it('does not reverse equal-timestamp rows (input order is the true sequence)', () => {
    // Newest-first payloads can place a SELL before a BUY at the same instant.
    // A stable sort must keep that order, so the sell runs first → oversell.
    const res = reconstructLotsFromActivities(
      [
        act({ symbol: 'AAPL', type: 'SELL', units: 5, price: 120, trade_date: '2026-01-01T10:00:00Z' }),
        act({ symbol: 'AAPL', type: 'BUY', units: 5, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      ],
      { positionQtyByTicker: { AAPL: 5 } },
    );
    expect(res.unknownStartByTicker.AAPL.oversoldUnits).toBe(5);
    expect(res.lotsByTicker.AAPL[0].remainingQty).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// Non-trade activities
// ─────────────────────────────────────────────────────────────

describe('non-trade activities', () => {
  it('never create lots but still count and set the window', () => {
    const res = reconstructLotsFromActivities([
      act({ type: 'DIVIDEND', units: 0, price: 0, trade_date: '2026-01-01T10:00:00Z' }),
      act({ type: 'FEE', units: 0, price: 0, trade_date: '2026-02-01T10:00:00Z' }),
      act({ type: 'WITHDRAWAL', units: 0, price: 0, trade_date: '2026-03-01T10:00:00Z' }),
      act({ type: 'JOURNAL', units: 0, price: 0, trade_date: '2026-04-01T10:00:00Z' }),
      act({ type: 'SPLIT', units: 10, price: 0, trade_date: '2026-05-01T10:00:00Z' }),
      act({ type: 'TAX', units: 0, price: 0, trade_date: '2026-06-01T10:00:00Z' }),
    ]);
    expect(res.activityCount).toBe(6);
    expect(Object.keys(res.lotsByTicker)).toHaveLength(0);
    expect(Object.keys(res.allLotsByTicker)).toHaveLength(0);
    expect(res.windowStartDate).toBe('2026-01-01T10:00:00.000Z');
    expect(res.windowEndDate).toBe('2026-06-01T10:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────
// Oversell
// ─────────────────────────────────────────────────────────────

describe('oversell handling', () => {
  it('tracks unmatched sells without throwing and forces unknown-start', () => {
    let res: ReturnType<typeof reconstructLotsFromActivities>;
    expect(() => {
      res = reconstructLotsFromActivities(
        [act({ symbol: 'AAPL', type: 'SELL', units: 5, price: 120, trade_date: '2026-01-01T10:00:00Z' })],
        { positionQtyByTicker: { AAPL: 5 } },
      );
    }).not.toThrow();

    expect(res!.unknownStartByTicker.AAPL.oversoldUnits).toBe(5);
    expect(res!.unknownStartByTicker.AAPL.sharesHeldBeforeWindow).toBe(5);
    expect(res!.unknownStartByTicker.AAPL.label).toBe(
      'Unknown start \u2014 acquired before 2026-01-01 on file',
    );
  });

  it('ignores the unmatched remainder once later buys satisfy earlier sells', () => {
    const res = reconstructLotsFromActivities(
      [
        act({ symbol: 'AAPL', type: 'SELL', units: 3, price: 120, trade_date: '2026-01-01T10:00:00Z' }),
        act({ symbol: 'AAPL', type: 'BUY', units: 10, price: 100, trade_date: '2026-02-01T10:00:00Z' }),
      ],
      { positionQtyByTicker: { AAPL: 7 } },
    );
    // 3 sold before any buy → oversold 3; the later 10-buy leaves 10 remaining.
    expect(res.unknownStartByTicker.AAPL.oversoldUnits).toBe(3);
    expect(res.lotsByTicker.AAPL[0].remainingQty).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
// Unknown-start detection
// ─────────────────────────────────────────────────────────────

describe('unknown-start detection', () => {
  it('reports nothing when the reconstruction fully explains the position', () => {
    const res = reconstructLotsFromActivities(
      [act({ symbol: 'AAPL', units: 5, price: 100, trade_date: '2026-01-01T10:00:00Z' })],
      { positionQtyByTicker: { AAPL: 5 } },
    );
    expect(res.unknownStartByTicker).toEqual({});
  });

  it('reports shares held before the window (live 5 vs 2 on file)', () => {
    const res = reconstructLotsFromActivities(
      [act({ symbol: 'AAPL', units: 2, price: 100, trade_date: '2026-01-01T10:00:00Z' })],
      { positionQtyByTicker: { AAPL: 5 } },
    );
    expect(res.unknownStartByTicker.AAPL.sharesHeldBeforeWindow).toBe(3);
    expect(res.unknownStartByTicker.AAPL.oversoldUnits).toBe(0);
    expect(res.unknownStartByTicker.AAPL.earliestActivityDate).toBe('2026-01-01T10:00:00.000Z');
  });

  it('always qualifies a held position with no on-file buys', () => {
    const res = reconstructLotsFromActivities(
      [act({ symbol: 'AAPL', units: 2, price: 100, trade_date: '2026-03-01T10:00:00Z' })],
      { positionQtyByTicker: { ZZZ: 4 } },
    );
    const info = res.unknownStartByTicker.ZZZ;
    expect(info).toBeDefined();
    expect(info.sharesHeldBeforeWindow).toBe(4);
    expect(info.earliestActivityDate).toBeNull();
    // Falls back to the account window start.
    expect(info.label).toBe('Unknown start \u2014 acquired before 2026-03-01 on file');
  });

  it('handles empty activities with a held position (undated label)', () => {
    const res = reconstructLotsFromActivities([], { positionQtyByTicker: { XYZ: 5 } });
    expect(res.windowStartDate).toBeNull();
    expect(res.unknownStartByTicker.XYZ.sharesHeldBeforeWindow).toBe(5);
    expect(res.unknownStartByTicker.XYZ.label).toBe(
      'Unknown start \u2014 acquired before the earliest record on file',
    );
  });

  it('prefers a ticker earliest activity date over the account window', () => {
    const res = reconstructLotsFromActivities(
      [
        act({ symbol: 'AAPL', units: 1, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
        act({ symbol: 'MSFT', type: 'SELL', units: 2, price: 300, trade_date: '2026-04-01T10:00:00Z' }),
      ],
      { positionQtyByTicker: { MSFT: 2 } },
    );
    expect(res.windowStartDate).toBe('2026-01-01T10:00:00.000Z');
    expect(res.unknownStartByTicker.MSFT.label).toBe(
      'Unknown start \u2014 acquired before 2026-04-01 on file',
    );
  });

  it('rounds unknown-start quantities to 6 decimals', () => {
    const res = reconstructLotsFromActivities(
      [act({ symbol: 'AAPL', units: 0.3, price: 100, trade_date: '2026-01-01T10:00:00Z' })],
      { positionQtyByTicker: { AAPL: 0.5 } },
    );
    expect(res.unknownStartByTicker.AAPL.sharesHeldBeforeWindow).toBe(0.2);
  });
});

// ─────────────────────────────────────────────────────────────
// Label wording
// ─────────────────────────────────────────────────────────────

describe('unknownStartLabel', () => {
  it('formats the dated variant with an em dash and UTC YYYY-MM-DD', () => {
    expect(unknownStartLabel('2026-06-01T10:00:00Z')).toBe(
      'Unknown start \u2014 acquired before 2026-06-01 on file',
    );
  });

  it('formats the undated variant when there is no usable date', () => {
    const expected = 'Unknown start \u2014 acquired before the earliest record on file';
    expect(unknownStartLabel(null)).toBe(expected);
    expect(unknownStartLabel('')).toBe(expected);
    expect(unknownStartLabel('not-a-date')).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────
// Window dates + unsorted input
// ─────────────────────────────────────────────────────────────

describe('window dates and ordering', () => {
  it('derives the window from newest-first input and replays oldest-first', () => {
    const res = reconstructLotsFromActivities([
      act({ id: 'b3', units: 1, price: 100, trade_date: '2026-07-01T10:00:00Z' }),
      act({ id: 's1', type: 'SELL', units: 1, price: 100, trade_date: '2026-01-01T10:00:00Z' }),
      act({ id: 'b1', units: 5, price: 90, trade_date: '2026-03-01T10:00:00Z' }),
    ]);
    expect(res.windowStartDate).toBe('2026-01-01T10:00:00.000Z');
    expect(res.windowEndDate).toBe('2026-07-01T10:00:00.000Z');
    // Oldest lot is b1 (March), newest b3 (July); the January sell oversells.
    expect(res.allLotsByTicker.AAPL.map((l) => l.id)).toEqual(['act:b1', 'act:b3']);
  });

  it('returns null windows when there are no dated activities', () => {
    const res = reconstructLotsFromActivities([act({ trade_date: 'nonsense' })]);
    expect(res.windowStartDate).toBeNull();
    expect(res.windowEndDate).toBeNull();
    expect(res.activityCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// positionQtyFromPositions
// ─────────────────────────────────────────────────────────────

describe('positionQtyFromPositions', () => {
  it('reads symbol objects (symbol / raw_symbol / description) and strings', () => {
    const map = positionQtyFromPositions([
      { symbol: { symbol: 'aapl' }, units: 3 },
      { symbol: { raw_symbol: 'MSFT' }, units: 2 },
      { symbol: { description: 'tsla' }, units: 1 },
      { symbol: 'NVDA', units: 4 },
      { symbol: 'SHOP', fractional_units: 0.5 },
    ]);
    expect(map).toEqual({ AAPL: 3, MSFT: 2, TSLA: 1, NVDA: 4, SHOP: 0.5 });
  });

  it('sums duplicates, skips rows with no ticker, and drops zero cash rows', () => {
    const map = positionQtyFromPositions([
      { symbol: 'AAPL', units: 2 },
      { symbol: 'aapl', units: 3 },
      { units: 5 },
      { symbol: null, units: 1 },
      { symbol: {}, units: 1 },
      { symbol: 'SPAXX', units: 0, cash_equivalent: true },
      { symbol: 'FDRXX', units: 10, cash_equivalent: true },
    ]);
    expect(map).toEqual({ AAPL: 5, FDRXX: 10 });
  });

  it('tolerates null / non-array input', () => {
    expect(positionQtyFromPositions(null)).toEqual({});
    expect(positionQtyFromPositions(undefined)).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────
// Numeric hygiene + stable ids
// ─────────────────────────────────────────────────────────────

describe('numeric hygiene and ids', () => {
  it('drops NaN / non-numeric / non-positive-price rows but keeps signed magnitudes', () => {
    const res = reconstructLotsFromActivities([
      act({ units: NaN, price: 10, trade_date: '2026-01-01T10:00:00Z' }),
      act({ units: 2 as unknown as number, price: Infinity, trade_date: '2026-01-02T10:00:00Z' }),
      act({ units: 'abc' as unknown as number, price: 10, trade_date: '2026-01-03T10:00:00Z' }),
      act({ units: 3, price: 0, trade_date: '2026-01-04T10:00:00Z' }),
      act({ units: -5, price: 10, trade_date: '2026-01-05T10:00:00Z' }),
    ]);
    const lots = res.allLotsByTicker.AAPL;
    expect(lots).toHaveLength(1);
    expect(lots[0].qty).toBe(5); // |−5| folded to a magnitude
    for (const l of lots) {
      expect(Number.isFinite(l.qty)).toBe(true);
      expect(Number.isFinite(l.remainingQty)).toBe(true);
      expect(Number.isFinite(l.priceAtFill)).toBe(true);
    }
  });

  it('builds stable ids from the activity id, else the input index', () => {
    const res = reconstructLotsFromActivities([
      act({ id: 'x1', units: 1, trade_date: '2026-01-01T10:00:00Z' }),
      act({ id: null, units: 1, trade_date: '2026-01-02T10:00:00Z' }),
      act({ units: 1, trade_date: '2026-01-03T10:00:00Z' }),
    ]);
    expect(res.allLotsByTicker.AAPL.map((l) => l.id)).toEqual(['act:x1', 'act:1', 'act:2']);
    expect(res.allLotsByTicker.AAPL[0].activityId).toBe('x1');
    expect(res.allLotsByTicker.AAPL[1].activityId).toBeNull();
  });
});
