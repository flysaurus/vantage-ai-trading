// ═══════════════════════════════════════════════════════════════
// tests/response-guards.test.ts — post-generation response guards
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/response-guards.test.ts
//
// Covers the pure guards in lib/ai/response-guards.ts: holdings-count mismatch,
// invented projected-score claims, deterministic suppression, literacy-tier
// word/section budgets, and the deterministic health-chart gate.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detectHoldingsCountMismatch,
  detectProjectedScoreClaim,
  suppressProjectedScores,
  enforceTierLimits,
  shouldAttachHealthChart,
} from '../lib/ai/response-guards';

// ── (a) holdings count ───────────────────────────────────────
describe('detectHoldingsCountMismatch', () => {
  it('fires on the exact incident string ("198 holdings" vs 372)', () => {
    const r = detectHoldingsCountMismatch('You currently hold 198 holdings across the account.', 372)!;
    expect(r).toContain('372');
    expect(r).toContain('not 198');
  });

  it('does not fire when the count matches', () => {
    expect(detectHoldingsCountMismatch('You hold 372 holdings.', 372)).toBeNull();
  });

  it('fires for "positions" as well as "holdings"', () => {
    expect(detectHoldingsCountMismatch('You have 198 positions.', 372)).toContain('372');
  });

  it('fires for "stocks" and "securities"', () => {
    expect(detectHoldingsCountMismatch('Across 250 securities.', 372)).toContain('372');
    expect(detectHoldingsCountMismatch('Across 250 stocks.', 372)).toContain('372');
  });

  it('does NOT fire within the 5% tolerance', () => {
    expect(detectHoldingsCountMismatch('You hold 360 holdings.', 372)).toBeNull();
  });

  it('skips qualified "top N" claims', () => {
    expect(detectHoldingsCountMismatch('Your top 10 holdings are all tech.', 372)).toBeNull();
  });

  it('skips qualified "largest N" claims', () => {
    expect(detectHoldingsCountMismatch('Your 5 largest positions drive returns.', 372)).toBeNull();
  });

  it('skips "N individual" phrasings', () => {
    expect(detectHoldingsCountMismatch('You hold 198 individual holdings.', 372)).toBeNull();
  });

  it('returns null when the actual count is unknown (0) or text empty', () => {
    expect(detectHoldingsCountMismatch('You hold 198 holdings.', 0)).toBeNull();
    expect(detectHoldingsCountMismatch('', 372)).toBeNull();
  });
});

// ── (b) projected-score claims ───────────────────────────────
describe('detectProjectedScoreClaim', () => {
  it('catches "would push this to 98–99"', () => {
    expect(detectProjectedScoreClaim('Rebalancing would push this to 98–99.')).not.toBeNull();
  });

  it('catches "would move the score from 91 to 92–94"', () => {
    expect(detectProjectedScoreClaim('Adding tech would move the score from 91 to 92–94.')).not.toBeNull();
  });

  it('catches "To break 85 on Returns"', () => {
    expect(detectProjectedScoreClaim('To break 85 on Returns, add more equity.')).not.toBeNull();
  });

  it('catches would rise/climb/reach variants', () => {
    expect(detectProjectedScoreClaim('Your score would rise to 92.')).not.toBeNull();
    expect(detectProjectedScoreClaim('It could reach 90.')).not.toBeNull();
    expect(detectProjectedScoreClaim('Your score would climb higher.')).toBeNull(); // no number → not a score claim
  });

  it('catches "worth +2–3 points"', () => {
    expect(detectProjectedScoreClaim('That is worth +2–3 points.')).not.toBeNull();
  });

  it('does NOT fire on the user\'s own stated score', () => {
    expect(detectProjectedScoreClaim('Your health score is 91/100.')).toBeNull();
    expect(detectProjectedScoreClaim('Sub-scores: Diversification 94, Risk balance 96, Returns 78.')).toBeNull();
  });

  it('does NOT fire on real labelled figures', () => {
    expect(detectProjectedScoreClaim('Your portfolio gained +11.1% this month.')).toBeNull();
    expect(detectProjectedScoreClaim('Total value is $402,354.93.')).toBeNull();
    expect(detectProjectedScoreClaim('Diversification 94 is your strongest sub-score.')).toBeNull();
  });
});

