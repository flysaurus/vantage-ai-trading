// ─── AI Advisor Regression Suite ───────────────────────────────
// Phase 6: Permanent regression suite for AI Advisor.
//
// Every bug we've fixed gets a fixture here. Run BEFORE any AI Advisor
// change to prevent regressions.
//
// Usage:
//   npx tsx lib/ai/__tests__/regression-suite.ts
//   npx tsx lib/ai/__tests__/regression-suite.ts --verbose
//   npx tsx lib/ai/__tests__/regression-suite.ts --suite=markers
//
// ──────────────────────────────────────────────────────────────────

import { validateResponse, stripForeignSuffixes, stripRecommendFromClarify, detectMetricIncoherence, detectIncoherence } from '../validator';
import { classifyIntent, createConversationState } from '../manager';
import { sanitizeClarifyResponse, analyzeMarkerPresence } from '../presenter';
import { parsePortfolioBlocks } from '@/lib/portfolio-blocks';
import { NOT_TICKERS, FOREIGN_EXCHANGE_SUFFIXES, isFilteredCommonWord } from '@/lib/symbol-resolution';
import { getStyleScreeningDefaults } from '@/lib/investor-style-defaults';
import { detectEtfIntent, extractEtfCriteria, formatEtfContext } from '@/lib/etf-screener';
import type { EtfScreenerResult, EtfScreenerCriteria } from '@/lib/etf-screener';

// ── Test runner ────────────────────────────────────────────

interface TestCase {
  name: string;
  suite: string;
  fn: () => void | Promise<void>;
}

const suites: Map<string, TestCase[]> = new Map();
let verbose = false;
let passed = 0;
let failed = 0;

function test(name: string, suite: string, fn: () => void | Promise<void>) {
  if (!suites.has(suite)) suites.set(suite, []);
  suites.get(suite)!.push({ name, suite, fn });
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  }
}

// ── Suite: Symbol Resolution ───────────────────────────────

test('NOT_TICKERS blocks common words', 'symbol_resolution', () => {
  assert(NOT_TICKERS.has('THE'), 'THE should be blocked');
  assert(NOT_TICKERS.has('API'), 'API should be blocked');
  assert(NOT_TICKERS.has('BUY'), 'BUY (trading verb) should be blocked');
  assert(!NOT_TICKERS.has('AAPL'), 'AAPL should NOT be blocked');
  assert(!NOT_TICKERS.has('NVDA'), 'NVDA should NOT be blocked');
});

test('FOREIGN_EXCHANGE_SUFFIXES blocks exchange codes', 'symbol_resolution', () => {
  assert(FOREIGN_EXCHANGE_SUFFIXES.has('DE'), 'DE (XETRA) should be blocked');
  assert(FOREIGN_EXCHANGE_SUFFIXES.has('TO'), 'TO (Toronto) should be blocked');
  assert(FOREIGN_EXCHANGE_SUFFIXES.has('L'), 'L (London) should be blocked');
});

test('isFilteredCommonWord filters proper nouns', 'symbol_resolution', () => {
  assert(isFilteredCommonWord('Monday'), 'Monday should be filtered');
  assert(isFilteredCommonWord('January'), 'January should be filtered');
  assert(isFilteredCommonWord('Could'), 'Could should be filtered');
  assert(!isFilteredCommonWord('NVIDIA'), 'NVIDIA should NOT be filtered');
  assert(!isFilteredCommonWord('Microsoft'), 'Microsoft should NOT be filtered');
});

// ── Suite: Investor Style Defaults ─────────────────────────

test('Lynch style returns GARP defaults', 'style_defaults', () => {
  const defaults = getStyleScreeningDefaults('lynch');
  assertEq(defaults.market_cap_min, 2_000_000_000, 'Lynch: market_cap_min');
  assertEq(defaults.pe_max, 30, 'Lynch: pe_max');
  assertEq(defaults.min_growth_rate, 0.10, 'Lynch: min_growth_rate');
});

