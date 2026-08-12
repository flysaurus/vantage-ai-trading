// ─── Ticker Resolver Regression Test ───────────────────────────
// Runs the 5 traced examples against the live resolver pipeline.
// Tests the full Tier 0-3 flow with real Finnhub + SearXNG + DeepSeek.
//
// Usage: npx tsx scripts/test-ticker-resolver.ts
// ────────────────────────────────────────────────────────────────

import { resolveTickers } from '../lib/ticker-resolver';

const TEST_CASES = [
  {
    input: 'spec x',
    expected: 'resolve',
    description: 'Misspelled ticker → should resolve to SPCX',
  },
  {
    input: "Elon Musk's latest company",
    expected: 'resolve',
    description: 'Time-sensitive factual → web search → resolve',
  },
  {
    input: 'Elon space company',
    expected: 'resolve',
    description: 'Descriptive reference → web search → resolve',
  },
  {
    input: 'trillionaire company',
    expected: 'clarify',
    description: 'Too broad → should CLARIFY, not auto-resolve',
  },
  {
    input: 'trillionaire owned company',
    expected: 'clarify',
    description: 'Contested estimate → should CLARIFY even with search results',
  },
];

async function main() {
  console.log('═══ Ticker Resolver Regression Test ═══\n');
  console.log(`Testing ${TEST_CASES.length} traced examples against live APIs...\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    console.log(`━━━ Test: "${tc.input}" ━━━`);
    console.log(`  Expected: ${tc.expected} | ${tc.description}`);

    try {
      const result = await resolveTickers(tc.input);

      // Determine actual outcome
      let actual: string;
      if (result.resolved.length === 1 && !result.needsClarification) {
        const r = result.resolved[0];
        actual = `resolve → ${r.symbol} (${r.name}, ${r.confidence} confidence, tier ${r.tier}, source ${r.source})`;
      } else if (result.needsClarification) {
        const opts = result.clarificationOptions?.map(o => `${o.symbol} (${o.name})`).join(', ') || 'none';
        actual = `clarify → options: [${opts}]`;
      } else if (result.notFound.length > 0) {
        actual = `not-found → unresolved: ${result.notFound.join(', ')}`;
      } else if (result.resolved.length > 1) {
        actual = `multi-resolve → ${result.resolved.map(r => r.symbol).join(', ')}`;
      } else {
        actual = 'unknown (no matches, no clarification)';
      }

      // Check if expectation matches
      const isExpected =
        (tc.expected === 'resolve' && result.resolved.length >= 1 && !result.needsClarification) ||
        (tc.expected === 'clarify' && result.needsClarification) ||
        (tc.expected === 'not-found' && result.notFound.length > 0 && result.resolved.length === 0);

      if (isExpected) {
        console.log(`  ✅ PASS: ${actual}`);
        passed++;
      } else {
        console.log(`  ❌ FAIL: expected ${tc.expected}, got ${actual}`);
        console.log(`     Full result: ${JSON.stringify(result, null, 2)}`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  ❌ ERROR: ${err.message}`);
      failed++;
    }

    console.log(''); // blank line between tests
  }

  console.log('═══════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed out of ${TEST_CASES.length}`);
  console.log('═══════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main();