// ── (c) suppression fallback ─────────────────────────────────
describe('suppressProjectedScores', () => {
  it('removes a "to <n>" projection phrase', () => {
    const r = suppressProjectedScores('Selling RIOT would push this to 98–99.');
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain('98');
    expect(r.text).toContain('Selling RIOT.');
  });

  it('removes a "from X to Y" projection phrase', () => {
    const r = suppressProjectedScores('Adding tech would move the score from 91 to 92–94.');
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain('92');
    expect(r.text).toContain('Adding tech.');
  });

  it('leaves a projection-free response untouched', () => {
    const same = 'Your health score is 91/100.';
    const r = suppressProjectedScores(same);
    expect(r.removed).toBe(0);
    expect(r.text).toBe(same);
  });

  it('preserves real numbers while stripping the projection', () => {
    const r = suppressProjectedScores('Your health score is 91/100. It would push this to 98–99.');
    expect(r.removed).toBe(1);
    expect(r.text).toContain('91/100');
    expect(r.text).not.toContain('98');
  });
});

// ── (d) tier limits ──────────────────────────────────────────
const FILLER = 'Diversification keeps the portfolio steady across market regimes.';

describe('enforceTierLimits', () => {
  it('defaults a NULL/unknown tier to some-experience and trims (never unbounded)', () => {
    const t = Array.from({ length: 60 }, () => 'Sentence about process and patience and staying the course.').join(' ');
    const r = enforceTierLimits(t, null);
    expect(r.tier).toBe('some-experience');
    expect(r.overBudget).toBe(true);
    expect(r.trimmedWords).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(0); // never trimmed to nothing
    expect(enforceTierLimits(t, 'beginner').tier).toBe('some-experience');
  });

  it('trims an over-budget experienced response down to 150 prose words', () => {
    const long = `TL;DR: hold steady.\n\n${Array(25).fill(FILLER).join(' ')}`;
    const r = enforceTierLimits(long, 'experienced');
    expect(r.overBudget).toBe(true);
    expect(r.trimmedWords).toBeGreaterThan(0);
    const prose = r.text.split('\n').filter((l) => l.trim() && !l.startsWith('|')).join(' ').trim().split(/\s+/).length;
    expect(prose).toBeLessThanOrEqual(150);
  });

  it('does not trim a within-budget some-experience response', () => {
    const r = enforceTierLimits(`TL;DR: fine.\n\n${FILLER}`, 'some-experience');
    expect(r.trimmedWords).toBe(0);
    expect(r.overBudget).toBe(false);
  });

  it('never counts markdown table lines as prose', () => {
    const table = '| Name | Value | Notes |\n| --- | --- | --- |\n' + Array(40).fill('| Apple | 100 | a long descriptive cell adding many words |').join('\n');
    const r = enforceTierLimits(`TL;DR: fine.\n\nHere is the breakdown.\n\n${table}`, 'experienced');
    expect(r.trimmedWords).toBe(0);
    expect(r.overBudget).toBe(false);
  });

  it('preserves the TL;DR line when trimming', () => {
    const long = `TL;DR: hold steady.\n\n${Array(25).fill(FILLER).join(' ')}`;
    const r = enforceTierLimits(long, 'experienced');
    expect(r.text).toContain('TL;DR');
  });

  it('never removes a sentence carrying a number', () => {
    const long = `TL;DR: hold steady.\n\nYour portfolio total is $402,354.93.\n\n${Array(25).fill(FILLER).join(' ')}`;
    const r = enforceTierLimits(long, 'experienced');
    expect(r.text).toContain('$402,354.93');
  });

  const SECTIONS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']
    .map((n) => `**${n}**\nContent about patience and discipline.`)
    .join('\n\n');

  it('drops trailing digit-free sections beyond the experienced cap (4)', () => {
    const r = enforceTierLimits(SECTIONS, 'experienced');
    expect(r.droppedSections).toBe(2);
    expect(r.text).not.toContain('Zeta');
    expect(r.text).toContain('Alpha');
  });

  it('respects the some-experience cap of 6 sections', () => {
    const r = enforceTierLimits(SECTIONS, 'some-experience');
    expect(r.droppedSections).toBe(0);
  });
});

