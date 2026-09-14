// ⚠️⚠️ PRODUCTION-WRITE SCRIPT — FLAGGED ⚠️⚠️
// Writes to production `public.position_lots` (INSERT). Reconcile-driven backfill.
//
// WHAT: TLT / XLK / XLP hold positions synced from the broker but have ZERO rows
// in the FIFO `position_lots` ledger (verified: lotRows=0 for all three, so the
// shortfall is the full broker qty). This completes the ledger so future sells
// track a real cost basis, exactly per the migration-062 pattern
// (`origin_tag='broker_reconciliation'`, reconP = broker avg_cost when nothing
// is tracked).
//
// SAFETY:
//   • Idempotent  — NOT EXISTS guard on (user_id, account_id, ticker, origin_tag).
//   • Zero-drift  — price_at_fill = broker avg_cost, so the position's
//                   weighted-average cost is unchanged to 1e-6.
//   • Additive    — inserts only; no update/delete/truncate. No broker calls.
//   • Verifies    — re-reads and recomputes weighted avg after the write.
//
// Run: node --env-file=.env.reconcile.local qa-agent/fix-lots-tlt-xlk-xlp.mjs
//        [--apply]     (without --apply it is a dry run: prints the rows only)
import { createClient } from '@supabase/supabase-js';

const USER_ID = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONN = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const APPLY = process.argv.includes('--apply');

const ROWS = [
  { ticker: 'TLT', qty: 9.789607866, price: 82.372043 },
  { ticker: 'XLK', qty: 82.079463419, price: 186.277534 },
  { ticker: 'XLP', qty: 239.642706131, price: 85.068644 },
];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log(APPLY ? '⚠️  MODE: APPLY (writing to production)' : 'MODE: dry run (no writes) — pass --apply to write');

for (const r of ROWS) {
  const { data: existing } = await sb
    .from('position_lots')
    .select('id,remaining_qty,price_at_fill,origin_tag')
    .eq('user_id', USER_ID).eq('account_id', CONN).eq('ticker', r.ticker);

  if ((existing || []).length > 0) {
    console.log(`SKIP ${r.ticker} — ${existing.length} lot row(s) already exist`);
    continue;
  }
  if (!APPLY) { console.log(`WOULD INSERT ${r.ticker} qty=${r.qty} @ ${r.price}`); continue; }

  const { error } = await sb.from('position_lots').insert({
    user_id: USER_ID,
    account_id: CONN,
    ticker: r.ticker,
    qty: r.qty,
    remaining_qty: r.qty,
    price_at_fill: r.price,
    filled_at: new Date().toISOString(),
    source: 'snaptrade',
    order_id: null,
    origin_tag: 'broker_reconciliation',
  });
  console.log(error ? `FAIL ${r.ticker}: ${error.message}` : `INSERTED ${r.ticker} qty=${r.qty} @ ${r.price}`);
}

// ── Post-write verification: weighted avg (open lots) must equal broker avg_cost
console.log('\n── verification ──');
for (const r of ROWS) {
  const { data: lots } = await sb
    .from('position_lots')
    .select('remaining_qty,price_at_fill')
    .eq('user_id', USER_ID).eq('account_id', CONN).eq('ticker', r.ticker);
  const open = (lots || []).filter((l) => Number(l.remaining_qty) > 0);
  const qty = open.reduce((s, l) => s + Number(l.remaining_qty), 0);
  const cost = open.reduce((s, l) => s + Number(l.remaining_qty) * Number(l.price_at_fill), 0);
  const avg = qty > 0 ? cost / qty : null;
  const ok = Math.abs(qty - r.qty) < 1e-6 && avg !== null && Math.abs(avg - r.price) < 1e-6;
  console.log(`${r.ticker}: lotsOpenQty=${qty.toFixed(9)} (broker ${r.qty}) weightedAvg=${avg === null ? 'n/a' : avg.toFixed(9)} (broker ${r.price}) ${ok ? '✅ matches' : '❌ MISMATCH'}`);
}
