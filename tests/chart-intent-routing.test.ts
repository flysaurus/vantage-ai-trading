// ═══════════════════════════════════════════════════════════════
// tests/chart-intent-routing.test.ts
//
// Charts are emitted as MARKERS BY THE MODEL. The deterministic Tier-0
// answers (account_state, order history, tax-loss…) are plain text and never
// call the model — so if a message that explicitly asks for a chart is routed
// to one of those, the requested chart silently never exists and the user is
// left reading prose that narrates a chart that isn't there.
//
// This file locks the routing invariant that makes that impossible:
//   1. detectVisualRequestIntent() recognises explicit chart/visual asks and
//      does NOT fire on ordinary balance questions.
//   2. classify() never returns account_state for an explicit visual request
//      ("chart my portfolio value over the last month").
//   3. The route-level backstop skips the deterministic account_state answer
//      for visual requests (asserted against the route source).
//
// Every prompt in the capture matrix is covered — these are the exact
// sentences the 14-shot evidence pass sends.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classify, detectVisualRequestIntent } from '../lib/ai/classifier';

const VISUAL_PROMPTS = [
  'Show my portfolio health subscores as a bar chart.',
  'Bar chart of my portfolio health subscores: diversification, risk balance, returns.',
  'I want a bar chart of my health subscores.',
  'Show my sector weights against my target allocation as a grouped bar chart.',
  'Grouped bar chart: my actual sector weights vs my target weights.',
  'Compare my sector weights to targets in one grouped bar chart.',
  'Show my allocation by sector as a donut chart.',
  'Donut chart of my sector allocation.',
  'Break my holdings down by sector in a donut chart.',
  'Chart my portfolio value over the last month as a line chart.',
  'Line chart of my portfolio value over the past month.',
  'Show my portfolio value trend over 1 month as a line chart.',
  'Show all my holdings as a treemap sized by value.',
  'Treemap of my holdings by market value.',
  'Give me a treemap of everything I hold.',
  'Plot my positions as a scatter chart: return on one axis, risk on the other.',
  'Scatter chart of my positions — total return vs risk.',
  'Scatter plot of each position: return vs risk.',
  'Show my account value as a waterfall — contributions, gains, dividends, fees, ending value.',
  'Waterfall chart of what drove my account value: deposits, gains, dividends, fees.',
  'Build a waterfall for how my account value got to where it is.',
];

const PLAIN_QUESTIONS = [
  'How much cash do I have?',
  'What are my positions?',
  "What's my equity?",
  'How much am I invested?',
  'What is my account balance?',
  'Do I have buying power left?',
  'What is a P/E ratio?',
  'How do ETFs work?',
  'Tell me about AAPL.',
  'Buy 10 shares of AAPL.',
  // "line" / "chart" must not be matched inside unrelated words.
  'How much credit line do I have available?',
  'Explain diversification.',
];

describe('detectVisualRequestIntent', () => {
  it.each(VISUAL_PROMPTS)('fires on: %s', (p) => {
    expect(detectVisualRequestIntent(p)).toBe(true);
  });

  it.each(PLAIN_QUESTIONS)('stays quiet on: %s', (p) => {
    expect(detectVisualRequestIntent(p)).toBe(false);
  });

  it('does not fire on a bare "line" in a non-visual sentence', () => {
    expect(detectVisualRequestIntent('what is my credit line')).toBe(false);
    expect(detectVisualRequestIntent('where is the flat line item')).toBe(false);
  });

  it('fires on visual nouns that need no second word', () => {
    expect(detectVisualRequestIntent('treemap of my holdings')).toBe(true);
    expect(detectVisualRequestIntent('scatter of my positions')).toBe(true);
    expect(detectVisualRequestIntent('waterfall of my account value')).toBe(true);
    expect(detectVisualRequestIntent('visualise my sector exposure')).toBe(true);
  });

  it('ignores empty and absurdly long input', () => {
    expect(detectVisualRequestIntent('')).toBe(false);
    expect(detectVisualRequestIntent('x'.repeat(500))).toBe(false);
  });
});

describe('classify — a visual request is never sent to a deterministic read-only answer', () => {
  // classify() short-circuits in the deterministic tier / fast path for these
  // prompts, so no provider call is made here.
  it.each(['Chart my portfolio value over the last month as a line chart.', 'Show my account value as a waterfall — contributions, gains, dividends, fees, ending value.'])(
    'never account_state: %s',
    async (p) => {
      const res = await classify(p);
      expect(res.category).not.toBe('account_state');
    },
  );

  it('still classifies an ordinary balance question as account_state', async () => {
    const res = await classify('How much cash do I have?');
    expect(res.category).toBe('account_state');
  });

  it('keeps the guard narrow: the same balance phrasing without a visual still reads as account_state', async () => {
    const { detectAccountStateIntent } = await import('../lib/ai/account-actions');
    // Same underlying ask, told apart by whether a visual was requested.
    const asked = "What's my portfolio value?";
    const askedAsChart = 'Chart my portfolio value over the last month.';
    expect(detectAccountStateIntent(asked)).toBe(true);
    expect(detectVisualRequestIntent(asked)).toBe(false);
    expect(detectAccountStateIntent(askedAsChart)).toBe(true); // the regex still matches…
    expect(detectVisualRequestIntent(askedAsChart)).toBe(true); // …and the guard now wins
  });
});

describe('route backstop — the deterministic account_state answer is gated on !detectVisualRequestIntent', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/chat/route.ts'), 'utf8');

  it('imports the detector', () => {
    expect(route).toContain('detectVisualRequestIntent');
  });

  it('guards the account_state deterministic dispatch', () => {
    expect(route).toMatch(/classification\.category === 'account_state'\s*&&\s*!detectVisualRequestIntent\(lastMessage\)/);
  });
});

describe('chart resolution rides BOTH response paths', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/chat/route.ts'), 'utf8');
  const calls = route.match(/await emitResolvedCharts\(responseText\)/g) || [];

  it('resolves charts on the light path and the full pipeline', () => {
    // Exactly two call sites: the light-path answer (which returns early) and
    // the full pipeline. Before this, the light path — the one that answers
    // "show my health subscores" — dropped every chart on the floor.
    expect(calls.length).toBe(2);
  });

  it('never lets a chart failure break the response', () => {
    const idx = route.indexOf('const emitResolvedCharts');
    const body = route.slice(idx, idx + 1800);
    expect(body).toContain('catch (chartErr)');
  });
});