// ── (e) deterministic health chart gate ──────────────────────
describe('shouldAttachHealthChart', () => {
  it('attaches when the user asks about the health score and no chart was emitted', () => {
    expect(shouldAttachHealthChart('What is my health score?', 'Your score is 91/100.')).toBe(true);
    expect(shouldAttachHealthChart('which sub-score is weakest?', 'Returns is weakest.')).toBe(true);
    expect(shouldAttachHealthChart("what's driving my score?", 'Diversification.')).toBe(true);
  });

  it('does not attach when the model already emitted a chart/stat marker', () => {
    expect(shouldAttachHealthChart('What is my health score?', 'Your score is 91/100. [CHART:bar|health-subscores]')).toBe(false);
    expect(shouldAttachHealthChart('What is my health score?', 'Your score is 91/100. [STAT:health_score]')).toBe(false);
  });

  it('does not attach for unrelated questions', () => {
    expect(shouldAttachHealthChart('Tell me about tech.', 'Tech is 40% of your portfolio.')).toBe(false);
  });
});

// ── Post-review hardening: market/price talk must never be mistaken for a
//    projected health score (added after the implementation review) ──────────
describe('market-context false-positive guards (review hardening)', () => {
  it('does not flag price/market projections', () => {
    expect(detectProjectedScoreClaim('NVDA could climb 8% by year end.')).toBeNull();
    expect(detectProjectedScoreClaim('The S&P could hit 6000 next quarter.')).toBeNull();
    expect(detectProjectedScoreClaim('Your dividend yield could reach 4%.')).toBeNull();
    expect(detectProjectedScoreClaim('The stock price may break $85 resistance.')).toBeNull();
  });
  it('still flags score projections', () => {
    expect(detectProjectedScoreClaim('Rebalancing would push this to 98–99.')).not.toBeNull();
    expect(detectProjectedScoreClaim('Your score would rise to 92.')).not.toBeNull();
    expect(detectProjectedScoreClaim('To break 85 on Returns, trim the tail.')).not.toBeNull();
  });
  it('suppression leaves market talk untouched', () => {
    const r = suppressProjectedScores('NVDA could climb 8% by year end and the S&P could hit 6000.');
    expect(r.text).toContain('could climb 8%');
    expect(r.text).toContain('could hit 6000');
    expect(r.removed).toBe(0);
  });
  it('suppression still strips score projections', () => {
    const r = suppressProjectedScores('Adding tech would move the score from 91 to 92–94.');
    expect(r.removed).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/92–94/);
  });
});

// ── Live-replay hardening (round 2): target counts + arrow/verb projections ──
describe('live-replay hardening (round 2)', () => {
  it('does NOT flag target/intent counts or ranges as holdings claims', () => {
    expect(detectHoldingsCountMismatch('Consolidate to 30-40 conviction plays.', 372)).toBeNull();
    expect(detectHoldingsCountMismatch('Trim down to 20 positions to cut overlap.', 372)).toBeNull();
    expect(detectHoldingsCountMismatch('Your target is 40 holdings.', 372)).toBeNull();
    expect(detectHoldingsCountMismatch('Keep around 50 stocks.', 372)).toBeNull();
  });
  it('still flags a bare wrong total', () => {
    expect(detectHoldingsCountMismatch('You hold 198 holdings.', 372)).not.toBeNull();
  });
  it('does NOT flag the true total', () => {
    expect(detectHoldingsCountMismatch('You hold 372 positions across the account.', 372)).toBeNull();
  });
  it('catches arrow + modal-less projections from the live replay', () => {
    expect(detectProjectedScoreClaim('Converting conviction into sizing would lift the 91 → 95+.')).not.toBeNull();
    expect(detectProjectedScoreClaim('shift Returns from 78 → 85+.')).not.toBeNull();
    expect(detectProjectedScoreClaim('watch your score jump from 91 to 94+.')).not.toBeNull();
    expect(detectProjectedScoreClaim('Returns is dragging your score down from 95+ territory to 91.')).not.toBeNull();
  });
  it('does NOT flag stated sub-scores or market talk', () => {
    expect(detectProjectedScoreClaim('Sub-scores: Diversification 94, Risk balance 96, Returns 78.')).toBeNull();
    expect(detectProjectedScoreClaim('Diversification 94 and Risk Balance 96 are near-ceilings.')).toBeNull();
    expect(detectProjectedScoreClaim('SPY could move to 6200 next month.')).toBeNull();
    expect(detectProjectedScoreClaim('NVDA could climb 8% by year end.')).toBeNull();
  });
});

