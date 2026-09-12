// ─── Learning: Curriculum ─────────────────────────────────────
// The ordered training path. LearningLibrary used to be a flat, unordered
// glossary grouped by loose category; this file gives it a progression:
//   Stage (funding-level arc) → Module (a teaching unit) → Topics (cards, in teaching order)
//
// Design rules (Em's call, 2026-09-12):
//   • Go deeper — 4 stages, 12 modules, 100+ topics.
//   • SOFT gating — you can read anything in any order; the path only tells you
//     what comes next ("Next up"). Nothing is locked.
//   • No gamification — no points, no XP, no ranks, no scores. Progress is
//     simply "read ✓" (the existing markConceptShown read-state).
//
// Topic keys MUST match the keys of LEARNING_CARDS in lib/learning/triggers.ts.
// `new: true` marks cards that live in lib/learning/topics/*.ts (i.e. cards that
// did not exist in the original 26). `check: true` marks a module that ends with
// an unscored self-check.

import { LEARNING_CARDS } from './triggers';

export interface CurriculumTopic {
  /** Card key in LEARNING_CARDS */
  key: string;
  /** Card did not exist in the original 26 — lives in lib/learning/topics/*.ts */
  new?: true;
}

export interface CurriculumModule {
  id: string;
  title: string;
  /** One line: why this module matters */
  blurb: string;
  /** Ends with an unscored 3-question self-check (no score kept, no points) */
  check?: boolean;
  topics: CurriculumTopic[];
}

export interface CurriculumStage {
  id: string;
  /** e.g. "Stage 1 · Foundations" */
  title: string;
  blurb: string;
  /** Plain-language difficulty, mirroring the card level pills */
  difficulty: 'Beginner' | 'Beginner → Intermediate' | 'Intermediate' | 'Intermediate → Advanced';
  modules: CurriculumModule[];
}

const t = (key: string, isNew = false): CurriculumTopic => (isNew ? { key, new: true } : { key });

export const CURRICULUM: CurriculumStage[] = [
  {
    id: 's1',
    title: 'Stage 1 · Foundations',
    blurb: 'What a share actually is, what you can own, how an order gets filled, and the numbers on every screen in the app.',
    difficulty: 'Beginner',
    modules: [
      {
        id: 's1m1',
        title: 'How markets work',
        blurb: 'The plumbing behind a price.',
        topics: [
          t('stock', true), t('share', true), t('stock exchange', true), t('ticker symbol', true),
          t('market hours', true), t('bull market'), t('bear market'), t('after-hours trading', true),
        ],
      },
      {
        id: 's1m2',
        title: 'What you can own',
        blurb: 'The building blocks of a portfolio.',
        topics: [
          t('ETF'), t('index fund', true), t('mutual fund', true), t('bond', true),
          t('REIT', true), t('commodity', true), t('cash and money market', true), t('options'),
        ],
      },
      {
        id: 's1m3',
        title: 'Order mechanics',
        blurb: 'How a tap turns into a fill — and how you get a bad one.',
        topics: [
          t('market order'), t('limit order', true), t('stop order', true), t('stop-limit order', true),
          t('time in force', true), t('fractional shares', true), t('bid-ask spread', true), t('slippage', true),
        ],
      },
      {
        id: 's1m4',
        title: 'Numbers on every screen',
        blurb: 'What the numbers on a holding row mean.',
        topics: [
          t('price quote', true), t('market cap'), t('volume', true), t('P/E ratio'),
          t('52-week range', true), t('dividend'), t('dividend yield'), t('settlement T+1', true),
        ],
        check: true,
      },
    ],
  },
  {
    id: 's2',
    title: 'Stage 2 · Reading the Market',
    blurb: 'Read a company (fundamentals), read the backdrop (the economy), read a chart.',
    difficulty: 'Beginner → Intermediate',
    modules: [
      {
        id: 's2m1',
        title: 'Company fundamentals',
        blurb: 'The numbers behind the price.',
        topics: [
          t('earnings per share'), t('revenue growth', true), t('gross margin', true), t('operating margin', true),
          t('free cash flow', true), t('debt-to-equity', true), t('return on equity', true), t('earnings guidance', true),
        ],
        check: true,
      },
      {
        id: 's2m2',
        title: 'The economy',
        blurb: 'Why the whole market moves some days.',
        topics: [
          t('interest rates', true), t('inflation', true), t('consumer price index', true), t('yield curve'),
          t('federal reserve', true), t('fomc meeting', true), t('jobs report', true), t('GDP', true),
          t('recession', true), t('sector rotation', true),
        ],
      },
      {
        id: 's2m3',
        title: 'Reading charts',
        blurb: 'Structure and momentum, without the astrology.',
        topics: [
          t('candlestick', true), t('moving average'), t('support and resistance'), t('RSI'),
          t('MACD', true), t('volume analysis', true), t('trend vs range', true), t('price gap', true),
        ],
        check: true,
      },
    ],
  },
  {
    id: 's3',
    title: 'Stage 3 · Analysis & Risk',
    blurb: 'What it is worth, how to hold it without blowing up, and the vocabulary of risk.',
    difficulty: 'Intermediate',
    modules: [
      {
        id: 's3m1',
        title: 'Valuation',
        blurb: 'Expensive or cheap — versus what?',
        topics: [
          t('forward P/E', true), t('PEG ratio', true), t('price-to-sales', true), t('price-to-book', true),
          t('EV/EBITDA', true), t('discounted cash flow', true), t('margin of safety', true), t('value vs growth', true),
        ],
        check: true,
      },
      {
        id: 's3m2',
        title: 'Portfolio construction',
        blurb: 'How holdings add up — or don\'t.',
        topics: [
          t('portfolio diversification'), t('asset allocation', true), t('correlation'), t('rebalancing', true),
          t('expense ratio', true), t('concentration risk', true), t('dollar cost averaging'), t('compound interest'),
        ],
      },
      {
        id: 's3m3',
        title: 'Risk',
        blurb: 'Measuring the thing that actually costs you money.',
        topics: [
          t('volatility'), t('beta'), t('alpha'), t('max drawdown', true),
          t('sharpe ratio', true), t('position sizing', true), t('stop loss'), t('risk tolerance', true),
        ],
        check: true,
      },
    ],
  },
  {
    id: 's4',
    title: 'Stage 4 · Strategy, Taxes & Behaviour',
    blurb: 'Approaches that repeat, the tax rules that decide your real return, and the biases that break the plan.',
    difficulty: 'Intermediate → Advanced',
    modules: [
      {
        id: 's4m1',
        title: 'Strategies',
        blurb: 'Named approaches you\'ll hear on every finance feed.',
        topics: [
          t('buy and hold', true), t('mean reversion'), t('momentum', true), t('trend following', true),
          t('covered call', true), t('short selling'), t('margin and leverage', true), t('tax loss harvesting'),
        ],
        check: true,
      },
      {
        id: 's4m2',
        title: 'Taxes',
        blurb: 'Where a lot of "return" is actually decided.',
        topics: [
          t('capital gains', true), t('cost basis', true), t('FIFO vs specific identification', true),
          t('wash sale'), t('qualified dividends', true), t('tax-advantaged accounts', true),
        ],
      },
      {
        id: 's4m3',
        title: 'Behaviour',
        blurb: 'The cheapest way to improve returns is not to panic.',
        topics: [
          t('loss aversion', true), t('recency bias', true), t('overconfidence', true),
          t('herd behaviour', true), t('anchoring', true), t('sequence risk', true),
        ],
        check: true,
      },
    ],
  },
];

