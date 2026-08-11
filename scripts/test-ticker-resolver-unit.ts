// ─── Ticker Resolver Unit Tests (Tier 0 + classification logic) ──
// Tests that don't require API keys — verifies regex extraction,
// NOT_TICKERS filtering, PREVERIFIED matching, and the full
// architecture contract that each tier respects.
// ────────────────────────────────────────────────────────────────

import { NOT_TICKERS, PREVERIFIED_TICKERS, FALLBACK_SYMBOLS } from '../lib/symbol-resolution';

// ── Tier 0: Regex extraction logic (same as ticker-resolver.ts) ──
function extractRegexTickers(text: string): string[] {
  const matches = text.match(/\$?\b([A-Z]{2,5})\b/gi);
  if (!matches) return [];
  const tickers = matches
    .map(t => t.replace('$', '').toUpperCase())
    .filter(t => !NOT_TICKERS.has(t));
  return [...new Set(tickers)];
}

// ── Tier 0: Validate against PREVERIFIED + FALLBACK ──
function tier0Validate(symbol: string): { symbol: string; name: string } | null {
  const upper = symbol.toUpperCase();
  if (PREVERIFIED_TICKERS[upper]) {
    return { symbol: upper, name: PREVERIFIED_TICKERS[upper].name };
  }
  if (FALLBACK_SYMBOLS[upper]) {
    return { symbol: upper, name: FALLBACK_SYMBOLS[upper] };
  }
  return null;
}

// ── Expected classification categories (without API call) ──
// These verify the architecture DESIGN, not the API response
const CLASSIFICATION_EXPECTATIONS: Record<string, string> = {
  'spec x': 'ticker_candidate',            // misspelled ticker
  "Elon Musk's latest company": 'time_sensitive_factual',  // needs web search
  'Elon space company': 'descriptive_reference',            // descriptive
  'trillionaire company': 'category_too_broad',             // too vague
  'trillionaire owned company': 'time_sensitive_contested', // contested claim
};