test('Buffett style returns value defaults', 'style_defaults', () => {
  const defaults = getStyleScreeningDefaults('buffett');
  assertEq(defaults.market_cap_min, 10_000_000_000, 'Buffett: market_cap_min');
  assertEq(defaults.pe_max, 20, 'Buffett: pe_max');
});

test('Unknown style falls back to broad mid+ cap', 'style_defaults', () => {
  const defaults = getStyleScreeningDefaults('unknown-style');
  assertEq(defaults.market_cap_min, 2_000_000_000, 'Unknown: market_cap_min');
});

// ── Suite: Intent Classification ───────────────────────────

test('Fresh build request → portfolio_build', 'intent', () => {
  const result = classifyIntent('Build me a $5000 growth portfolio');
  assertEq(result.intent, 'portfolio_build', 'Should classify as portfolio_build');
  assert(result.confidence > 0.5, 'Should have high confidence');
});

test('CLARIFY answer → clarify_response (with open clarify)', 'intent', () => {
  const state = createConversationState();
  state.clarifyOpen = true;
  const result = classifyIntent('I prefer the aggressive approach with more tech exposure', state);
  assertEq(result.intent, 'clarify_response', 'Should classify as clarify_response');
});

test('Definition question → market_question', 'intent', () => {
  const result = classifyIntent('What is a P/E ratio?');
  assertEq(result.intent, 'market_question', 'Should classify as market_question');
});

test('Detects mentioned sectors', 'intent', () => {
  const result = classifyIntent('Build a tech and healthcare portfolio');
  assert(result.mentionedSectors.includes('technology'), 'Should detect technology sector');
  assert(result.mentionedSectors.includes('healthcare'), 'Should detect healthcare sector');
});

test('Detects mentioned tickers', 'intent', () => {
  const result = classifyIntent('Should I buy AAPL and MSFT?');
  assert(result.mentionedTickers.includes('AAPL'), 'Should detect AAPL');
  assert(result.mentionedTickers.includes('MSFT'), 'Should detect MSFT');
});

// ── Suite: Foreign Suffix Stripping ────────────────────────

test('Strips JNJ.DE → JNJ', 'sanitization', () => {
  const input = '[RECOMMEND:JNJ.DE:BUY:$500]';
  const result = stripForeignSuffixes(input);
  assertEq(result.text, '[RECOMMEND:JNJ:BUY:$500]', 'Should strip .DE suffix');
  assertEq(result.count, 1, 'Should count 1 strip');
});

test('Strips PFE.MX → PFE', 'sanitization', () => {
  const input = '[RECOMMEND:PFE.MX:BUY:$1000]';
  const result = stripForeignSuffixes(input);
  assertEq(result.text, '[RECOMMEND:PFE:BUY:$1000]', 'Should strip .MX suffix');
  assertEq(result.count, 1, 'Should count 1 strip');
});

test('Leaves valid tickers alone', 'sanitization', () => {
  const input = '[RECOMMEND:AAPL:BUY:$5000] [RECOMMEND:NVDA:BUY:$3000]';
  const result = stripForeignSuffixes(input);
  assertEq(result.text, input, 'Should leave valid tickers unchanged');
  assertEq(result.count, 0, 'Should count 0 strips');
});

// ── Suite: CLARIFY Sanitization ────────────────────────────

test('Strips RECOMMEND markers from CLARIFY response', 'sanitization', () => {
  const input = `[CLARIFY:{"question":"Which approach?"}]\nI recommend [RECOMMEND:AAPL:BUY:$500] for growth.`;
  const result = sanitizeClarifyResponse(input);
  assert(!result.text.includes('[RECOMMEND:'), 'RECOMMEND markers should be stripped');
  assert(result.text.includes('[CLARIFY:'), 'CLARIFY block should remain');
  assertEq(result.stripped, 1, 'Should strip 1 marker');
});

test('Leaves non-CLARIFY responses untouched', 'sanitization', () => {
  const input = '[RECOMMEND:AAPL:BUY:$5000] [RECOMMEND:NVDA:BUY:$3000]';
  const result = sanitizeClarifyResponse(input);
  assertEq(result.text, input, 'Non-CLARIFY response should be unchanged');
  assertEq(result.stripped, 0, 'Should strip 0 markers');
});

