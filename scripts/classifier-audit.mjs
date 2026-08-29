// ─── Classifier audit reviewer ───────────────────────────────
// Pulls recent classifier_audit rows and prints a mislabel report so routing
// decisions can be eyeballed on a continuing basis (no LLM needed).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/classifier-audit.mjs
//   (or: node scripts/classifier-audit.mjs 200   to change the row limit)
//
// Requires the 067_classifier_audit.sql migration to be applied first.
// ──────────────────────────────────────────────────────────────

const url = process.env.SUPABASE_URL || 'https://ixjnuoslbzytubpplkot.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const limit = Number(process.argv[2]) || 200;

if (!key) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (e.g. from .env.reconcile.local).');
  process.exit(1);
}

const res = await fetch(
  `${url}/rest/v1/classifier_audit?select=*&order=created_at.desc&limit=${limit}`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!res.ok) {
  console.error('HTTP', res.status, await res.text().catch(() => ''));
  process.exit(1);
}
const rows = await res.json();
if (!Array.isArray(rows) || rows.length === 0) {
  console.log('No classifier_audit rows yet (has the migration been applied + the app used?).');
  process.exit(0);
}

// ── Summary by source → category ──
const byCat = {};
for (const r of rows) {
  const k = `${r.source} → ${r.category}`;
  byCat[k] = (byCat[k] || 0) + 1;
}
console.log('=== classification counts (source → category) ===');
for (const [k, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

// ── Heuristic mislabel flags: read-only signals routed to build/trade ──
const READONLY_SIGNALS = /\b(scheduled|pending|open|queued|recurring|my (cash|positions|equity|orders|holdings)|how much|what (are|is|do|am)|waiting|fill|dca)\b/i;
console.log('\n=== potential mislabels (read-only phrasing → non-read-only category) ===');
let flagged = 0;
for (const r of rows) {
  const msg = (r.message || '').trim();
  if (!msg) continue;
  const readOnlyCat = ['account_state', 'scheduled_activity'].includes(r.category);
  const looksReadOnly = READONLY_SIGNALS.test(msg);
  const buildTradeCat = ['portfolio_construction', 'direct_trade_instruction'].includes(r.category);
  if (buildTradeCat && looksReadOnly) {
    flagged++;
    console.log(`  ⚠ [${r.category}] "${msg}"`);
  } else if (r.source === 'fail_open') {
    flagged++;
    console.log(`  ⚠ [fail_open] "${msg}"`);
  }
}
if (flagged === 0) console.log('  (none)');

console.log('\n=== most recent 30 raw rows ===');
for (const r of rows.slice(0, 30)) {
  console.log(`  [${r.source}/${r.category}] ${(r.message || '').slice(0, 80)}`);
}
