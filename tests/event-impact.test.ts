// ═══════════════════════════════════════════════════════════════
// tests/event-impact.test.ts — deterministic event-impact trigger
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/event-impact.test.ts
//
// Verifies the deterministic classifier + relevance/noise/fund gates, and
// that severity tiers map correctly to the CTA marker:
//   - review tier → meta.action = 'REVIEW_POSITION:<TICKER>' + thesis-changed phrase
//   - info tier   → NO action (informational only)
//   - price/rating/rumor/clickbait/irrelevant → no trigger at all
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyEvent,
  findEventImpactTriggers,
  nameRoot,
  isRelevantHeadline,
  isNoiseHeadline,
  isFundName,
} from '@/lib/noticed/event-impact';
import type { NoticedRuleInput } from '@/lib/noticed/engine';

// Mock the Finnhub fetch + profile so the finder is deterministic (no network).
vi.mock('@/lib/finnhub', () => ({
  getCompanyNews: vi.fn(),
  getCompanyProfile: vi.fn(),
}));
import { getCompanyNews, getCompanyProfile } from '@/lib/finnhub';
const mockNews = getCompanyNews as unknown as ReturnType<typeof vi.fn>;
const mockProfile = getCompanyProfile as unknown as ReturnType<typeof vi.fn>;

const PROFILE_NAMES: Record<string, string> = {
  TSLA: 'Tesla Inc',
  KO: 'Coca-Cola Co',
  LLY: 'Eli Lilly and Company',
  XLF: 'Financial Select Sector SPDR Fund',
  GLD: 'SPDR Gold Shares',
};

function makeInput(overrides: Partial<NoticedRuleInput> = {}): NoticedRuleInput {
  return {
    account: {
      cash: 0,
      equity: 100000,
      totalPnl: 0,
      totalPnlPercent: 0,
      dayPnl: 0,
      dayPnlPercent: 0,
    },
    positions: [],
    watchlistSymbols: [],
    daysSinceLastTrade: 0,
    ...overrides,
  };
}

function article(headline: string, source = 'Reuters') {
  return {
    category: 'company',
    datetime: Math.floor(Date.now() / 1000),
    headline,
    id: 1,
    image: '',
    related: '',
    source,
    summary: '',
    url: '',
  };
}

function pos(symbol: string) {
  return { symbol, qty: 10, marketValue: 5000, avgCost: 100, totalPnl: 0, totalPnlPercent: 0 };
}

describe('nameRoot / relevance / noise / fund helpers', () => {
  it('nameRoot strips legal suffixes + single letters', () => {
    expect(nameRoot('Tesla Inc')).toBe('tesla');
    expect(nameRoot('Eli Lilly and Company')).toBe('eli lilly');
    expect(nameRoot('Alphabet Inc Class A')).toBe('alphabet');
    expect(nameRoot('Coca-Cola Co')).toBe('coca-cola');
  });

  it('isRelevantHeadline matches ticker or company name, rejects peers', () => {
    expect(isRelevantHeadline('Tesla faces SEC investigation', 'TSLA', 'Tesla Inc')).toBe(true);
    expect(isRelevantHeadline('TSLA up 3% today', 'TSLA', 'Tesla Inc')).toBe(true);
    expect(isRelevantHeadline('AstraZeneca secures FDA nod', 'LLY', 'Eli Lilly and Company')).toBe(false);
    expect(isRelevantHeadline('Hot payrolls reload the hike bet', 'TSLA', 'Tesla Inc')).toBe(false);
  });

  it('isNoiseHeadline rejects questions + clickbait', () => {
    expect(isNoiseHeadline('Is Apple Stock a Buy Now Ahead of its Product Launch Event?')).toBe(true);
    expect(isNoiseHeadline("Here's why Tesla is a top pick")).toBe(true);
    expect(isNoiseHeadline('Tesla faces SEC investigation')).toBe(false);
  });

  it('isFundName flags ETFs/funds', () => {
    expect(isFundName('Financial Select Sector SPDR Fund')).toBe(true);
    expect(isFundName('SPDR Gold Shares')).toBe(true);
    expect(isFundName('Tesla Inc')).toBe(false);
  });
});

describe('classifyEvent — deterministic gating', () => {
  it('regulatory enforcement → review', () => {
    expect(classifyEvent('Tesla faces SEC investigation into Autopilot claims'))
      .toEqual({ category: 'regulatory', severity: 'review' });
  });

  it('earnings miss + guidance cut → review', () => {
    expect(classifyEvent('Netflix misses earnings and cuts guidance'))
      .toEqual({ category: 'earnings', severity: 'review' });
  });

  it('definitive acquisition → review (corporate action)', () => {
    expect(classifyEvent('Apple to acquire startup for $500M'))
      .toEqual({ category: 'corporate_action', severity: 'review' });
  });

  it('FDA rejection → review (product)', () => {
    expect(classifyEvent('FDA rejects Pfizer drug application'))
      .toEqual({ category: 'product', severity: 'review' });
  });

  it('earnings beat → info', () => {
    expect(classifyEvent('Coca-Cola beats earnings estimates'))
      .toEqual({ category: 'earnings', severity: 'info' });
  });

  it('dividend increase → info', () => {
    expect(classifyEvent('Microsoft raises dividend 10%'))
      .toEqual({ category: 'corporate_action', severity: 'info' });
  });

  it('FDA approval → info', () => {
    expect(classifyEvent('FDA approves Eli Lilly obesity drug'))
      .toEqual({ category: 'product', severity: 'info' });
  });

  it('price move alone → null (NOT an event)', () => {
    expect(classifyEvent("NVIDIA shares jump 5% in today's trading")).toBeNull();
  });

  it('analyst rating → null (NOT an event)', () => {
    expect(classifyEvent('JPMorgan upgrades NVIDIA to Overweight')).toBeNull();
  });

  it('acquisition rumor ("in talks") → null (speculative)', () => {
    expect(classifyEvent('Apple in talks to acquire startup')).toBeNull();
  });

  it('opinion headline with event only in summary → null (headline-only)', () => {
    // "TSLA Critic Gordon Johnson Rips Cybercab Launch..." — the NHTSA probe
    // lives in the summary; the headline itself is commentary, not an event.
    expect(classifyEvent("TSLA Critic Gordon Johnson Rips Cybercab Launch After Elon Musk's Promise")).toBeNull();
  });
});