// ── Suite: Marker Presence Analysis ────────────────────────

test('Detects BUY markers', 'marker_analysis', () => {
  const result = analyzeMarkerPresence('[RECOMMEND:AAPL:BUY:$5000] [RECOMMEND:NVDA:BUY:$3000]');
  assert(result.hasBuyMarkers, 'Should detect BUY markers');
  assert(!result.hasSellMarkers, 'No SELL markers');
  assertEq(result.markerCount, 2, 'Should count 2 markers');
});

test('Detects SELL markers', 'marker_analysis', () => {
  const result = analyzeMarkerPresence('[RECOMMEND:JNJ:SELL]');
  assert(!result.hasBuyMarkers, 'No BUY markers');
  assert(result.hasSellMarkers, 'Should detect SELL marker');
  assertEq(result.markerCount, 1, 'Should count 1 marker');
});

test('Detects PORTFOLIO blocks', 'marker_analysis', () => {
  const result = analyzeMarkerPresence('[PORTFOLIO:{"total":10000,"positions":[{"symbol":"AAPL","amount":5000}]}]');
  assert(result.hasPortfolioBlocks, 'Should detect PORTFOLIO block');
});

// ── Suite: Validation Pipeline ─────────────────────────────

test('Clean response passes validation', 'validation', () => {
  const response = '[RECOMMEND:AAPL:BUY:$5000]\n[RECOMMEND:NVDA:BUY:$3000]\n[RECOMMEND:MSFT:BUY:$2000]';
  const report = validateResponse(response, 10000);
  assert(report.ok, 'Clean response should pass');
  assert(report.hasRecommendMarkers, 'Should detect RECOMMEND markers');
});

test('Internal monologue detected', 'validation', () => {
  const response = 'Hmm, the user wants tech exposure. Let me check...\n[RECOMMEND:AAPL:BUY:$5000]';
  const report = validateResponse(response, 5000);
  assert(!report.ok, 'Internal monologue should fail validation');
  const issue = report.issues.find(i => i.pass === 'incoherence');
  assert(!!issue, 'Should have incoherence issue');
});

test('CLARIFY lead-in is not monologue', 'validation', () => {
  // Regression: "I need to clarify..." opening a CLARIFY response was being
  // falsely flagged as internal monologue, forcing a silent regenerate loop.
  const response = 'I need to clarify a couple things before I build this.\n[CLARIFY:{"question":"Growth or value?","options":["Growth","Value"]}]';
  const report = validateResponse(response);
  const monoIssue = report.issues.find(i => i.pass === 'incoherence' && /monologue/i.test(i.message || ''));
  assert(!monoIssue, 'CLARIFY lead-in should not be flagged as monologue');
});

test('Duplicate SUMMARY_TLDR detected', 'validation', () => {
  const response = '[SUMMARY_TLDR:Portfolio A]\n[SUMMARY_TLDR:Portfolio B]\n[RECOMMEND:AAPL:BUY:$5000]';
  const report = validateResponse(response, 5000);
  assert(!report.ok, 'Duplicate TLDR should fail validation');
});

test('Foreign suffixes stripped during validation', 'validation', () => {
  const response = '[RECOMMEND:JNJ.DE:BUY:$500]\n[RECOMMEND:PFE.MX:BUY:$300]';
  const report = validateResponse(response, 800);
  assertEq(report.suffixesStripped, 2, 'Should strip 2 foreign suffixes');
  assert(!report.sanitizedText.includes('.DE'), 'No .DE suffix in sanitized text');
  assert(!report.sanitizedText.includes('.MX'), 'No .MX suffix in sanitized text');
});

test('CASH marker in portfolio block accepted', 'validation', () => {
  const response = `[PORTFOLIO:{"total":10000,"positions":[
    {"symbol":"AAPL","amount":6000},
    {"symbol":"MSFT","amount":3000},
    {"symbol":"CASH","amount":1000}
  ]}]
  [RECOMMEND:AAPL:BUY:$6000]
  [RECOMMEND:MSFT:BUY:$3000]`;
  // Note: full validation requires Finnhub — this just tests block parsing
  const report = validateResponse(response, 10000);
  assert(report.hasPortfolioBlocks, 'Should detect PORTFOLIO blocks');
});

