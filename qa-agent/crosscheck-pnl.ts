/**
 * Cross-check Weekly Snapshot cost-basis / P&L against RAW SnapTrade data
 * (which mirrors Alpaca's dashboard — the same standard used for the
 * buying-power investigation).
 *
 * Run via: npx tsx qa-agent/crosscheck-pnl.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { resolveSnapTradeCredentials, listAccounts } from '../lib/snaptrade/client';
import { snapTradeFetch } from '../lib/snaptrade/auth';
import { extractPositionTicker } from '../lib/snaptrade/mapping';

const USER_ID = process.env.RECONCILE_USER_ID || '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONNECTION_ID = process.env.RECONCILE_CONNECTION_ID || 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const creds = await resolveSnapTradeCredentials(USER_ID, CONNECTION_ID);
  console.log('brokerSlug:', creds.brokerSlug, '| snapTradeConnectionId:', creds.connectionId);

  const ep = { userId: creds.snaptradeUserId, userSecret: creds.snaptradeUserSecret };
  const accounts = await listAccounts(creds.connectionId, creds.snaptradeUserId, creds.snaptradeUserSecret);
  console.log('accounts:', accounts.map(a => ({ id: a.id, name: a.name, total_value: a.total_value })));

  // DB positions for this connection
  const { data: dbPos } = await supabase.from('positions').select('*').eq('user_id', USER_ID).eq('connection_id', CONNECTION_ID);
  const dbMap = new Map<string, any>();
  for (const p of (dbPos || [])) dbMap.set(String(p.symbol || '').toUpperCase(), p);

  console.log('\n=== RAW SNAPTRADE vs DB vs WEEKLY-SNAPSHOT-MATH ===');
  console.log('symbol | brokerQty | brokerAvgCost | brokerCurPrice | brokerTotalCost | brokerOpenPnl | DB.avg_cost | DB.market_value | computedCostBasis | computedPnl(quote) | computedPnl(mktVal)');

  let brokerTotalCostSum = 0;
  let brokerPnlSum = 0;
  let dbMktValSum = 0;
  let dbCostSum = 0;

  for (const acct of accounts) {
    const raw = await snapTradeFetch<unknown>(`/accounts/${acct.id}/positions`, null, ep);
    const list = extractPositionArray(raw);
    for (const pp of list) {
      const rec = pp as Record<string, any>;
      const symbol = (extractPositionTicker(rec) || String(rec.symbol || '')).toUpperCase();
      if (!symbol) continue;
      const brokerQty = num(rec.units ?? rec.fractional_units ?? rec.quantity);
      const brokerAvgCost = num(rec.average_purchase_price ?? rec.price);
      const brokerCurPrice = num(rec.price);
      const brokerTotalCost = num(rec.total_purchase_price ?? rec.cost_basis ?? (brokerAvgCost * brokerQty));
      const brokerOpenPnl = num(rec.open_pnl ?? rec.unrealized_pl ?? (brokerCurPrice - brokerAvgCost) * brokerQty);

      const d = dbMap.get(symbol);
      const dbAvgCost = d ? num(d.avg_cost) : 0;
      const dbMktVal = d ? num(d.market_value) : 0;
      const dbQty = d ? num(d.qty) : 0;

      // Weekly Snapshot math (route parity): costBasis = avg_cost*qty; PnL = (cur-avg)*qty; marketValue = persisted
      const computedCostBasis = dbAvgCost * dbQty;
      const computedPnlQuote = (brokerCurPrice - dbAvgCost) * dbQty;
      const computedPnlMktVal = dbMktVal - computedCostBasis;

      brokerTotalCostSum += brokerTotalCost;
      brokerPnlSum += brokerOpenPnl;
      dbMktValSum += dbMktVal;
      dbCostSum += computedCostBasis;

      console.log(`${symbol} | ${brokerQty} | ${fmt(brokerAvgCost)} | ${fmt(brokerCurPrice)} | ${fmt(brokerTotalCost)} | ${fmt(brokerOpenPnl)} | ${fmt(dbAvgCost)} | ${fmt(dbMktVal)} | ${fmt(computedCostBasis)} | ${fmt(computedPnlQuote)} | ${fmt(computedPnlMktVal)}`);
    }
  }

  console.log('\n=== ACCOUNT TOTALS (Alpaca) ===');
  console.log(`Broker total_cost (SnapTrade): ${fmt(brokerTotalCostSum)}`);
  console.log(`Broker open_pnl   (SnapTrade): ${fmt(brokerPnlSum)}`);
  console.log(`DB cost_basis (avg_cost*qty):   ${fmt(dbCostSum)}`);
  console.log(`DB market_value sum:            ${fmt(dbMktValSum)}`);
  console.log(`DB implied PnL (mktVal-cost):   ${fmt(dbMktValSum - dbCostSum)}`);
  console.log(`\nCross-check: DB avg_cost vs broker average_purchase_price (per-position above)`);
  console.log(`Cross-check: DB market_value should = brokerQty*brokerCurPrice (SnapTrade last-synced price)`);
}

function extractPositionArray(raw: unknown): unknown[] {
  if (raw && typeof raw === 'object' && 'results' in (raw as Record<string, unknown>)) {
    const arr = (raw as { results: unknown[] }).results;
    return Array.isArray(arr) ? arr : [];
  }
  return Array.isArray(raw) ? raw : [];
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
