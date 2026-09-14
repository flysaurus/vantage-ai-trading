// READ-ONLY pre-flight for the TLT/XLK/XLP lot backfill.
// SELECTs only — no insert/update/delete/rpc.
import { createClient } from '@supabase/supabase-js';

const USER_ID = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONN = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const TARGETS = [
  { ticker: 'TLT', qty: 9.789607866, avgCost: 82.372043 },
  { ticker: 'XLK', qty: 82.079463419, avgCost: 186.277534 },
  { ticker: 'XLP', qty: 239.642706131, avgCost: 85.068644 },
];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

for (const t of TARGETS) {
  const { data: lots, error } = await sb
    .from('position_lots')
    .select('id,qty,remaining_qty,price_at_fill,filled_at,source,origin_tag,order_id')
    .eq('user_id', USER_ID)
    .eq('account_id', CONN)
    .eq('ticker', t.ticker)
    .order('filled_at', { ascending: true });
  if (error) { console.error('ERR', t.ticker, error.message); continue; }

  const rows = lots || [];
  const open = rows.filter((r) => Number(r.remaining_qty) > 0);
  const openQty = open.reduce((s, r) => s + Number(r.remaining_qty), 0);
  const trackedCost = open.reduce((s, r) => s + Number(r.remaining_qty) * Number(r.price_at_fill), 0);
  const trackedAvg = openQty > 0 ? trackedCost / openQty : null;

  // Proposed reconciliation lot: price chosen so the position's weighted-average
  // cost equals the broker avg_cost exactly.
  const shortfall = Number((t.qty - openQty).toFixed(9));
  const reconPrice = shortfall > 1e-9 ? (t.qty * t.avgCost - trackedCost) / shortfall : null;
  const afterQty = openQty + (shortfall > 0 ? shortfall : 0);
  const afterCost = trackedCost + (shortfall > 0 && reconPrice !== null ? shortfall * reconPrice : 0);
  const afterAvg = afterQty > 0 ? afterCost / afterQty : null;

  console.log(JSON.stringify({
    ticker: t.ticker,
    brokerQty: t.qty,
    brokerAvgCost: t.avgCost,
    lotRows: rows.length,
    openRows: open.length,
    openQty: Number(openQty.toFixed(9)),
    trackedAvg: trackedAvg === null ? null : Number(trackedAvg.toFixed(9)),
    shortfallQty: shortfall <= 1e-9 ? 0 : shortfall,
    proposedPrice: reconPrice === null ? null : Number(reconPrice.toFixed(9)),
    afterQty: Number(afterQty.toFixed(9)),
    afterAvgCost: afterAvg === null ? null : Number(afterAvg.toFixed(9)),
    matchesBrokerAvg: afterAvg !== null && Math.abs(afterAvg - t.avgCost) < 1e-6,
    originTagsPresent: [...new Set(rows.map((r) => r.origin_tag))],
    closedRows: rows.filter((r) => Number(r.remaining_qty) <= 0).length,
  }, null, 1));
}