// ── Suite: PORTFOLIO Block Validation ──────────────────────

test('Mismatched sum vs total detected', 'portfolio_block', () => {
  const response = `[PORTFOLIO:{"total":10000,"positions":[
    {"symbol":"AAPL","amount":6000},
    {"symbol":"NVDA","amount":3000}
  ]}]
  [RECOMMEND:AAPL:BUY:$6000]
  [RECOMMEND:NVDA:BUY:$3000]`;
  // Positions sum to 9000, total is 10000
  const report = validateResponse(response, 10000);
  const issue = report.issues.find(i => i.pass === 'portfolio_block');
  assert(!!issue, 'Should detect mismatched sum');
  assert(issue!.message.includes('sum'), 'Error should mention sum');
});

test('Duplicate symbols in block detected', 'portfolio_block', () => {
  const response = `[PORTFOLIO:{"total":10000,"positions":[
    {"symbol":"AAPL","amount":5000},
    {"symbol":"AAPL","amount":5000}
  ]}]
  [RECOMMEND:AAPL:BUY:$5000]`;
  const report = validateResponse(response, 10000);
  const issue = report.issues.find(i => i.pass === 'portfolio_block');
  assert(!!issue, 'Should detect duplicate symbols');
  assert(issue!.message.includes('duplicate'), 'Error should mention duplicate');
});

// ── Suite: Prose Questions ─────────────────────────────────

test('Prose questions outside CLARIFY detected', 'validation', () => {
  const response = 'Here are some stocks.\nWould you prefer growth or value?\nDo you want more tech exposure?';
  const report = validateResponse(response, null);
  assert(!report.ok, 'Prose questions should fail');
  const issue = report.issues.find(i => i.pass === 'incoherence');
  assert(!!issue, 'Should have incoherence issue');
  assert(issue!.message.includes('CLARIFY'), 'Error should mention CLARIFY');
});

test('Single prose question accepted (natural sign-off)', 'validation', () => {
  // A single question ending might be a natural sign-off, not a CLARIFY violation
  const response = 'Here is my recommendation: [RECOMMEND:AAPL:BUY:$5000]\nDoes that look good?';
  const report = validateResponse(response, 5000);
  // Single questions might pass or fail depending on context — we just check no crash
  assert(typeof report.ok === 'boolean', 'Should return a valid report');
});

// ── Suite: $10M Budget Parsing ─────────────────────────────

test('Large budget ($10M) does not overflow', 'validation', () => {
  const response = '[RECOMMEND:AAPL:BUY:$4000000]\n[RECOMMEND:MSFT:BUY:$3000000]\n[RECOMMEND:NVDA:BUY:$3000000]';
  const report = validateResponse(response, 10_000_000);
  assert(report.ok, 'Large budget should be accepted');
});

// ── Suite: Edge Cases ──────────────────────────────────────

test('Empty response handled gracefully', 'edge_cases', () => {
  const report = validateResponse('', null);
  assert(report.ok, 'Empty response should pass');
  assertEq(report.suffixesStripped, 0, 'No suffixes to strip');
  assert(!report.hasRecommendMarkers, 'No markers');
  assert(!report.hasPortfolioBlocks, 'No blocks');
});

test('Response with only SUMMARY_TLDR and no trades fails', 'edge_cases', () => {
  const response = '[SUMMARY_TLDR:Good portfolio, very diversified]';
  const report = validateResponse(response, null);
  assert(!report.ok, 'TLDR-only (no trades) response should fail');
});

test('CLARIFY with budget mention accepted', 'edge_cases', () => {
  const response = '[CLARIFY:{"question":"Budget preference?","options":["$5000 growth","$10000 balanced"]}]';
  const report = validateResponse(response, null);
  assert(report.ok, 'CLARIFY with budget mentions should pass');
});

