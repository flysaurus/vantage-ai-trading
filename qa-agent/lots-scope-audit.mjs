// READ-ONLY audit: position_lots account scoping vs broker_connections.
// SELECTs only. No insert/update/delete/rpc. Safe against prod.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('missing env'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const out = {};

// 1. broker_connections rows (the ids the reader filters on)
const { data: conns, error: cErr } = await sb
  .from('broker_connections')
  .select('id, user_id, brokerage_slug, snaptrade_connection_id, status, trading_enabled, snaptrade_accounts');
if (cErr) out.connectionsError = cErr.message;
out.connections = (conns || []).map((c) => ({
  id: c.id,
  user_id: c.user_id,
  slug: c.brokerage_slug,
  snaptrade_connection_id: c.snaptrade_connection_id,
  status: c.status,
  trading_enabled: c.trading_enabled,
  account_ids_in_json: Array.isArray(c.snaptrade_accounts)
    ? c.snaptrade_accounts.map((a) => a?.id).filter(Boolean)
    : null,
}));

// 2. every distinct account_id present in position_lots
const { data: lots, error: lErr } = await sb
  .from('position_lots')
  .select('id, user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source');
if (lErr) out.lotsError = lErr.message;
const rows = lots || [];
out.positionLotsTotalRows = rows.length;
const byAcct = {};
for (const r of rows) {
  const k = r.account_id === null ? 'NULL (demo)' : r.account_id;
  byAcct[k] = byAcct[k] || { count: 0, openCount: 0, tickers: {}, first: r.filled_at, last: r.filled_at, sources: {} };
  const b = byAcct[k];
  b.count++;
  if (Number(r.remaining_qty) > 0) b.openCount++;
  b.tickers[r.ticker] = (b.tickers[r.ticker] || 0) + 1;
  b.sources[r.source || 'null'] = (b.sources[r.source || 'null'] || 0) + 1;
  if (r.filled_at < b.first) b.first = r.filled_at;
  if (r.filled_at > b.last) b.last = r.filled_at;
}
out.positionLotsByAccountId = byAcct;

// 3. does every non-null account_id match a broker_connections.id?
const connIds = new Set((conns || []).map((c) => c.id));
const orphanAccountIds = Object.keys(byAcct).filter((k) => k !== 'NULL (demo)' && !connIds.has(k));
out.orphanAccountIdsNotMatchingAnyConnection = orphanAccountIds;

// 4. orders table account link (connection_id) for cross-reference
const { data: ords, error: oErr } = await sb
  .from('orders')
  .select('id, connection_id, account_id, symbol, status, filled_at')
  .limit(500);
if (oErr) out.ordersError = oErr.message;
const ordConn = {};
for (const o of ords || []) {
  const k = o.connection_id === null ? 'NULL' : o.connection_id;
  ordConn[k] = (ordConn[k] || 0) + 1;
}
out.ordersCountByConnectionId = ordConn;
out.ordersSampleAccountId = (ords || []).slice(0, 3).map((o) => o.account_id);

console.log(JSON.stringify(out, null, 2));
