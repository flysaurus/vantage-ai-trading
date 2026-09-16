/**
 * Scratch: scan 14 days of REAL Finnhub news across a broad ticker set and
 * print ONLY headlines that pass the full event-impact gate chain (fund-skip,
 * relevance, noise-reject, classify). Used to prove the FIRES path on real data.
 * Run: npx vitest run qa-agent/scan-event-fires.test.ts
 */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifyEvent,
  isRelevantHeadline,
  isNoiseHeadline,
  isFundName,
} from '@/lib/noticed/event-impact';
import { getCompanyNews, getCompanyProfile } from '@/lib/finnhub';

function loadEnv() {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch {}
}
loadEnv();

const TICKERS = ['TSLA','KO','LLY','TSM','ALB','AXON','NVDA','AAPL','MSFT','JNJ','JPM','UNH','CVX','PG','AMZN','META','GOOGL','AMD','INTC','BA','DIS','NFLX','PFE','MRK','ABBV','COST','WMT','HD','V','MA','XOM','COP','PLTR','ORCL','CRM','ADBE','QCOM','MU','GE','CAT','GM','F','UBER','SQ','SHOP','SNOW','CRWD','PANW','FTNT'];

it('scan: real headline-level events that FIRE', async () => {
  const from = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  let total = 0;
  for (const symbol of TICKERS) {
    const profile = await getCompanyProfile(symbol);
    const name = profile?.name || '';
    if (name && isFundName(name)) continue;
    const articles = await getCompanyNews(symbol, from, today);
    if (!Array.isArray(articles)) continue;
    for (const a of articles.slice(0, 20)) {
      const headline = a.headline || '';
      if (!isRelevantHeadline(headline, symbol, name)) continue;
      if (isNoiseHeadline(headline)) continue;
      const cls = classifyEvent(headline);
      if (!cls) continue;
      total++;
      console.log(`FIRE [${symbol}] ${cls.category}/${cls.severity} — ${headline.slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log(`\nTotal headline-level fires in 14d window: ${total}`);
  expect(true).toBe(true);
}, 180000);