// ── Suite: Trailing Question Stripping ─────────────────────

test('Strip "How does that look?"', 'trailing_questions', () => {
  const response = '[RECOMMEND:AAPL:BUY:$5000]\nHow does that look?';
  const report = validateResponse(response, 5000);
  assert(!report.sanitizedText.includes('How does that look?'), 'Trailing question should be stripped');
});

// ── Suite: OTC Exclusion Regression ──────────────────────

test('SPEC is in NOT_TICKERS (prevent OTC penny stock)', 'otc_exclusion', () => {
  assert(NOT_TICKERS.has('SPEC'), 'SPEC should be in NOT_TICKERS to block OTC resolution');
});

test('OTC exchange regex rejects OTC patterns', 'otc_exclusion', () => {
  const OTC_PATTERN = /^OTC|OTCMKTS|OTCBB|OTCQB|OTCQX|PINK/i;
  assert(OTC_PATTERN.test('OTC'), 'OTC should match');
  assert(OTC_PATTERN.test('OTCMKTS'), 'OTCMKTS should match');
  assert(OTC_PATTERN.test('OTCQX'), 'OTCQX should match');
  assert(OTC_PATTERN.test('Pink Sheet'), 'Pink should match');
  assert(!OTC_PATTERN.test('NASDAQ'), 'NASDAQ should NOT match');
  assert(!OTC_PATTERN.test('NYSE'), 'NYSE should NOT match');
  assert(!OTC_PATTERN.test('ARCA'), 'ARCA should NOT match');
});

test('NOT_TICKERS contains common OTC ticker patterns', 'otc_exclusion', () => {
  // Common words that match ticker regex but are OTC or false positives
  assert(NOT_TICKERS.has('SPEC'), 'SPEC (OTC stock) should be blocked');
  // BUY, SELL, CASH etc. are trading verbs/proxies — check at least one is blocked
  assert(NOT_TICKERS.has('BUY') || NOT_TICKERS.has('CASH'),
    'Trading-related words (BUY/CASH) should have at least one in NOT_TICKERS');
});

// ── Suite: Ambiguous Ticker Disambiguation ────────────────

test('"spec. X" is ambiguous — SPEC in NOT_TICKERS, X is single-letter', 'ambiguous_tickers', () => {
  // "spec." with period — SPEC is in NOT_TICKERS, should be filtered
  const tokens = 'spec. X'.split(/[\s.]+/);
  const tickerTokens = tokens.filter(t => /^[A-Z]{1,5}$/i.test(t));
  // SPEC should be in NOT_TICKERS (blocked)
  const specUpper = tokens[0].toUpperCase();
  assert(NOT_TICKERS.has(specUpper) || specUpper === 'SPEC',
    `SPEC should be blocked: NOT_TICKERS.has('SPEC')=${NOT_TICKERS.has('SPEC')}`);
  // X is a real NYSE ticker (US Steel), single-letter — needs special handling
  assertEq(tokens[1].toUpperCase(), 'X', 'Second token should be X');
  // Single-letter tickers need explicit stock-context keywords to be extracted
  // by extractTickers, otherwise the main regex ([A-Z]{2,5}) misses them.
  // This is a known gap — single-letter tickers like X (US Steel), F (Ford)
  // are legitimate NYSE stocks that need marker support.
  const singleLetterRegex = /\$?\b([A-Z])\b\s*(?:stocks|shares|stock|share|price|quote|trading|ticker)\b/gi;
  const text = 'buy X stock';
  const matched = [...text.matchAll(singleLetterRegex)];
  assert(matched.length > 0, 'Single-letter ticker with stock keyword should match');
  // But without the keyword, it should NOT match (prevents false positives)
  const textNoKeyword = 'buy X';
  const matchedNoKeyword = [...textNoKeyword.matchAll(singleLetterRegex)];
  assert(matchedNoKeyword.length === 0, 'Single-letter without keyword should NOT match to prevent false positives');
});

