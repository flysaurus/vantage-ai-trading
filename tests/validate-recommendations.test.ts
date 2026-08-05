// ─── validateRecommendations Regression Test Suite ─────────────────
// Tests that known bad AI outputs from historical incidents are
// correctly rejected by validateRecommendations().
//
// Run: npx tsx tests/validate-recommendations.test.ts

import { validateRecommendations, extractBudget } from '../lib/validate-recommendations';
import { detectResponseIncoherence, stripTrailingQuestions } from '../app/api/chat/route';

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

  // ── FIXTURE 5: $1,000 dividend/income portfolio ──
  const FIXTURE_5 = `
[SUMMARY_TLDR:$1,000 across 3 income ETFs — VOO core, QQQ growth, SCHD dividends]

**VOO** (Vanguard S&P 500 ETF) [RECOMMEND:VOO:BUY:$500] — Broad market with yield
**QQQ** (Invesco QQQ Trust) [RECOMMEND:QQQ:BUY:$300] — Tech growth with income
**SCHD** (Schwab US Dividend) [RECOMMEND:SCHD:BUY:$200] — Pure dividend play

Bottom line: $500 VOO + $300 QQQ + $200 SCHD = $1,000 total.
`;
  console.log('\n📋 FIXTURE 5 — $1,000 dividend/income portfolio (VOO, QQQ, SCHD ETFs):');
  await test('PASSES all checks for dividend portfolio', async () => {
    const r = await v(FIXTURE_5, 1000);
    if (!r.ok) throw new Error('Expected OK. Failures: ' + JSON.stringify(r.failures));
  });
  await test('returns 3 ETF suggestions', async () => {
    const r = await v(FIXTURE_5, 1000);
    if (!r.result || r.result.suggestions.length !== 3) throw new Error(`Expected 3, got ${r.result?.suggestions.length}`);
  });
  await test('budget is exactly $1,000 (500+300+200)', async () => {
    const r = await v(FIXTURE_5, 1000);
    if (!r.result || r.result.total !== 1000) throw new Error(`Expected 1000, got ${r.result?.total}`);
  });
  await test('symbols are VOO, QQQ, SCHD (all in mock cache)', async () => {
    const r = await v(FIXTURE_5, 1000);
    if (!r.result) throw new Error('Expected result');
    const syms = r.result.suggestions.map(s => s.symbol).sort();
    const expected = ['QQQ', 'SCHD', 'VOO'];
    if (JSON.stringify(syms) !== JSON.stringify(expected)) throw new Error(`Expected ${expected}, got ${syms}`);
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
  await test('accepts dollar-less amounts (1000 not $1000)', async () => {
    const dx = '[SUMMARY_TLDR:$800]\nMSFT [RECOMMEND:MSFT:BUY:500]\nVGT [RECOMMEND:VGT:BUY:300]\n';
    const r = await v(dx, 800);
    if (!r.ok) throw new Error('Expected OK for dollar-less amounts. Failures: ' + JSON.stringify(r.failures));
    if (r.result.total !== 800) throw new Error(`Expected $800, got $${r.result.total}`);
  });
  await test('rejects exact duplicate symbol (same ticker twice)', async () => {
    const dup = '[SUMMARY_TLDR:$500 NVDA]\n[RECOMMEND:NVDA:BUY:$300]\n[RECOMMEND:NVDA:BUY:$200]\n';
    const r = await v(dup, 500);
    if (r.ok) throw new Error('Expected rejection, got OK');
    const hasDupe = r.failures.some(f => f.check === 'duplicate_company');
    if (!hasDupe) throw new Error('Expected duplicate_company. Failures: ' + JSON.stringify(r.failures));
  });
  await test('rejects over budget ($1,019 = +1.9% — exact match required)', async () => {
    const near = '[SUMMARY_TLDR:$1,019]\nQQQ [RECOMMEND:QQQ:BUY:$600]\nVGT [RECOMMEND:VGT:BUY:$419]\n';
    const r = await v(near, 1000);
    if (r.ok) throw new Error('Expected rejection (1.9% over — exact match required). Got OK');
    const hasBudget = r.failures.some(f => f.check === 'budget_reconciliation');
    if (!hasBudget) throw new Error('Expected budget_reconciliation. Failures: ' + JSON.stringify(r.failures));
  });
  await test('rejects over budget ($1,050 = +5.0%)', async () => {
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

  // ───────────────────────────────────────────────────────────────────
  // Pattern 7: detectResponseIncoherence — CLARIFY contract enforcement
  // ───────────────────────────────────────────────────────────────────
  console.log('\n📋 Pattern 7 — Prose questions outside [CLARIFY:...] blocks:');

  // ── PATTERN 7a: Question mark outside CLARIFY blocks ──
  // This fixture has NO RECOMMEND markers — it's an AI asking a prose
  // question instead of using [CLARIFY:{...}] format. Should be rejected.
  const FIXTURE_P7A = `Here's my analysis of the tech sector. NVDA looks strong on AI demand, MSFT has cloud momentum, and GOOGL is undervalued relative to earnings growth.

Do you want me to focus on AI plays or diversify across the whole sector?`;

  await test('P7a: rejects question mark outside CLARIFY block', async () => {
    const result = detectResponseIncoherence(FIXTURE_P7A);
    if (!result) throw new Error('Expected rejection for prose question');
    if (!result.includes('Prose question detected')) throw new Error('Expected prose question message. Got: ' + result);
  });

  await test('P7a: correctly identifies the question context', async () => {
    const result = detectResponseIncoherence(FIXTURE_P7A);
    if (!result) throw new Error('Expected rejection');
    if (!result.includes('diversify across')) throw new Error('Expected context to include "diversify across". Got: ' + result);
  });

  // ── PATTERN 7b: 3+ alternatives with decision-word ──
  const FIXTURE_P7B = `Here's the portfolio. You could deploy fresh cash, rebalance existing positions, or replace underperformers — let me know.`;

  await test('P7b: rejects 3+ alternatives with decision-word', async () => {
    const result = detectResponseIncoherence(FIXTURE_P7B);
    if (!result) throw new Error('Expected rejection for decision alternatives');
    if (!result.includes('Decision alternatives')) throw new Error('Expected alternatives message. Got: ' + result);
  });

  // ── PATTERN 7b FALSE POSITIVE PREVENTION: single "or" + decision word ──
  // These are normal financial prose, NOT user-facing decision prompts.
  // The tightened regex (2+ "or" connectors) should NOT flag these.

  await test('P7b FP: allows conditional financial prose (could or pull back)', async () => {
    const text = `[SUMMARY_TLDR:$50,000 across 5 growth positions]

NVDA [RECOMMEND:NVDA:BUY:$15000] — NVDA could rally on AI earnings or pull back near support, but the multi-year capex cycle gives us asymmetric upside.`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (single "or" is not a decision prompt). Got: ' + result);
  });

  await test('P7b FP: allows swap/adjust prose (can swap or add)', async () => {
    const text = `[RECOMMEND:SCHD:BUY:$5000]
[RECOMMEND:VYM:BUY:$5000]

We can swap SCHD for VYM or add JEPI for higher yield if you prefer income over total return. Bottom line: $10,000 in dividend ETFs.`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (single "or" is contextual analysis). Got: ' + result);
  });

  await test('P7b FP: allows portfolio adjustment offer (let me know if you want changes)', async () => {
    const text = `[RECOMMEND:AAPL:BUY:$10000]
[RECOMMEND:MSFT:BUY:$10000]

Here it is. Let me know if you want me to adjust any position sizes or tweak the allocation.`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (single "or" is polite offer). Got: ' + result);
  });

  // ── CLARIFY BLOCK STRIPPING ──
  await test('P7: strips [CLARIFY:...] blocks correctly and allows them', async () => {
    const text = `[CLARIFY:{"question":"Growth or value focus?","options":["Growth","Value","50/50"]}]

Based on your choice, I can build a targeted portfolio. This is the key decision before we proceed.`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (valid CLARIFY block, no prose question). Got: ' + result);
  });

  // ── POST-CLARIFY TURN: Valid portfolio after user answers CLARIFY question ──
  // Regression test for the exact bug: turn after user answers a CLARIFY question
  const POST_CLARIFY_PORTFOLIO = `[SUMMARY_TLDR:$100,000 across 8 positions — 50/50 growth/value split, Lynch-style GARP]

**Growth ($50,000 / 50%):**
| Ticker | Company | Amount |
|--------|---------|--------|
| NVDA | NVIDIA | $15,000 |
| MSFT | Microsoft | $12,500 |
| GOOGL | Alphabet | $12,500 |
| AMZN | Amazon | $10,000 |

**Value ($50,000 / 50%):**
| Ticker | Company | Amount |
|--------|---------|--------|
| JPM | JPMorgan | $15,000 |
| JNJ | Johnson & Johnson | $12,500 |
| PG | Procter & Gamble | $12,500 |
| UNH | UnitedHealth | $10,000 |

[RECOMMEND:NVDA:BUY:$15000]
[RECOMMEND:MSFT:BUY:$12500]
[RECOMMEND:GOOGL:BUY:$12500]
[RECOMMEND:AMZN:BUY:$10000]
[RECOMMEND:JPM:BUY:$15000]
[RECOMMEND:JNJ:BUY:$12500]
[RECOMMEND:PG:BUY:$12500]
[RECOMMEND:UNH:BUY:$10000]

The 50/50 split gives you balanced exposure — growth names ride the AI capex cycle while value positions provide defensive yield and capital preservation. NVDA leads the growth basket on AI compute demand, JPM anchors value with a 2.1% yield at 13x forward P/E.`;

  await test('P7: post-CLARIFY portfolio prose passes coherence check', async () => {
    const result = detectResponseIncoherence(POST_CLARIFY_PORTFOLIO);
    if (result) throw new Error('Expected pass for valid post-CLARIFY portfolio. Got: ' + result);
  });

  await test('P7: post-CLARIFY portfolio has no question marks outside CLARIFY', async () => {
    const result = detectResponseIncoherence(POST_CLARIFY_PORTFOLIO);
    if (result) throw new Error('Expected pass. Got: ' + result);
  });

  // ── EDGE CASE: Question mark inside CLARIFY block is fine ──
  await test('P7: allows question marks inside [CLARIFY:...] blocks', async () => {
    const text = `[CLARIFY:{"question":"Growth or value?","options":["Growth","Value"]}]

Let me know.`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (question mark is inside CLARIFY block). Got: ' + result);
  });

  // ── EDGE CASE: URL with query string (http?...) is not a question ──
  await test('P7: ignores question marks in URLs (http query strings)', async () => {
    const text = `[SUMMARY_TLDR:$10,000 AAPL position]

Based on Apple's latest filing at https://investor.apple.com/sec-filings?doc=10-K, the company has strong free cash flow.

[RECOMMEND:AAPL:BUY:$10000]`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (URL query string is not a question). Got: ' + result);
  });

  // ── TRAILING SIGN-OFF TOLERANCE: portfolio markers present + trailing ? ──
  // Regression test for the "Ready to scale this in?" bug — Haiku appends
  // a polite sign-off after a complete portfolio with RECOMMEND markers.
  // The portfolio is valid; the trailing question should be tolerated.

  await test('P7 trailing: tolerates "Sound good?" after RECOMMEND markers', async () => {
    const text = `[SUMMARY_TLDR:$100,000 across 5 growth positions]

[RECOMMEND:NVDA:BUY:$25000]
[RECOMMEND:MSFT:BUY:$25000]
[RECOMMEND:GOOGL:BUY:$20000]
[RECOMMEND:AMZN:BUY:$15000]
[RECOMMEND:TSM:BUY:$15000]

Sound good?`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (trailing sign-off with markers should be tolerated). Got: ' + result);
  });

  await test('P7 trailing: tolerates "Ready to scale this in?" after markers', async () => {
    const text = `[SUMMARY_TLDR:$100,000 across 7 positions]

**Growth:** NVDA, MSFT, GOOGL, AMZN...

[RECOMMEND:NVDA:BUY:$15000]
[RECOMMEND:MSFT:BUY:$12500]
[RECOMMEND:GOOGL:BUY:$12500]
[RECOMMEND:AMZN:BUY:$10000]

Execution plan: Buy ETFs first, then layer in individual stocks over 2-3 days.
Ready to scale this in?`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (trailing sign-off with markers should be tolerated). Got: ' + result);
  });

  await test('P7 trailing: tolerates "Want me to adjust anything?" after markers', async () => {
    const text = `[RECOMMEND:AAPL:BUY:$10000]
[RECOMMEND:MSFT:BUY:$10000]

Want me to adjust anything?`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (trailing sign-off tolerated). Got: ' + result);
  });

  await test('P7 trailing: STILL rejects question BEFORE markers (not trailing)', async () => {
    const text = `I have a few questions. Would you prefer growth or value? Let me know and I'll build the portfolio.

[RECOMMEND:NVDA:BUY:$10000]`;
    const result = detectResponseIncoherence(text);
    if (!result) throw new Error('Expected rejection (question BEFORE markers is not a trailing sign-off)');
    if (!result.includes('Prose question detected')) throw new Error('Expected prose question message. Got: ' + result);
  });

  await test('P7 trailing: rejects question without RECOMMEND markers (clarify-format violation)', async () => {
    const text = `Here's what I think. Sound good?`;
    const result = detectResponseIncoherence(text);
    if (!result) throw new Error('Expected rejection (no markers, question outside CLARIFY)');
  });

  // ── MULTI-STRATEGY TOLERANCE ──
  // Pattern 1 + 2: when user asks for "different strategies", the AI may
  // present multiple labeled strategy sections with different position counts
  // and totals. These are NOT contradictions — they're separate options.

  await test('P1 FP: allows multiple totals under labeled strategy headers', async () => {
    const text = `Here are 3 strategies:

**Strategy 1 — Growth Aggressive**
| Ticker | Name | Allocation |
|---|---|---|
| NVDA | NVIDIA | $4,000 |
| MSFT | Microsoft | $3,000 |
| QQQ | Invesco QQQ | $3,000 |
| **Total** | | **$10,000** |

**Strategy 2 — Balanced Core**
| Ticker | Name | Allocation |
|---|---|---|
| VOO | Vanguard S&P 500 | $6,000 |
| SCHD | Schwab Dividend | $2,000 |
| MSFT | Microsoft | $2,000 |
| **Total** | | **$10,000** |

[CLARIFY:{"question":"Which strategy?","options":["Growth Aggressive","Balanced Core"]}]`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (labeled strategy tables are not contradictions). Got: ' + result);
  });

  await test('P2 FP: allows different position counts under labeled strategy headers', async () => {
    const text = `**Option 1 — Concentrated**: 4 positions totaling $10,000

NVDA, MSFT, GOOGL, AMZN — high conviction tech only.

**Option 2 — Diversified**: 8 positions totaling $9,500

VOO, QQQ, NVDA, MSFT, JPM, PG, UNH, CAT — broad exposure with downside protection.

[CLARIFY:{"question":"Which approach?","options":["Concentrated","Diversified"]}]`;
    const result = detectResponseIncoherence(text);
    if (result) throw new Error('Expected pass (labeled strategy options with different counts are not contradictions). Got: ' + result);
  });

  await test('P1: STILL rejects multiple totals without strategy headers', async () => {
    const text = `Here's your portfolio:

| Ticker | Name | Allocation |
|---|---|---|
| NVDA | NVIDIA | $4,000 |
| **Total** | | **$10,000** |

[RECOMMEND:NVDA:BUY:$4000]

Wait, let me adjust that. Here's the revised version:

| Ticker | Name | Allocation |
|---|---|---|
| NVDA | NVIDIA | $3,800 |
| MSFT | Microsoft | $3,200 |
| QQQ | Invesco QQQ | $2,500 |
| **Total** | | **$9,500** |

[RECOMMEND:NVDA:BUY:$3800]
[RECOMMEND:MSFT:BUY:$3200]
[RECOMMEND:QQQ:BUY:$2500]`;
    const result = detectResponseIncoherence(text);
    if (!result) throw new Error('Expected rejection (two totals without strategy headers is a contradiction)');
    if (!result.includes('contradictory portfolio totals')) throw new Error('Expected contradiction message. Got: ' + result);
  });

  // ── stripTrailingQuestions helper ──
  console.log('\n📋 stripTrailingQuestions — Remove sign-off questions from portfolio output:');

  await test('stripTrailing: removes "Ready to scale this in?" after last marker', async () => {
    const text = `[RECOMMEND:NVDA:BUY:$15000]
[RECOMMEND:MSFT:BUY:$12500]

Execution plan: Buy ETFs first. Ready to scale this in?`;
    const cleaned = stripTrailingQuestions(text);
    if (cleaned.includes('Ready to scale this in?')) throw new Error('Trailing question should be stripped. Got: ' + cleaned);
    if (!cleaned.includes('[RECOMMEND:NVDA')) throw new Error('Markers should be preserved. Got: ' + cleaned);
    if (!cleaned.includes('Execution plan: Buy ETFs first.')) throw new Error('Prose before question should be preserved. Got: ' + cleaned);
  });

  await test('stripTrailing: removes "Sound good?" from end', async () => {
    const text = `[RECOMMEND:AAPL:BUY:$10000]

Sound good?`;
    const cleaned = stripTrailingQuestions(text);
    if (cleaned.includes('Sound good?')) throw new Error('Trailing question should be stripped. Got: ' + cleaned);
    if (!cleaned.includes('[RECOMMEND:AAPL')) throw new Error('Markers should be preserved. Got: ' + cleaned);
  });

  await test('stripTrailing: no-op on text without trailing question', async () => {
    const text = `[SUMMARY_TLDR:$50,000 across 5 positions]

[RECOMMEND:NVDA:BUY:$15000]
[RECOMMEND:MSFT:BUY:$12500]

The 50/50 split gives balanced exposure.`;
    const cleaned = stripTrailingQuestions(text);
    if (cleaned !== text.trim()) throw new Error('Should be no-op when no trailing question. Got: ' + cleaned);
  });

  await test('stripTrailing: no-op on text without RECOMMEND markers', async () => {
    const text = `Here's some analysis. Sound good?`;
    const cleaned = stripTrailingQuestions(text);
    if (cleaned !== text) throw new Error('Should be no-op without markers. Got: ' + cleaned);
  });

  // ── Summary ──
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