describe('findEventImpactTriggers — end-to-end trigger construction', () => {
  beforeEach(() => {
    process.env.FINNHUB_IO_API_KEY = 'test-key';
    (mockNews as any).mockReset();
    (mockProfile as any).mockReset();
    (mockProfile as any).mockImplementation((symbol: string) =>
      Promise.resolve(PROFILE_NAMES[symbol.toUpperCase()] ? { name: PROFILE_NAMES[symbol.toUpperCase()] } : null),
    );
  });

  it('review-tier event fires REVIEW_POSITION action + thesis-changed phrase', async () => {
    (mockNews as any).mockResolvedValue([
      article('Tesla faces SEC investigation into Autopilot'),
    ]);
    const input = makeInput({ positions: [pos('TSLA')] });

    const triggers = await findEventImpactTriggers(input, new Set());
    expect(triggers.length).toBe(1);
    expect(triggers[0].trigger_type).toBe('event_impact');
    expect(triggers[0].variant).toBe('warn');
    expect(triggers[0].meta.action).toBe('REVIEW_POSITION:TSLA');
    expect(triggers[0].context).toContain('No action needed unless your original thesis has changed');
  });

  it('info-tier event fires with NO action button', async () => {
    (mockNews as any).mockResolvedValue([
      article('Coca-Cola beats earnings estimates', 'Bloomberg'),
    ]);
    const input = makeInput({ positions: [pos('KO')] });

    const triggers = await findEventImpactTriggers(input, new Set());
    expect(triggers.length).toBe(1);
    expect(triggers[0].trigger_type).toBe('event_impact');
    expect(triggers[0].variant).toBe('accent');
    expect(triggers[0].meta.action).toBeUndefined();
    expect(triggers[0].context).toContain('severity: info');
    expect(triggers[0].context).toContain('no action needed');
  });

  it('large ordinary price move with no event → does NOT fire', async () => {
    (mockNews as any).mockResolvedValue([
      article("Tesla shares jump 5% in today's trading"),
    ]);
    const input = makeInput({ positions: [pos('TSLA')] });

    const triggers = await findEventImpactTriggers(input, new Set());
    expect(triggers).toEqual([]);
  });

  it('irrelevant peer article (no company name in headline) → does NOT fire', async () => {
    (mockNews as any).mockResolvedValue([
      article('AstraZeneca secures FDA nod for breast cancer therapy'),
    ]);
    const input = makeInput({ positions: [pos('LLY')] });

    const triggers = await findEventImpactTriggers(input, new Set());
    expect(triggers).toEqual([]);
  });

  it('clickbait question headline → does NOT fire', async () => {
    (mockNews as any).mockResolvedValue([
      article('Is Tesla Stock a Buy Now Ahead of its Product Launch Event?'),
    ]);
    const input = makeInput({ positions: [pos('TSLA')] });

    const triggers = await findEventImpactTriggers(input, new Set());
    expect(triggers).toEqual([]);
  });

  it('fund/ETF position is skipped', async () => {
    (mockNews as any).mockResolvedValue([
      article('Financial Select Sector SPDR faces SEC investigation'),
    ]);
    const input = makeInput({ positions: [pos('XLF')] });

    const triggers = await findEventImpactTriggers(input, new Set());
    expect(triggers).toEqual([]);
  });

  it('respects existingKeys (no re-fire for same symbol + date)', async () => {
    (mockNews as any).mockResolvedValue([
      article('Tesla faces SEC investigation'),
    ]);
    const today = new Date().toISOString().split('T')[0];
    const input = makeInput({ positions: [pos('TSLA')] });

    const triggers = await findEventImpactTriggers(input, new Set([`EVENT_TSLA_${today}`]));
    expect(triggers).toEqual([]);
  });

  it('picks single most-severe event when a symbol has mixed news', async () => {
    (mockNews as any).mockResolvedValue([
      article('Coca-Cola beats earnings estimates', 'Bloomberg'),
      article('Coca-Cola cuts dividend amid pressure'),
    ]);
    const input = makeInput({ positions: [pos('KO')] });

    const triggers = await findEventImpactTriggers(input, new Set());
    expect(triggers.length).toBe(1);
    expect(triggers[0].meta.action).toBe('REVIEW_POSITION:KO');
    expect(triggers[0].meta.severity).toBe('review');
  });
});
