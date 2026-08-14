// Smoke test for step 6 (order emails) + step 7 (webhook re-scope) wiring.
//
// Verifies, against the DEPLOYED production URL:
//   T1  /api/order-emails/unsubscribe is PUBLIC (not redirected to /login)
//   T2  bad token → 400 (invalid/expired)
//   T3  valid HMAC token → 200 + users.order_emails_enabled flips to false
//       (proves migration 044 is applied AND the HMAC scheme matches prod)
//   T4  /api/cron/sync-orders accepts CRON_SECRET → 200 with counts
//   T5  local HMAC sign/verify round-trip + tamper rejection
//
// No real orders are placed and no real order emails are sent. A throwaway
// user is created for the unsubscribe test and deleted at the end.
//
// Run:  node scripts/smoke-order-emails.mjs

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('/tmp/vantage-prod.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = env.CRON_SECRET;
const SESSION_SECRET = env.SESSION_SECRET || 'vantage-dev-secret';
const PROD = env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

if (!SUPABASE_URL || !SERVICE) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in /tmp/vantage-prod.env');
  process.exit(1);
}

// Replicate digest.ts signUnsubscribeToken (HMAC-SHA256 of "unsub:<userId>").
function signUnsubscribeToken(userId) {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(`unsub:${userId}`);
  return `${userId}.${hmac.digest('hex')}`;
}
function verifyUnsubscribeToken(token) {
  const i = token.lastIndexOf('.');
  if (i === -1) return null;
  const userId = token.slice(0, i);
  const expected = signUnsubscribeToken(userId);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected)) ? userId : null;
  } catch {
    return null;
  }
}

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ── Throwaway user ──
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const email = `smoke-order-${Date.now()}@test.local`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password: 'SmokeTest!2345',
  email_confirm: true,
});
if (createErr) { console.error('createUser failed:', createErr.message); process.exit(1); }
const userId = created.user.id;
const { error: rowErr } = await admin.from('users').insert({ id: userId, email, tier: 'demo' });
if (rowErr) console.warn('users insert failed (non-fatal):', rowErr.message);

// ── T1: unsubscribe route is public ──
const r1 = await fetch(`${PROD}/api/order-emails/unsubscribe`, { redirect: 'manual' });
const r1loc = r1.headers.get('location') || '';
record('T1 unsubscribe public (no /login redirect)', !r1loc.toLowerCase().includes('/login') && r1.status < 400, `status=${r1.status}`);

// ── T2: bad token → 400 ──
const r2 = await fetch(`${PROD}/api/order-emails/unsubscribe?token=garbage`, { redirect: 'manual' });
record('T2 bad token rejected', r2.status === 400, `status=${r2.status}`);

// ── T3: valid token → 200 + flag flips ──
const token = signUnsubscribeToken(userId);
const r3 = await fetch(`${PROD}/api/order-emails/unsubscribe?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
const t3ok = r3.status === 200;
let flagFlipped = false;
if (t3ok) {
  const { data: row } = await admin.from('users').select('order_emails_enabled').eq('id', userId).maybeSingle();
  flagFlipped = row?.order_emails_enabled === false;
}
record('T3 valid token → 200 + flag flips', t3ok && flagFlipped, `status=${r3.status} flagFlipped=${flagFlipped}${!flagFlipped ? ' (migration 044 pending?)' : ''}`);

// ── T4: sync-orders cron accepts CRON_SECRET ──
let cronOk = false, cronDetail = 'no CRON_SECRET';
if (CRON_SECRET) {
  const r4 = await fetch(`${PROD}/api/cron/sync-orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  cronDetail = `status=${r4.status}`;
  if (r4.status === 200) {
    try { const j = await r4.json(); cronDetail += ` body=${JSON.stringify(j)}`; } catch {}
    cronOk = true;
  }
} else {
  cronDetail = 'CRON_SECRET missing from env — skipped';
}
record('T4 sync-orders cron (CRON_SECRET)', cronOk, cronDetail);

// ── T5: local HMAC round-trip + tamper rejection ──
const rt = verifyUnsubscribeToken(signUnsubscribeToken(userId)) === userId;
const tampered = verifyUnsubscribeToken(signUnsubscribeToken(userId) + 'x') === null;
record('T5 HMAC round-trip + tamper', rt && tampered, `roundTrip=${rt} tamperRejected=${tampered}`);

// ── cleanup ──
await admin.auth.admin.deleteUser(userId);
console.log('cleanup done:', userId);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
