/**
 * Phase 3: Order Status Mapping — Standalone Verification
 *
 * Tests the SnapTrade status → OrderStatus mapping function.
 * Run: node tests/test-order-status-mapping.mjs
 */

// ─── Replicated logic (mirrors _mapSnapTradeStatusToOrderStatus in snaptrade-broker.ts) ───

function mapSnapTradeStatus(rawStatus) {
  if (!rawStatus) return 'OPEN';
  const s = rawStatus.toUpperCase();
  if (['EXECUTED', 'FILLED'].includes(s)) return 'FILLED';
  if (['PENDING', 'ACCEPTED', 'QUEUED', 'TRIGGERED', 'ACTIVATED', 'CONTINGENT_ORDER', 'REPLACE_PENDING'].includes(s)) return 'OPEN';
  if (s === 'PARTIAL') return 'PARTIALLY_FILLED';
  if (['CANCELED', 'PARTIAL_CANCELED', 'CANCEL_PENDING'].includes(s)) return 'CANCELLED';
  if (['REJECTED', 'FAILED'].includes(s)) return 'REJECTED';
  if (s === 'EXPIRED') return 'CANCELLED';
  return 'OPEN';
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

function assert(condition, msg) { if (!condition) throw new Error(msg || 'assertion failed'); }

console.log('\n📊 Status Mapping: SnapTrade → Internal OrderStatus');

// Filled
test('EXECUTED → FILLED', () => assert(mapSnapTradeStatus('EXECUTED') === 'FILLED'));
test('FILLED → FILLED', () => assert(mapSnapTradeStatus('FILLED') === 'FILLED'));

// Open
test('PENDING → OPEN', () => assert(mapSnapTradeStatus('PENDING') === 'OPEN'));
test('ACCEPTED → OPEN', () => assert(mapSnapTradeStatus('ACCEPTED') === 'OPEN'));
test('QUEUED → OPEN', () => assert(mapSnapTradeStatus('QUEUED') === 'OPEN'));
test('TRIGGERED → OPEN', () => assert(mapSnapTradeStatus('TRIGGERED') === 'OPEN'));
test('ACTIVATED → OPEN', () => assert(mapSnapTradeStatus('ACTIVATED') === 'OPEN'));
test('CONTINGENT_ORDER → OPEN', () => assert(mapSnapTradeStatus('CONTINGENT_ORDER') === 'OPEN'));

// Partially Filled
test('PARTIAL → PARTIALLY_FILLED', () => assert(mapSnapTradeStatus('PARTIAL') === 'PARTIALLY_FILLED'));

// Cancelled
test('CANCELED → CANCELLED', () => assert(mapSnapTradeStatus('CANCELED') === 'CANCELLED'));
test('PARTIAL_CANCELED → CANCELLED', () => assert(mapSnapTradeStatus('PARTIAL_CANCELED') === 'CANCELLED'));
test('CANCEL_PENDING → CANCELLED', () => assert(mapSnapTradeStatus('CANCEL_PENDING') === 'CANCELLED'));
test('EXPIRED → CANCELLED', () => assert(mapSnapTradeStatus('EXPIRED') === 'CANCELLED'));

// Rejected
test('REJECTED → REJECTED', () => assert(mapSnapTradeStatus('REJECTED') === 'REJECTED'));
test('FAILED → REJECTED', () => assert(mapSnapTradeStatus('FAILED') === 'REJECTED'));

// Edge cases
test('null → OPEN', () => assert(mapSnapTradeStatus(null) === 'OPEN'));
test('undefined → OPEN', () => assert(mapSnapTradeStatus(undefined) === 'OPEN'));
test('empty string → OPEN', () => assert(mapSnapTradeStatus('') === 'OPEN'));
test('unknown → OPEN (safe fallback)', () => assert(mapSnapTradeStatus('UNKNOWN_WEIRD_STATUS') === 'OPEN'));
test('lowercase handled', () => assert(mapSnapTradeStatus('executed') === 'FILLED'));
test('mixed case handled', () => assert(mapSnapTradeStatus('Canceled') === 'CANCELLED'));

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
