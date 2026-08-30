// ═══════════════════════════════════════════════════════════════
// tests/order-history.test.ts — executed-orders router unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/order-history.test.ts
//
// Covers detectOrderHistoryIntent (read-only "what did I trade/buy/sell over a
// window" queries), parseOrderHistoryWindow, orderHistoryWindowLabel, and
// buildOrderHistoryAnswer formatting. These are the deterministic backstop for
// the classifier mislabeling "orders executed last week" → account_state.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detectOrderHistoryIntent,
  parseOrderHistoryWindow,
  orderHistoryWindowLabel,
  buildOrderHistoryAnswer,
} from '../lib/ai/account-actions';

describe('detectOrderHistoryIntent — positive', () => {
  it.each([
    'orders executed in last week',
    'orders executed last week',
    'orders executed in the last week',
    'recent trades',
    'trade history',
    'order history',
    'what did i buy this month',
    'what have i sold',
    'what did I trade last week',
    'orders in the last week',
    'orders over the last month',
    'my trades this week',
    'orders filled last week',
    'orders completed last week',
    'orders that went through last week',
    'what have i bought recently',
    'show my recent orders',
  ])('matches: %s', (m) => {
    expect(detectOrderHistoryIntent(m)).toBe(true);
  });
});

describe('detectOrderHistoryIntent — negative', () => {
  it.each([
    'what are my open orders',
    'any pending orders',
    'show me my scheduled buys',
    'what are my recurring buys',
    'what is an order',
    'explain what a trade is',
    'cancel my pending order',
    'set up a DCA plan',
    'how much cash do i have',
    'whats my account balance',
    'buy 10 shares of AAPL',
    'what is a limit order',
    'rebalance my portfolio',
    'my orders for next week',
    'what trades are coming up',
    'orders for next month',
  ])('does NOT match: %s', (m) => {
    expect(detectOrderHistoryIntent(m)).toBe(false);
  });
});

describe('parseOrderHistoryWindow', () => {
  const near = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  it('parses "last week" as 7 days', () => {
    const since = parseOrderHistoryWindow('orders executed last week');
    expect(since?.getTime()).toBe(near(7));
  });

  it('parses "last 30 days"', () => {
    const since = parseOrderHistoryWindow('trades in the last 30 days');
    expect(since?.getTime()).toBe(near(30));
  });

  it('parses "last month" as 30 days', () => {
    const since = parseOrderHistoryWindow('orders in the last month');
    expect(since?.getTime()).toBe(near(30));
  });

  it('returns null when no window', () => {
    expect(parseOrderHistoryWindow('what did i buy')).toBeNull();
  });

  it('returns 7 days for "recent"', () => {
    const since = parseOrderHistoryWindow('recent trades');
    expect(since?.getTime()).toBe(near(7));
  });
});

describe('orderHistoryWindowLabel', () => {
  it('labels "last week"', () => {
    expect(orderHistoryWindowLabel('orders executed last week')).toBe('in the last week');
  });
  it('labels "last 30 days"', () => {
    expect(orderHistoryWindowLabel('trades in the last 30 days')).toBe('in the last 30 days');
  });
  it('labels "recent"', () => {
    expect(orderHistoryWindowLabel('recent trades')).toBe('in the last week');
  });
  it('empty when no window', () => {
    expect(orderHistoryWindowLabel('what did i buy')).toBe('');
  });
});

describe('buildOrderHistoryAnswer', () => {
  it('empty → no orders message', () => {
    const out = buildOrderHistoryAnswer([], 'in the last week');
    expect(out).toContain('no executed orders');
    expect(out).toContain('in the last week');
  });

  it('formats buy + sell rows', () => {
    const out = buildOrderHistoryAnswer(
      [
        {
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          side: 'buy',
          qty: 10,
          filledQty: 10,
          status: 'filled',
          filledPrice: 200,
          notional: 2000,
          filledAt: '2026-08-20T00:00:00.000Z',
          createdAt: '2026-08-20T00:00:00.000Z',
        },
        {
          symbol: 'NVDA',
          companyName: null,
          side: 'sell',
          qty: 5,
          filledQty: 5,
          status: 'filled',
          filledPrice: 150,
          notional: 750,
          filledAt: '2026-08-22T00:00:00.000Z',
          createdAt: '2026-08-22T00:00:00.000Z',
        },
      ],
      'in the last week',
    );
    expect(out).toContain('Bought AAPL (Apple Inc.)');
    expect(out).toContain('Sold NVDA');
    expect(out).toContain('$2,000.00');
    expect(out).toContain('$750.00');
    expect(out).toContain('in the last week');
  });
});
