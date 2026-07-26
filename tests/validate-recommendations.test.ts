// ─── validateRecommendations Regression Test Suite ─────────────────
// Tests that known bad AI outputs from historical incidents are
// correctly rejected by validateRecommendations().
//
// Run: npx tsx tests/validate-recommendations.test.ts

import { validateRecommendations, extractBudget } from '../lib/validate-recommendations';

// Mock US symbol cache for test environment (no Finnhub API key)
const MOCK_SYMBOLS = new Set([
  'VGT', 'VOO', 'QQQ', 'SPY', 'XLK', 'SCHD', 'ARKK', 'IWM',
  'MSFT', 'AAPL', 'NVDA', 'ASML', 'TSM', 'AVGO', 'ANET',
  'VRT', 'MRVL', 'LLY', 'BX', 'AMZN', 'GOOGL', 'META',
  'TSLA', 'JPM', 'BRK.B', 'UNH', 'V', 'MA', 'JNJ', 'PG',
]);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function v(text: string, budget: number | null) {
  return validateRecommendations(text, budget, MOCK_SYMBOLS);
}

// ───────────────────────────────────────────────────────────────────
// FIXTURES: Historical bad AI responses
// ───────────────────────────────────────────────────────────────────

// INCIDENT 1: $1,000 5yr tech — exchange suffix VGT.DE + $900 total
const FIXTURE_1 = `
[SUMMARY_TLDR:$1,000 across 4 tech positions — 50% ETF / 50% individual picks]

For a $1,000 5-year tech portfolio, here's my recommendation:

**CORE ETF (50% = $500)**
Vanguard Information Technology ETF (VGT) — broad tech sector exposure.

**GROWTH PICKS (50% = $500)**
Microsoft (MSFT), NVIDIA (NVDA), ASML Holding (ASML).

[RECOMMEND:VGT.DE:BUY:$500]
[RECOMMEND:MSFT:BUY:$200]
[RECOMMEND:NVDA:BUY:$200]

Bottom line: $1,000 split evenly between VGT and three individual picks.
`;

// INCIDENT 2: $10,000 10yr growth — budget miss ($9,500 total = 5% under)
const FIXTURE_2 = `
[SUMMARY_TLDR:$10,000 across 7 positions — diversified growth]

VOO [RECOMMEND:VOO:BUY:$2500] — S&P 500
QQQ [RECOMMEND:QQQ:BUY:$1500] — Nasdaq 100
AAPL [RECOMMEND:AAPL:BUY:$1200] — Apple
MSFT [RECOMMEND:MSFT:BUY:$1300] — Microsoft
NVDA [RECOMMEND:NVDA:BUY:$1000] — NVIDIA
TSM [RECOMMEND:TSM:BUY:$1000] — TSMC
LLY [RECOMMEND:LLY:BUY:$1000] — Eli Lilly

Bottom line: $10,000 diversified — total sums to $10,000.
`;

// INCIDENT 3: $1,000 AI infra — malformed marker (no $ inside brackets)
const FIXTURE_3 = `
[SUMMARY_TLDR:$1,000 AI infra bet across 5 picks]

[RECOMMEND:NVDA:BUY]$150
[RECOMMEND:AVGO:BUY:$100]
[RECOMMEND:ANET:BUY:$100]
[RECOMMEND:VRT:BUY:$100]
[RECOMMEND:MRVL:BUY:$50]

Bottom line: $1,000 AI infra.
`;

// FIXTURE 4: Clean valid response (should PASS)
const FIXTURE_4 = `
[SUMMARY_TLDR:$1,000 across 4 tech positions — 50% ETF / 50% individual picks]

VGT [RECOMMEND:VGT:BUY:$500] — broad tech ETF
MSFT [RECOMMEND:MSFT:BUY:$200] — enterprise AI
NVDA [RECOMMEND:NVDA:BUY:$150] — AI compute
ASML [RECOMMEND:ASML:BUY:$150] — EUV lithography monopoly

Bottom line: $500 VGT safety, $500 in three AI-linked individual picks.
`;

// ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  validateRecommendations TEST SUITE');
  console.log('═══════════════════════════════════════════\n');

  // ── Budget extraction ──
  console.log('📋 Budget Extraction:');
  await test('extracts "$1,000" from portfolio prompt', async () => {
    const b = extractBudget('Build me a $1,000 5-year tech portfolio');
    if (b !== 1000) throw new Error(`Expected 1000, got ${b}`);
  });
  await test('extracts "$10,000" from growth prompt', async () => {
    const b = extractBudget('Build me a $10,000 10-year growth portfolio');
    if (b !== 10000) throw new Error(`Expected 10000, got ${b}`);
  });
  await test('extracts "10k" notation', async () => {
    const b = extractBudget('Build me a 10k portfolio focused on AI');
    if (b !== 10000) throw new Error(`Expected 10000, got ${b}`);
  });
  await test('extracts from "I want to invest $5,000 in AI"', async () => {
    const b = extractBudget('I want to invest $5,000 in AI stocks');
    if (b !== 5000) throw new Error(`Expected 5000, got ${b}`);
  });
  await test('returns null for non-budget messages', async () => {
    const b = extractBudget('What do you think about NVDA?');
    if (b !== null) throw new Error(`Expected null, got ${b}`);
  });

  // ── FIXTURE 1: Exchange suffix + budget miss ──
  console.log('\n📋 FIXTURE 1 — $1,000 5yr tech (VGT.DE exchange suffix + missing ASML marker):');
  await test('rejects VGT.DE exchange suffix (symbol_resolution)', async () => {
    const r = await v(FIXTURE_1, 1000);
    if (r.ok) throw new Error('Expected rejection, got OK');
    const hasSym = r.failures.some(f => f.check === 'symbol_resolution' && f.detail.includes('VGT.DE'));
    if (!hasSym) throw new Error('Expected symbol_resolution for VGT.DE. Failures: ' + JSON.stringify(r.failures));
  });
  await test('suggests US listing "VGT" as replacement for VGT.DE', async () => {
    const r = await v(FIXTURE_1, 1000);
    if (r.ok) throw new Error('Expected rejection');
    const sf = r.failures.find(f => f.check === 'symbol_resolution');
    if (!sf || !sf.detail.includes('Use US primary listing')) {
      throw new Error('Expected helpful suggestion. Got: ' + (sf?.detail || 'none'));
    }
  });

  // ── FIXTURE 2: Budget mismatch ($9,500 vs $10,000 = 5% under) ──
  console.log('\n📋 FIXTURE 2 — $10,000 10yr growth ($9,500 total = 5% under budget):');
  await test('rejects budget mismatch ($9,500 ≠ $10,000)', async () => {
    const r = await v(FIXTURE_2, 10000);
    if (r.ok) throw new Error('Expected rejection, got OK');
    const hasBudget = r.failures.some(f => f.check === 'budget_reconciliation');
    if (!hasBudget) throw new Error('Expected budget_reconciliation. Failures: ' + JSON.stringify(r.failures));
  });
  await test('shows correct total ($9,500) and 5.0% under', async () => {
    const r = await v(FIXTURE_2, 10000);
    if (r.ok) throw new Error('Expected rejection');
    const bf = r.failures.find(f => f.check === 'budget_reconciliation');
    if (!bf) throw new Error('Expected budget_reconciliation failure');
    if (!bf.detail.includes('$9,500') || !bf.detail.includes('under')) {
      throw new Error('Expected "$9,500" and "under". Got: ' + bf.detail);
    }
  });

  // ── FIXTURE 3: Malformed marker format ──
  console.log('\n📋 FIXTURE 3 — $1,000 AI infra (malformed marker [RECOMMEND:NVDA:BUY]$150):');
  await test('rejects malformed marker format (no $ in brackets)', async () => {
    const r = await v(FIXTURE_3, 1000);
    if (r.ok) throw new Error('Expected rejection, got OK');
    const hasFormat = r.failures.some(f =>
      f.check === 'marker_format' && f.offendingMarkers.some(m => m.includes('NVDA'))
    );
    if (!hasFormat) throw new Error('Expected marker_format for NVDA malformed marker. Failures: ' + JSON.stringify(r.failures));
  });
  await test('counts only 4 valid markers ($350 total) after rejecting malformed NVDA marker', async () => {
    const r = await v(FIXTURE_3, 1000);
    if (r.ok) throw new Error('Expected rejection');
    // Malformed NVDA marker rejected from validMarkers → 4 valid = $350
    // Budget check: $350 vs $1000 = 65% under → also fails
    const hasBudget = r.failures.some(f => f.check === 'budget_reconciliation');
    if (!hasBudget) throw new Error('Expected budget_reconciliation on $350 total. Failures: ' + JSON.stringify(r.failures));
  });

  // ── FIXTURE 4: Clean valid response — must PASS ──
  console.log('\n📋 FIXTURE 4 — Clean valid $1,000 5yr tech (should PASS):');
  await test('PASSES all validation checks', async () => {
    const r = await v(FIXTURE_4, 1000);
    if (!r.ok) throw new Error('Expected OK, got failures: ' + JSON.stringify(r.failures));
  });
  await test('returns exactly 4 suggestions', async () => {
    const r = await v(FIXTURE_4, 1000);
    if (!r.ok) throw new Error('Expected OK');
    if (r.result.count !== 4) throw new Error(`Expected 4, got ${r.result.count}`);
  });
  await test('total is exactly $1,000', async () => {
    const r = await v(FIXTURE_4, 1000);
    if (!r.ok) throw new Error('Expected OK');
    if (r.result.total !== 1000) throw new Error(`Expected $1,000, got $${r.result.total}`);
  });
  await test('all symbols are VGT, MSFT, NVDA, ASML', async () => {
    const r = await v(FIXTURE_4, 1000);
    if (!r.ok) throw new Error('Expected OK');
    const syms = r.result.suggestions.map(s => s.symbol).sort();
    const expected = ['ASML', 'MSFT', 'NVDA', 'VGT'];
    if (JSON.stringify(syms) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${expected}, got ${syms}`);
    }
  });

  // ── EDGE CASES ──
  console.log('\n📋 Edge Cases:');
  await test('accepts comma-formatted amounts ($1,000, $1,500.50)', async () => {
    const commas = '[SUMMARY_TLDR:$1,500]\nMSFT [RECOMMEND:MSFT:BUY:$1,000]\nVGT [RECOMMEND:VGT:BUY:$500]\n';
    const r = await v(commas, 1500);
    if (!r.ok) throw new Error('Expected OK for comma amounts. Failures: ' + JSON.stringify(r.failures));
    if (r.result.total !== 1500) throw new Error(`Expected $1500, got $${r.result.total}`);
  });
  await test('accepts decimal comma amounts ($1,500.50)', async () => {
    const dec = '[SUMMARY_TLDR:$1,500.50]\nMSFT [RECOMMEND:MSFT:BUY:$1,500.50]\n';
    const r = await v(dec, 1500.50);
    if (!r.ok) throw new Error('Expected OK for decimal comma amounts. Failures: ' + JSON.stringify(r.failures));
    if (r.result.total !== 1500.50) throw new Error(`Expected $1500.50, got $${r.result.total}`);
  });
  await test('rejects exact duplicate symbol (same ticker twice)', async () => {
    const dup = '[SUMMARY_TLDR:$500 NVDA]\n[RECOMMEND:NVDA:BUY:$300]\n[RECOMMEND:NVDA:BUY:$200]\n';
    const r = await v(dup, 500);
    if (r.ok) throw new Error('Expected rejection, got OK');
    const hasDupe = r.failures.some(f => f.check === 'duplicate_company');
    if (!hasDupe) throw new Error('Expected duplicate_company. Failures: ' + JSON.stringify(r.failures));
  });
  await test('passes at edge of budget tolerance ($1,019 = +1.9%)', async () => {
    const near = '[SUMMARY_TLDR:$1,019]\nQQQ [RECOMMEND:QQQ:BUY:$600]\nVGT [RECOMMEND:VGT:BUY:$419]\n';
    const r = await v(near, 1000);
    if (!r.ok) throw new Error('Expected OK (1.9% within 2% tolerance). Failures: ' + JSON.stringify(r.failures));
  });
  await test('rejects over 2% budget deviation ($1,050 = +5.0%)', async () => {
    const over = '[SUMMARY_TLDR:$1,050]\nQQQ [RECOMMEND:QQQ:BUY:$600]\nVGT [RECOMMEND:VGT:BUY:$450]\n';
    const r = await v(over, 1000);
    if (r.ok) throw new Error('Expected rejection (5% over). Got OK');
    const hasBudget = r.failures.some(f => f.check === 'budget_reconciliation');
    if (!hasBudget) throw new Error('Expected budget_reconciliation. Failures: ' + JSON.stringify(r.failures));
  });
  await test('rejects non-US symbol (foreign exchange suffix)', async () => {
    const foreign = '[SUMMARY_TLDR:$500 germany]\n[RECOMMEND:SAP.DE:BUY:$500]\n';
    const r = await v(foreign, 500);
    if (r.ok) throw new Error('Expected rejection for SAP.DE');
    if (!r.failures.some(f => f.check === 'symbol_resolution')) {
      throw new Error('Expected symbol_resolution. Failures: ' + JSON.stringify(r.failures));
    }
  });
  await test('rejects unknown symbol (not in cache)', async () => {
    const unknown = '[SUMMARY_TLDR:$500 bogus]\n[RECOMMEND:ZZZZ:BUY:$500]\n';
    const r = await v(unknown, 500);
    if (r.ok) throw new Error('Expected rejection for ZZZZ');
    if (!r.failures.some(f => f.check === 'symbol_resolution')) {
      throw new Error('Expected symbol_resolution. Failures: ' + JSON.stringify(r.failures));
    }
  });
  await test('rejects under-allocated budget ($300 vs $1,000)', async () => {
    const under = '[SUMMARY_TLDR:$300]\nVGT [RECOMMEND:VGT:BUY:$300]\n';
    const r = await v(under, 1000);
    if (r.ok) throw new Error('Expected rejection (70% under)');
    const bf = r.failures.find(f => f.check === 'budget_reconciliation');
    if (!bf) throw new Error('Expected budget_reconciliation');
    if (!bf.detail.includes('under')) throw new Error('Expected "under" in detail: ' + bf.detail);
  });

  // ── Summary ──
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
