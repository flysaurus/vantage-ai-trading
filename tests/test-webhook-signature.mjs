/**
 * Phase 4: SnapTrade Webhook Signature Verification Test
 *
 * Run: node tests/test-webhook-signature.mjs
 */

import crypto from 'crypto';

const CONSUMER_KEY = 'test-consumer-key-for-verification';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

function verifySignature(body, signature) {
  if (!CONSUMER_KEY || !signature) return false;
  try {
    const parsed = JSON.parse(body);
    const canonical = JSON.stringify(parsed, Object.keys(parsed).sort());
    const hmac = crypto.createHmac('sha256', CONSUMER_KEY);
    hmac.update(canonical);
    const expected = hmac.digest('base64');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function isTimestampValid(eventTimestamp) {
  if (!eventTimestamp) return false;
  try {
    const eventTime = new Date(eventTimestamp).getTime();
    if (isNaN(eventTime)) return false;
    return Math.abs(Date.now() - eventTime) < REPLAY_WINDOW_MS;
  } catch {
    return false;
  }
}

function createSignature(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const hmac = crypto.createHmac('sha256', CONSUMER_KEY);
  hmac.update(canonical);
  return hmac.digest('base64');
}

// ─── Tests ───

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('\n🔐 Webhook Signature Verification');

test('valid signature matches', () => {
  const payload = { eventType: 'CONNECTION_BROKEN', userId: 'u123', brokerageAuthorizationId: 'auth-abc' };
  const sig = createSignature(payload);
  assert(verifySignature(JSON.stringify(payload), sig), 'valid sig should verify');
});

test('wrong signature rejects', () => {
  const payload = { eventType: 'CONNECTION_ADDED' };
  assert(!verifySignature(JSON.stringify(payload), 'wrong-signature'));
});

test('null signature rejects', () => {
  assert(!verifySignature('{}', null));
});

test('empty signature rejects', () => {
  assert(!verifySignature('{}', ''));
});

test('different payload fails', () => {
  const p1 = { eventType: 'CONNECTION_BROKEN', userId: 'u1' };
  const p2 = { eventType: 'CONNECTION_BROKEN', userId: 'u2' };
  const sig = createSignature(p1);
  assert(!verifySignature(JSON.stringify(p2), sig), 'different payload should not verify');
});

test('JSON field order independence', () => {
  // Key ordering shouldn't matter because we re-serialize with sorted keys
  const unordered = '{"userId":"u1","eventType":"CONNECTION_BROKEN"}';
  const payload = { eventType: 'CONNECTION_BROKEN', userId: 'u1' };
  const sig = createSignature(payload);
  assert(verifySignature(unordered, sig), 'field order should not affect verification');
});

console.log('\n⏱️  Timestamp Validation');

test('recent timestamp is valid', () => {
  const recent = new Date(Date.now() - 60000).toISOString(); // 1 min ago
  assert(isTimestampValid(recent), '1 min ago should be valid');
});

test('timestamp 4 minutes ago is valid', () => {
  const t = new Date(Date.now() - 4 * 60000).toISOString();
  assert(isTimestampValid(t), '4 min ago should be valid');
});

test('timestamp 10 minutes ago rejects', () => {
  const t = new Date(Date.now() - 10 * 60000).toISOString();
  assert(!isTimestampValid(t), '10 min ago should be rejected');
});

test('future timestamp rejects', () => {
  const t = new Date(Date.now() + 10 * 60000).toISOString();
  assert(!isTimestampValid(t), 'future timestamp should be rejected');
});

test('null timestamp rejects', () => {
  assert(!isTimestampValid(null));
});

test('undefined timestamp rejects', () => {
  assert(!isTimestampValid(undefined));
});

test('invalid timestamp rejects', () => {
  assert(!isTimestampValid('not-a-date'));
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