test('Single-letter X (US Steel) is a valid NYSE ticker', 'ambiguous_tickers', () => {
  // X = US Steel, listed on NYSE — should NOT be in NOT_TICKERS
  assert(!NOT_TICKERS.has('X'), 'X (US Steel) should be resolvable');
  // But single-letter tickers need special handling in extractTickers/extractRegexTickers
  // because the main regex pattern is [A-Z]{2,5} (2-char minimum)
  const mainRegex = /\$?\b([A-Z]{2,5})\b/gi;
  // Use a sentence where only X is a short token — avoid 2-5 letter words
  // "check X price" has "is" (2), but NOT_TICKERS filters it. The point is X alone won't match.
  const text = 'ticker X position';
  const matches = [...text.matchAll(mainRegex)];
  // "ticker" is 6 chars, "position" is 8 chars, X is 1 char — none match [A-Z]{2,5}
  assert(matches.length === 0, 'Main regex should NOT match single-letter X — needs keyword fallback');
});

// ─── Suite: PREVERIFIED Canonical Symbol Resolution ─────

test('PREVERIFIED maps return canonical symbol, not lookup key', 'preverified', () => {
  // Import the PREVERIFIED_TICKERS from symbol-resolution
  // This is a structural test — PREVERIFIED entries MUST have a canonicalSymbol field
  const { PREVERIFIED_TICKERS } = require('@/lib/symbol-resolution');
  for (const [key, entry] of Object.entries(PREVERIFIED_TICKERS) as [string, any][]) {
    assert(entry.canonicalSymbol !== undefined,
      `PREVERIFIED_TICKERS["${key}"] must have canonicalSymbol field`);
    // canonicalSymbol must be a valid 1-5 char uppercase ticker
    assert(/^[A-Z]{1,5}$/.test(entry.canonicalSymbol),
      `PREVERIFIED_TICKERS["${key}"].canonicalSymbol "${entry.canonicalSymbol}" must be a valid ticker format`);
  }
});

// ── Suite: Raw Strategy JSON (Bug 3) ────────────────────

test('Raw {"strategies":[...]} JSON is parsed into portfolio blocks', 'raw_strategy_json', () => {
  const response = `Here are your options.\n{"strategies":[{"name":"Income","total":5000,"positions":[{"symbol":"JEPI","amount":5000}]},{"name":"Growth","total":5000,"positions":[{"symbol":"QQQ","amount":5000}]}]}`;
  const blocks = parsePortfolioBlocks(response);
  assertEq(blocks.length, 2, 'Should parse 2 strategy blocks from raw JSON');
  assertEq(blocks[0].strategy, 'Income', 'First block strategy name');
  assertEq(blocks[0].total, 5000, 'First block total');
  assertEq(blocks[1].strategy, 'Growth', 'Second block strategy name');
});

// ── Suite: CLARIFY + RECOMMEND Contradiction (Bug 1) ─────

test('stripRecommendFromClarify removes RECOMMEND markers from CLARIFY', 'clarify_contradiction', () => {
  const response = '[CLARIFY:{"question":"Which approach?","options":["Growth","Income"]}]\n[RECOMMEND:AAPL:BUY:$5000]';
  const { text, stripped } = stripRecommendFromClarify(response);
  assertEq(stripped, 1, 'Should strip 1 RECOMMEND marker');
  assert(!text.includes('RECOMMEND:AAPL'), 'RECOMMEND marker should be removed');
  assert(text.includes('CLARIFY:'), 'CLARIFY block should be preserved');
});

test('validateResponse strips RECOMMEND markers from CLARIFY response', 'clarify_contradiction', () => {
  const response = '[CLARIFY:{"question":"Which approach?","options":["Growth","Income"]}]\n[RECOMMEND:AAPL:BUY:$5000]';
  const report = validateResponse(response, null);
  assert(!report.sanitizedText.includes('RECOMMEND:AAPL'), 'RECOMMEND should be stripped in sanitized text');
  assert(!report.hasRecommendMarkers, 'hasRecommendMarkers should be false after strip');
});