// ─── Derived lookups ─────────────────────────────────────────

/** Every topic key, in teaching order. */
export const PATH_TOPIC_KEYS: string[] = CURRICULUM.flatMap(s => s.modules).flatMap(m => m.topics).map(x => x.key);

const TOPIC_STAGE = new Map<string, CurriculumStage>();
const TOPIC_MODULE = new Map<string, CurriculumModule>();
for (const stage of CURRICULUM) {
  for (const mod of stage.modules) {
    for (const top of mod.topics) {
      TOPIC_STAGE.set(top.key, stage);
      TOPIC_MODULE.set(top.key, mod);
    }
  }
}

export function stageOfTopic(key: string): CurriculumStage | undefined { return TOPIC_STAGE.get(key); }
export function moduleOfTopic(key: string): CurriculumModule | undefined { return TOPIC_MODULE.get(key); }

/** 1-based position of a topic in the whole path (e.g. "12 of 102"). */
export function pathPosition(key: string): number { return PATH_TOPIC_KEYS.indexOf(key) + 1; }

/** Total topic count for a stage / module. */
export const stageTopicCount = (stage: CurriculumStage) => stage.modules.reduce((n, m) => n + m.topics.length, 0);
export const moduleTopicCount = (mod: CurriculumModule) => mod.topics.length;

/**
 * SOFT gating: the first unread topic in path order. Nothing is locked — the UI
 * just points here so a reader always knows what "next" means.
 */
export function nextUpTopic(isRead: (key: string) => boolean): string | null {
  for (const key of PATH_TOPIC_KEYS) {
    if (!LEARNING_CARDS[key]) continue; // not written yet
    if (!isRead(key)) return key;
  }
  return null;
}

/** How much of a stage / module is read (used for the thin progress rule). */
export function stageReadCount(stage: CurriculumStage, isRead: (key: string) => boolean): number {
  return stage.modules.reduce((n, m) => n + m.topics.filter(c => isRead(c.key)).length, 0);
}

/**
 * Build-time sanity check: every curriculum key must resolve to a card, and every
 * card should be reachable from the path. Used by the QA harness, not by the UI.
 */
export function curriculumCoverage() {
  const cardKeys = new Set(Object.keys(LEARNING_CARDS));
  const pathKeys = new Set(PATH_TOPIC_KEYS);
  return {
    total: PATH_TOPIC_KEYS.length,
    newCards: CURRICULUM.flatMap(s => s.modules).flatMap(m => m.topics).filter(x => x.new).map(x => x.key),
    missing: PATH_TOPIC_KEYS.filter(k => !cardKeys.has(k)),
    orphaned: [...cardKeys].filter(k => !pathKeys.has(k)),
  };
}
