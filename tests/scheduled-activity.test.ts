// ═══════════════════════════════════════════════════════════════
// tests/scheduled-activity.test.ts — DCA + open-orders router unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/scheduled-activity.test.ts
//
// Covers detectScheduledActivityIntent (read-only scheduled/queued queries)
// and buildScheduledActivityAnswer formatting. Ensures "what are my scheduled
// buys" routes to the deterministic DB answer instead of portfolio screening.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detectScheduledActivityIntent,
  buildScheduledActivityAnswer,
} from '../lib/ai/account-actions';

describe('detectScheduledActivityIntent — positive', () => {
  it.each([
    'What are my scheduled buys',
    'what are my scheduled buys?',
    'any open orders',
    'show me my pending orders',
    'recurring buys',
    'upcoming trades',
    'queued orders',
    'show my DCA',
    'do I have any dollar cost averaging',
    "what's pending",
    'list my scheduled activity',
  ])('matches: %s', (m) => {
    expect(detectScheduledActivityIntent(m)).toBe(true);
  });
});

describe('detectScheduledActivityIntent — negative (must NOT intercept)', () => {
  it.each([
    'what should I buy next',
    'buy AAPL',
    'rebalance my portfolio',
    'what are my positions',
    'how much cash do I have',
    'what is a P/E ratio',
    'sell NVDA',
  ])('does NOT match: %s', (m) => {
    expect(detectScheduledActivityIntent(m)).toBe(false);
  });
});

describe('buildScheduledActivityAnswer', () => {
  it('returns a helpful empty state when nothing is scheduled', () => {
    const out = buildScheduledActivityAnswer([], []);
    expect(out).toContain('scheduled buys or open orders');
  });

  it('lists active DCA schedules with amount + frequency + next run', () => {
    const out = buildScheduledActivityAnswer(
      [
        {
          symbol: 'VOO',
          amount: 100,
          frequency: 'weekly',
          dayOfWeek: 'mon',
          nextRunAt: '2026-08-31T13:30:00.000Z',
          isActive: true,
        },
      ],
      [],
    );
    expect(out).toContain('Recurring buys (DCA)');
    expect(out).toContain('VOO');
    expect(out).toContain('$100');
    expect(out).toContain('weekly (mon)');
    expect(out).toContain('next');
  });

  it('lists open orders with side + notional', () => {
    const out = buildScheduledActivityAnswer([], [
      { symbol: 'SPY', side: 'buy', qty: null, notional: 16000, status: 'submitted', createdAt: '2026-08-29T10:00:00Z' },
      { symbol: 'TSLA', side: 'sell', qty: 2, notional: null, status: 'open', createdAt: '2026-08-29T10:00:00Z' },
    ]);
    expect(out).toContain('Open orders (waiting to fill)');
    expect(out).toContain('Buy SPY');
    expect(out).toContain('$16,000');
    expect(out).toContain('Sell TSLA');
    expect(out).toContain('2 sh');
  });

  it('flags paused DCA separately', () => {
    const out = buildScheduledActivityAnswer(
      [{ symbol: 'F', amount: 100, frequency: 'weekly', nextRunAt: null, isActive: false }],
      [],
    );
    expect(out).toContain('Paused DCA');
    expect(out).toContain('F');
  });
});