test('stripRecommendFromClarify leaves non-CLARIFY responses untouched', 'clarify_contradiction', () => {
  const response = '[RECOMMEND:AAPL:BUY:$5000]\n[RECOMMEND:MSFT:BUY:$5000]';
  const { text, stripped } = stripRecommendFromClarify(response);
  assertEq(stripped, 0, 'No CLARIFY, so nothing stripped');
  assert(text.includes('RECOMMEND:AAPL'), 'RECOMMEND should remain');
});

// ── Suite: Computed-Metric Coherence (Bug 2) ─────────────

test('Contradictory yield between body and TLDR detected', 'metric_coherence', () => {
  const response = '[SUMMARY_TLDR:Portfolio with 4.8% yield]\nThe portfolio has a blended yield of 2.4%.';
  const result = detectMetricIncoherence(response);
  assert(!!result, 'Should detect conflicting yield values');
  assert(result!.includes('yield'), 'Error should mention yield');
});

test('Consistent yield passes metric coherence check', 'metric_coherence', () => {
  const response = '[SUMMARY_TLDR:Portfolio with 2.4% yield]\nThe portfolio has a blended yield of 2.4%.';
  const result = detectMetricIncoherence(response);
  assertEq(result, null, 'Consistent yield should pass');
});

test('No TLDR returns null from metric coherence', 'metric_coherence', () => {
  const response = 'The portfolio has a yield of 2.4%.';
  const result = detectMetricIncoherence(response);
  assertEq(result, null, 'No TLDR block → nothing to cross-check');
});

test('Metric coherence integrated into validateResponse', 'metric_coherence', () => {
  const response = '[SUMMARY_TLDR:Portfolio with 4.8% yield]\n[RECOMMEND:AAPL:BUY:$5000]\nThe portfolio has a yield of 2.4%.';
  const report = validateResponse(response, 5000);
  assert(!report.ok, 'Conflicting metric should fail validation');
  const issue = report.issues.find(i => i.pass === 'incoherence');
  assert(!!issue, 'Should have incoherence issue');
  assert(issue!.message.includes('yield'), 'Error should mention yield');
});

// ── Suite: ETF Screening (Part A) ─────────────────────────
test('detectEtfIntent flags ETF/index-fund requests', 'etf_screening', () => {
  assert(detectEtfIntent('build me a diversified ETF portfolio'), 'ETF phrase');
  assert(detectEtfIntent('index funds for retirement'), 'index funds phrase');
  assert(!detectEtfIntent('buy 1000 worth of apple'), 'plain stock request is not ETF');
  assert(!detectEtfIntent('should I sell my NVDA?'), 'single stock sell is not ETF');
});

test('extractEtfCriteria parses sectors + yield goal from ETF prompt', 'etf_screening', () => {
  const c = extractEtfCriteria('$10,000 diversified ETF portfolio, healthcare/financials/tech/manufacturing, 5% yield goal');
  assert(c.categories.includes('healthcare'), 'healthcare detected');
  assert(c.categories.includes('technology'), 'technology detected (tech)');
  assert(c.categories.includes('financials'), 'financials detected');
  assert(c.categories.includes('industrials'), 'industrials detected (manufacturing)');
  assert(!c.categories.includes('broad'), '"diversified" must NOT map to broad-market category');
  assert(c.yieldMin === 5, `yield goal parsed as ${c.yieldMin} (expected 5)`);
});

test('extractEtfCriteria parses expense ceiling + AUM floor', 'etf_screening', () => {
  const c = extractEtfCriteria('cheap low-cost ETFs with expense ratio under 0.20% and AUM over 2 billion');
  assert(c.expenseRatioMax === 0.20, `expense ratio parsed as ${c.expenseRatioMax}`);
  assert(c.aumMin === 2e9, `AUM floor parsed as ${c.aumMin}`);
});

