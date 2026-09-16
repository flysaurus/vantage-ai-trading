#!/usr/bin/env node
// ⚠️ WRITE-CAPABLE — Part B step 2: backfill public.broker_accounts.
// Upserts one row per SnapTrade sub-account, sourced from the connection's
// `snaptrade_accounts` JSONB array. Idempotent (ON CONFLICT snaptrade_account_id
// DO UPDATE) — safe to re-run. Touches ONLY broker_accounts; no derived table is
// read or written here, and no rows are ever deleted.
//
// Usage:  node scripts/backfill-broker-accounts.mjs [--dry-run]
//
// Design notes:
//   * `is_default` is deliberately NOT set here — default-account selection is a
//     resolution policy owned by the server resolver, not a data fact.
//   * `raw` holds the upstream payload for reference; it is NEVER a balance source
//     (Fidelity's Taxable SMA reports totalValue 0 while its positions are ~$377k).
//   * The JSONB payload carries no account_type/currency for the live accounts, so
//     those stay NULL rather than being guessed.

import fs from 'fs';

const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

function parseAccounts(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const j = JSON.parse(v); return Array.isArray(j) ? j : (j?.data ?? []); } catch { return []; } }
  if (v && typeof v === 'object') return v.data ?? v.accounts ?? [];
  return [];
}

const r = await fetch(`${BASE}/rest/v1/broker_connections?select=id,brokerage_slug,status,snaptrade_accounts`, { headers: H });
if (!r.ok) { console.error('read failed', r.status, await r.text()); process.exit(1); }
const conns = await r.json();

const rows = [];
for (const c of conns) {
  for (const a of parseAccounts(c.snaptrade_accounts)) {
    if (!a?.id) continue;
    rows.push({
      connection_id: c.id,
      snaptrade_account_id: a.id,
      name: a.name ?? null,
      account_type: a.account_type ?? a.type ?? null,
      currency: a.currency ?? null,
      is_default: false,
      status: 'open',
      raw: a,
      updated_at: new Date().toISOString(),
    });
  }
}

console.log(`connections scanned: ${conns.length}  →  sub-account rows to upsert: ${rows.length}`);
for (const x of rows) console.log(`  · ${x.connection_id}  ${x.snaptrade_account_id}  ${x.name}`);
if (DRY) { console.log('\n[dry-run] nothing written.'); process.exit(0); }

const up = await fetch(`${BASE}/rest/v1/broker_accounts?on_conflict=snaptrade_account_id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify(rows),
});
const text = await up.text();
if (!up.ok) { console.error('upsert failed', up.status, text); process.exit(1); }
console.log(`\nupsert ok (${up.status}) — rows returned: ${JSON.parse(text).length}`);
