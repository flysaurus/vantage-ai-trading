/**
 * Live verification for the event-impact trigger (no mocks).
 * Run: npx vitest run qa-agent/verify-event-impact.live.test.ts
 *
 * Pulls REAL Finnhub company-news for a curated list of held tickers,
 * classifies every headline with the deterministic classifier, and reports:
 *   - which headlines are REVIEW-tier events (would fire REVIEW_POSITION)
 *   - which are INFO-tier events (would fire, no action)
 *   - which are rejected as price-move / rating / rumor / non-event noise
 * Then runs findEventImpactTriggers end-to-end and prints the final triggers.
 */

import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifyEvent,
  findEventImpactTriggers,
  isRelevantHeadline,
  isNoiseHeadline,
  isFundName,
} from '@/lib/noticed/event-impact';
import { getCompanyNews, getCompanyProfile } from '@/lib/finnhub';
import type { NoticedRuleInput } from '@/lib/noticed/engine';

// Load FINNHUB key from .env.local (values may be quoted).
function loadEnv() {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch (e) {
    console.warn('Could not load .env.local:', (e as Error).message);
  }
}
loadEnv();

// Em's real holdings + a realistic mix (deduped, uppercase).
const HELD = [
  'TSLA', 'KO', 'LLY', 'TSM', 'ALB', 'AXON', 'XLF', 'GLD',
  'NVDA', 'AAPL', 'MSFT', 'JNJ', 'JPM', 'UNH', 'CVX', 'PG',
];

it('live: classify every real headline + report fired triggers', async () => {
  const key = process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY;
  console.log('\n=== FINNHUB key present:', !!key, '===');
  expect(key).toBeTruthy();

  const positions = HELD.map((symbol, i) => ({
    symbol,
    qty: 10,
    marketValue: 50000 - i * 1000,
    avgCost: 100,
    totalPnl: 0,
    totalPnlPercent: 0,
  }));
  const input: NoticedRuleInput = {
    account: { cash: 0, equity: 100000, totalPnl: 0, totalPnlPercent: 0, dayPnl: 0, dayPnlPercent: 0 },
    positions,
    watchlistSymbols: [],
    daysSinceLastTrade: 0,
  };

  const today = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

  console.log('\n=== Per-headline classification with FULL gate chain (relevance + noise + fund) ===');
  for (const symbol of HELD) {
    const profile = await getCompanyProfile(symbol);
    const name = profile?.name || '';
    if (name && isFundName(name)) {
      console.log(`\n[${symbol}] SKIP — fund/ETF (${name})`);
      continue;
    }
    const articles = await getCompanyNews(symbol, from, today);
    if (!articles || articles.length === 0) {
      console.log(`\n[${symbol}] no news in window`);
      continue;
    }
    console.log(`\n[${symbol}] ${articles.length} article(s):`);
    for (const a of articles.slice(0, 8)) {
      const headline = a.headline || '';
      if (!isRelevantHeadline(headline, symbol, name)) {
        console.log(`   [FILTER:irrelevant] ${headline.slice(0, 100)}`);
        continue;
      }
      if (isNoiseHeadline(headline)) {
        console.log(`   [FILTER:clickbait] ${headline.slice(0, 100)}`);
        continue;
      }
      const cls = classifyEvent(headline, a.summary || '');
      const tag = cls ? `FIRES:${cls.category}/${cls.severity}`.toUpperCase() : 'REJECT (price/rating/rumor/non-event)';
      console.log(`   [${tag}] ${headline.slice(0, 100)}`);
    }
  }

  console.log('\n=== findEventImpactTriggers (end-to-end, real data) ===');
  const triggers = await findEventImpactTriggers(input, new Set());
  if (triggers.length === 0) {
    console.log('No event-impact triggers fired in this window for the held set.');
  }
  for (const t of triggers) {
    console.log(`\nTRIGGER: ${t.trigger_key}`);
    console.log(`  title:   ${t.title}`);
    console.log(`  variant: ${t.variant}  icon: ${t.icon}`);
    console.log(`  action:  ${t.meta.action ?? '(none — info tier)'}`);
    console.log(`  context: ${t.context}`);
    console.log(`  follow:  ${t.follow_up}`);
  }
  expect(true).toBe(true);
}, 120000);