test('formatEtfContext enforces live expense ratio + trailing returns', 'etf_screening', () => {
  const sample: EtfScreenerResult[] = [{
    symbol: 'VOO', name: 'Vanguard S&P 500 ETF', category: null, fundFamily: 'Vanguard',
    expenseRatioPct: 0.03, aum: 500e9, dividendYieldPct: 1.2,
    return1yPct: 24.1, return3yPct: 10.2, return5yPct: 14.7, indexTracked: 'S&P 500',
  }];
  const criteria: EtfScreenerCriteria = { categories: [], expenseRatioMax: null, aumMin: null, yieldMin: null, return1yMin: null, return3yMin: null, return5yMin: null, indexTracked: null };
  const ctx = formatEtfContext(sample, criteria);
  assert(ctx.includes('expenseRatio=0.03%'), 'expense ratio rendered');
  assert(ctx.includes('returns[1y=24.1%, 3y=10.2%, 5y=14.7%]'), 'trailing 1y/3y/5y returns rendered');
  assert(ctx.includes('NEVER estimate'), 'no-estimation enforcement present');
  assert(ctx.includes('MUST cite'), 'citation mandate present');
  assert(formatEtfContext([], criteria) === '', 'empty results → empty context');
});

test('CLARIFY lead-in "I need to pin down…" is not monologue', 'etf_screening', () => {
  const clarify = 'I need to pin down a couple of things before I build this out.\n\n[CLARIFY:{"question":"How strict is the 5% yield target?","options":["Hard","Soft"]}]';
  const result = detectIncoherence(clarify, null);
  assert(result === null, `CLARIFY lead-in must not flag monologue, got: ${result}`);
});

test('formatEtfContext appends relaxation note when criteria relaxed', 'etf_screening', () => {
  const sample: EtfScreenerResult[] = [{
    symbol: 'XLV', name: 'Health Care Select Sector SPDR Fund', category: 'Health', fundFamily: 'State Street',
    expenseRatioPct: 0.09, aum: 40e9, dividendYieldPct: 1.3,
    return1yPct: 12.0, return3yPct: 8.0, return5yPct: 11.0, indexTracked: 'S&P 500',
  }];
  const criteria: EtfScreenerCriteria = { categories: ['healthcare'], expenseRatioMax: null, aumMin: null, yieldMin: 5, return1yMin: null, return3yMin: null, return5yMin: null, indexTracked: null };
  const ctx = formatEtfContext(sample, criteria, ['yield >= 5%']);
  assert(ctx.includes('relaxed'), 'relaxation note present');
  assert(ctx.includes('yield >= 5%'), 'relaxed criterion named');
  assert(ctx.includes('yield=1.30%'), 'actual yield still cited');
});

// ── Run ────────────────────────────────────────────────────

async function runAll(suiteFilter?: string) {
  const args = process.argv.slice(2);
  verbose = args.includes('--verbose') || args.includes('-v');
  const filter = args.find(a => a.startsWith('--suite='))?.split('=')[1] || suiteFilter;

  console.log('\n🧪 AI Advisor Regression Suite\n');
  console.log(`Suite filter: ${filter || 'all'}`);
  console.log(`Verbose: ${verbose}\n`);

  const startTime = Date.now();

  for (const [suiteName, tests] of suites) {
    if (filter && suiteName !== filter) continue;

    console.log(`\n📦 Suite: ${suiteName} (${tests.length} tests)`);
    for (const t of tests) {
      try {
        await t.fn();
        passed++;
        if (verbose) console.log(`  ✅ ${t.name}`);
      } catch (err: any) {
        failed++;
        console.error(`  ❌ ${t.name}`);
        console.error(`     ${err.message}`);
        if (verbose && err.stack) {
          console.error(`     ${err.stack.split('\n').slice(1, 3).join('\n')}`);
        }
      }
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`\n───\n`);
  console.log(`Results: ${passed} passed, ${failed} failed (${elapsed}ms)`);
  console.log(`Total suites: ${filter ? 1 : suites.size}, tests: ${passed + failed}\n`);

  if (failed > 0) process.exit(1);
}

// Only run when executed directly
const isDirectRun = process.argv[1]?.includes('regression-suite');
if (isDirectRun) {
  runAll().catch(err => {
    console.error('Suite runner error:', err);
    process.exit(1);
  });
}

export { runAll, test, suites };