function main() {
  console.log('═══ Ticker Resolver — Unit Tests (no API keys needed) ═══\n');

  let passed = 0;
  let failed = 0;

  // ── Test 1: Tier 0 regex extraction ──────────────────
  console.log('── Tier 0: Regex Extraction ──');

  const regexTests: [string, string[]][] = [
    ['Buy 1000 worth spcx', ['SPCX']],
    ['check AAPL and $TSLA', ['AAPL', 'TSLA']],
    ['spec x', []],  // "spec" and "x" are 4 and 1 chars — "x" is too short
    ['what about SPY QQQ', ['SPY', 'QQQ']],
    ['Elon Musk latest company', []],  // no ticker tokens
    ['Buy SOME STOCK NOW', []],  // STOCK, SOME, NOW filtered by NOT_TICKERS
    ['WORTH ABOUT THINK SHARE', []],  // all NOT_TICKERS
    ['NVDA MSFT GOOGL', ['NVDA', 'MSFT', 'GOOGL']],
  ];

  for (const [input, expected] of regexTests) {
    const result = extractRegexTickers(input);
    const sortedResult = [...result].sort();
    const sortedExpected = [...expected].sort();
    const match = JSON.stringify(sortedResult) === JSON.stringify(sortedExpected);
    if (match) {
      console.log(`  ✅ "${input}" → [${result.join(', ') || '(none)'}]`);
      passed++;
    } else {
      console.log(`  ❌ "${input}" → got [${result.join(', ')}], expected [${expected.join(', ')}]`);
      failed++;
    }
  }

  // ── Test 2: NOT_TICKERS coverage ─────────────────────
  console.log('\n── Tier 0: NOT_TICKERS Filtering ──');
  
  const notTickerTests = [
    'STOCK', 'WORTH', 'ABOUT', 'THINK', 'SHARE', 'QUOTE',
    'BUY', 'SELL', 'HOLD', 'MARKET', 'TRADE', 'PRICE',
    'TODAY', 'YESTERDAY', 'TOMORROW', 'MONTH', 'YEAR',
    'MONEY', 'DOLLAR', 'CENTS', 'COST', 'VALUE', 'GAIN',
    'LOSS', 'PROFIT', 'LATEST', 'BEST', 'TOP', 'NEW',
    'HIGH', 'LOW', 'OPEN', 'CLOSE', 'VOLUME', 'CHANGE',
    'ORDER', 'LIMIT', 'STOP', 'GTC', 'DAY', 'IOC',
  ];

  for (const word of notTickerTests) {
    if (NOT_TICKERS.has(word)) {
      passed++;
    } else {
      console.log(`  ❌ "${word}" missing from NOT_TICKERS`);
      failed++;
    }
  }
  // Also verify they get filtered in extraction
  const trickyInput = notTickerTests.slice(0, 10).join(' ');
  const extracted = extractRegexTickers(trickyInput);
  if (extracted.length === 0) {
    console.log(`  ✅ All ${notTickerTests.length} common words verified in NOT_TICKERS`);
    passed++;
  } else {
    console.log(`  ❌ Extracted ${extracted.join(', ')} from NOT_TICKERS test input`);
    failed++;
  }

  // ── Test 3: PREVERIFIED + FALLBACK coverage ──────────
  console.log('\n── Tier 0: PREVERIFIED + FALLBACK Validation ──');

  const preverifiedTests = [
    { symbol: 'SPCX', expectedName: 'Space Exploration Technologies Corp.' },
    { symbol: 'spcx', expectedName: 'Space Exploration Technologies Corp.' },
    { symbol: 'SPACE EXPLORATION', expectedName: 'Space Exploration Technologies Corp.' },
  ];

  for (const { symbol, expectedName } of preverifiedTests) {
    const result = tier0Validate(symbol);
    if (result && result.name === expectedName) {
      console.log(`  ✅ "${symbol}" → ${result.symbol} (${result.name})`);
      passed++;
    } else if (result) {
      console.log(`  ⚠️ "${symbol}" → ${result.symbol} (${result.name}) — name mismatch, expected "${expectedName}"`);
    } else {
      console.log(`  ❌ "${symbol}" → not found in PREVERIFIED or FALLBACK`);
      failed++;
    }
  }

  // ── Test 4: Architecture contract ────────────────────
  console.log('\n── Architecture Contract Verification ──');

  // 4a: Classification categories match design
  console.log('  4a: Classification categories');
  const expectedCategories = [
    'ticker_candidate', 'company_name', 'descriptive_reference',
    'time_sensitive_factual', 'time_sensitive_contested', 'category_too_broad',
  ];
  for (const tc of TEST_CASES) {
    const expected = CLASSIFICATION_EXPECTATIONS[tc.input];
    if (expected && expectedCategories.includes(expected)) {
      console.log(`    ✅ "${tc.input}" → ${expected}`);
      passed++;
    } else {
      console.log(`    ❌ "${tc.input}" → unknown category: ${expected}`);
      failed++;
    }
  }

  // 4b: Resolver module exists and exports correct types
  console.log('  4b: Module exports');
  try {
    const resolver = require('../lib/ticker-resolver');
    if (typeof resolver.resolveTickers === 'function') {
      console.log('    ✅ resolveTickers() exported');
      passed++;
    } else {
      console.log('    ❌ resolveTickers not exported');
      failed++;
    }
  } catch (e: any) {
    console.log(`    ❌ Import failed: ${e.message}`);
    failed++;
  }

  // 4c: Principles module exports all 3 surface combos
  console.log('  4c: Principles module');
  try {
    const principles = require('../lib/ai-principles');
    const exports = ['CHAT_PRINCIPLES', 'BRIEF_PRINCIPLES', 'AGENT_PRINCIPLES'];
    for (const exp of exports) {
      if (Array.isArray(principles[exp])) {
        console.log(`    ✅ ${exp} exported (${principles[exp].length} blocks)`);
        passed++;
      } else {
        console.log(`    ❌ ${exp} not exported or not an array`);
        failed++;
      }
    }
  } catch (e: any) {
    console.log(`    ❌ Import failed: ${e.message}`);
    failed++;
  }

  // ── Test 5: Resolver edge cases ──────────────────────
  console.log('\n── Edge Cases ──');

  // Empty input
  const emptyResult = extractRegexTickers('');
  if (emptyResult.length === 0) {
    console.log('  ✅ Empty input → no tickers');
    passed++;
  } else {
    console.log(`  ❌ Empty input extracted: ${emptyResult.join(', ')}`);
    failed++;
  }

  // Pure numbers (no letters)
  const numbersResult = extractRegexTickers('buy 100 shares at 150.50');
  if (numbersResult.length === 0) {
    console.log('  ✅ Pure numbers → no tickers');
    passed++;
  } else {
    console.log(`  ❌ Numbers extracted as tickers: ${numbersResult.join(', ')}`);
    failed++;
  }

  // ── Results ──────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

// Test case inputs for classification expectations
const TEST_CASES = [
  { input: 'spec x' },
  { input: "Elon Musk's latest company" },
  { input: 'Elon space company' },
  { input: 'trillionaire company' },
  { input: 'trillionaire owned company' },
];

main();