// ── Round 3: the shapes the live replay actually produced ──
describe('live-replay hardening (round 3)', () => {
  it('flags the residual projection shapes', () => {
    expect(detectProjectedScoreClaim('would likely shift Returns closer to 85-88 immediately')).not.toBeNull();
    expect(detectProjectedScoreClaim('pushing your total score to 93-94')).not.toBeNull();
    expect(detectProjectedScoreClaim('Your health score is strong. This would likely push you to 94-96.')).not.toBeNull();
    expect(detectProjectedScoreClaim('keep Diversification at 90+')).not.toBeNull();
    expect(detectProjectedScoreClaim("it'd stay 95+ and help Returns")).not.toBeNull();
  });
  it('suppression removes the residual shapes', () => {
    const src = 'This would likely push you to 94-96 with minimal risk, pushing your total score to 93-94.';
    const r = suppressProjectedScores(src);
    expect(r.removed).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/94-96/);
    expect(r.text).not.toMatch(/93-94/);
  });
  it('does not treat target COUNTS as projections', () => {
    expect(detectProjectedScoreClaim('Moving to core 40-50 positions would keep Diversification at 90+')).toMatch(/at 90\+/);
    expect(detectProjectedScoreClaim('Trim to 30-40 holdings.')).toBeNull();
  });
  it('still leaves stated scores and market talk alone', () => {
    expect(detectProjectedScoreClaim('Diversification 94, Risk balance 96, Returns 78.')).toBeNull();
    expect(detectProjectedScoreClaim('NVDA could climb 8% by year end.')).toBeNull();
    expect(detectProjectedScoreClaim('The S&P could hit 6000 next quarter.')).toBeNull();
  });
});

// ── Round 4: a skipped first match must not blind the rule ──
describe('multi-match scanning', () => {
  it('finds a real projection after a skipped count-phrase match', () => {
    const t = 'Moving to core 40-50 positions is wise, and it would push the overall score to 94+.';
    expect(detectProjectedScoreClaim(t)).not.toBeNull();
  });
  it('finds a real projection after a skipped market-context match', () => {
    const t = 'NVDA could climb 8% and that would push your score to 94+.';
    expect(detectProjectedScoreClaim(t)).toBe('would push your score to 94+');
  });
});

// ── NULL / unknown / beginner tiers must NOT be unbounded ──
describe('tier default (NULL is a common real state, not an edge case)', () => {
  // ~600 prose words of digit-free filler plus number-bearing sentences.
  const filler = Array.from(
    { length: 40 },
    () => 'Explanatory sentence about process and discipline and staying the course.',
  ).join(' ');
  const long = [
    '**Verdict:** your book is fine overall and the plan below keeps risk flat while adding breadth.',
    filler,
    'You should keep NVDA at 7.5% and hold cash near 6% of the account because the thesis is intact for now.',
    '**Bottom line:** add to SPY gradually, keep the 6% cash buffer, and revisit after the next CPI print.',
  ].join('\n\n');

  it('applies the some-experience default when the tier is NULL', () => {
    const r = enforceTierLimits(long, null);
    expect(r.tier).toBe('some-experience');
    expect(r.overBudget).toBe(true);
    expect(r.trimmedWords).toBeGreaterThan(0);
  });
  it('defaults unknown tiers instead of leaving them uncapped', () => {
    expect(enforceTierLimits(long, 'expert').tier).toBe('some-experience');
    expect(enforceTierLimits(long, 'nonsense').trimmedWords).toBeGreaterThan(0);
  });
  it('routes beginners through their own budget', () => {
    expect(enforceTierLimits(long, 'new').tier).toBe('new');
  });
  it('never removes a sentence carrying numbers', () => {
    const r = enforceTierLimits(long, null);
    expect(r.text).toContain('7.5%');
    expect(r.text).toContain('6%');
  });
});
