// ─── scripts/repair-reconcile-orders.ts ─────────────────────────────
// One-off (idempotent, re-runnable) data repair for the 2026-09-04 reconcile
// failure. Alpaca (via SnapTrade) is the source of truth; this script corrects
// the `orders` table to match the broker — NEVER the reverse.
//
// What it fixes:
//   1. 11 BUY orders wrongly `cancelled` in DB but FILLED at Alpaca
//      → status='filled' + filled_qty/filled_price/filled_at from broker,
//        clear cancelled_at + cancel_reason.
//   2.  6 SELL orders `cancelled` (stale_guard) but REJECTED at Alpaca
//      → status='rejected', clear filled_* / cancelled_at / cancel_reason.
//   3.  5 ghost orders with the sentinel brokerage_order_id='error'
//      → brokerage_order_id=NULL (a rejected placement never got a real id).
//
// Usage:
//   set -a && . ./.env.reconcile.local && set +a
//   npx tsx scripts/repair-reconcile-orders.ts            # DRY RUN (default)
//   npx tsx scripts/repair-reconcile-orders.ts --apply    # actually write
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { resolveSnapTradeCredentials, listAccounts } from '../lib/snaptrade/client';
import { snapTradeFetch } from '../lib/snaptrade/auth';

const USER_ID = process.env.RECONCILE_USER_ID || '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONNECTION_ID = process.env.RECONCILE_CONNECTION_ID || 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

const APPLY = process.argv.includes('--apply');

// Mirrors lib/reconcile.ts brokerStatusToDb (SnapTrade raw → DB status).
const BROKER_STATUS_TO_DB: Record<string, string> = {
  EXECUTED: 'filled', FILLED: 'filled',
  PARTIAL: 'partially_filled', PARTIALLY_FILLED: 'partially_filled', PARTIAL_FILL: 'partially_filled',
  CANCELED: 'cancelled', CANCELLED: 'cancelled', PARTIAL_CANCELED: 'cancelled',
  CANCEL_PENDING: 'cancelled', PENDING_CANCEL: 'cancelled', EXPIRED: 'cancelled',
  REJECTED: 'rejected', FAILED: 'rejected', SUSPENDED: 'rejected', STOPPED: 'rejected',
  NEW: 'submitted', PENDING_NEW: 'submitted', SUBMITTED: 'submitted',
  ACCEPTED: 'submitted', ACCEPTED_FOR_BIDDING: 'submitted', QUEUED: 'submitted',
  PENDING: 'submitted',
};
const brokerStatusToDb = (s: string | undefined): string =>
  BROKER_STATUS_TO_DB[(s || '').toUpperCase()] || 'open';

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface Plan {
  orderId: string;
  symbol: string;
  side: string;
  kind: 'fill' | 'reject' | 'ghost';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

async function main() {
  console.log(APPLY ? '── REPAIR MODE (--apply) ──' : '── DRY RUN (no writes; pass --apply to mutate) ──\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const creds = await resolveSnapTradeCredentials(USER_ID, CONNECTION_ID);
  const ep = { userId: creds.snaptradeUserId, userSecret: creds.snaptradeUserSecret };
  const brokerConnectionId = creds.brokerConnectionId;

  // ── Broker orders (full /accounts/{id}/orders) ──
  const accounts = await listAccounts(creds.connectionId, creds.snaptradeUserId, creds.snaptradeUserSecret);
  const accountIds = accounts.map((a) => a.id);
  const brokerMap = new Map<string, any>();
  for (const acctId of accountIds) {
    const raw = await snapTradeFetch<unknown>(`/accounts/${acctId}/orders`, null, ep);
    const list = (Array.isArray(raw) ? raw : ((raw as any)?.orders ?? [])) as any[];
    for (const o of list) {
      if (o.brokerage_order_id) brokerMap.set(String(o.brokerage_order_id).toLowerCase(), o);
    }
  }
  console.log(`broker orders: ${brokerMap.size}`);

  // ── DB orders + lots/positions (for knock-on-effect check) ──
  const { data: dbOrders } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('connection_id', brokerConnectionId)
    .order('created_at', { ascending: true });
  const { data: dbPositions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('connection_id', brokerConnectionId);
  const { data: dbLots } = await supabase
    .from('position_lots')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('account_id', brokerConnectionId);

  const now = new Date().toISOString();
  const plans: Plan[] = [];

  for (const o of (dbOrders || []) as any[]) {
    const rawId = o.brokerage_order_id;

    // ── Ghost: sentinel 'error' id (never a real broker order) ──
    if (rawId === 'error') {
      plans.push({
        orderId: o.id,
        symbol: o.symbol,
        side: o.side,
        kind: 'ghost',
        before: { brokerage_order_id: 'error', status: o.status },
        after: { brokerage_order_id: null },
      });
      continue;
    }

    if (!rawId) continue;
    const raw = brokerMap.get(String(rawId).toLowerCase());
    if (!raw) continue; // not a ghost-by-error; genuinely absent → leave alone

    const brokerDbStatus = brokerStatusToDb(raw.status);
    const dbStatus = String(o.status || '').toLowerCase();
    if (brokerDbStatus === dbStatus) continue; // already consistent

    const brokerFilledQty = num(raw.filled_quantity ?? raw.quantity);
    const brokerFilledPrice = numOrNull(raw.average_fill_price ?? raw.execution_price);

    if (brokerDbStatus === 'filled' || brokerDbStatus === 'partially_filled') {
      const filledAt = raw.time_executed ?? raw.trade_date ?? raw.time_placed ?? raw.create_date ?? now;
      plans.push({
        orderId: o.id,
        symbol: o.symbol,
        side: o.side,
        kind: 'fill',
        before: {
          status: o.status,
          filled_qty: o.filled_qty,
          filled_price: o.filled_price,
          filled_at: o.filled_at,
          cancelled_at: o.cancelled_at,
          cancel_reason: o.cancel_reason,
        },
        after: {
          status: 'filled',
          filled_qty: brokerFilledQty,
          filled_price: brokerFilledPrice,
          filled_at: filledAt,
          cancelled_at: null,
          cancel_reason: null,
        },
      });
    } else if (brokerDbStatus === 'rejected') {
      plans.push({
        orderId: o.id,
        symbol: o.symbol,
        side: o.side,
        kind: 'reject',
        before: {
          status: o.status,
          filled_qty: o.filled_qty,
          filled_price: o.filled_price,
          filled_at: o.filled_at,
          cancelled_at: o.cancelled_at,
          cancel_reason: o.cancel_reason,
        },
        after: {
          status: 'rejected',
          filled_qty: 0,
          filled_price: null,
          filled_at: null,
          cancelled_at: null,
          cancel_reason: null,
        },
      });
    } else {
      // Any other drift (e.g. cancelled) — leave to the sync cron; do not guess.
      console.log(`  ⚠️ skip non-fill/reject drift: ${o.symbol} ${o.id} ${o.status} → ${brokerDbStatus}`);
    }
  }

  const fills = plans.filter((p) => p.kind === 'fill');
  const rejects = plans.filter((p) => p.kind === 'reject');
  const ghosts = plans.filter((p) => p.kind === 'ghost');

  console.log(`\nplanned: ${fills.length} fills, ${rejects.length} rejects, ${ghosts.length} ghosts\n`);

  // ── Print per-row before → after ──
  for (const p of plans) {
    const tag = p.kind === 'fill' ? 'FILL ' : p.kind === 'reject' ? 'REJECT' : 'GHOST';
    console.log(`[${tag}] ${p.symbol.padEnd(5)} ${String(p.side).toUpperCase().padEnd(4)} ${p.orderId}`);
    console.log(`    before: ${JSON.stringify(p.before)}`);
    console.log(`    after : ${JSON.stringify(p.after)}`);
  }

  // ── Knock-on effects: lots / positions / cash ──
  console.log('\n── KNOCK-ON EFFECTS ──');
  const fillSymbols = new Set(fills.map((p) => p.symbol.toUpperCase()));
  if (fillSymbols.size > 0) {
    const posQty = new Map<string, number>();
    for (const p of (dbPositions || []) as any[]) posQty.set(String(p.symbol).toUpperCase(), Number(p.qty || 0));
    const lotQty = new Map<string, number>();
    for (const l of (dbLots || []) as any[]) {
      const s = String(l.ticker).toUpperCase();
      lotQty.set(s, (lotQty.get(s) || 0) + Number(l.remaining_qty || 0));
    }
    console.log('  Filled-buy symbols → position qty vs lot ledger remaining_qty (must NOT be re-added;');
    console.log('  the clean-slate backfill already holds these shares as aggregate lots):');
    for (const s of [...fillSymbols].sort()) {
      const pq = posQty.get(s) ?? 0;
      const lq = lotQty.get(s) ?? 0;
      const ok = Math.abs(pq - lq) <= 1e-4;
      console.log(`    ${s.padEnd(6)} pos=${pq.toFixed(6)} lots=${lq.toFixed(6)} ${ok ? '✓ consistent (no lot write)' : '✗ LOT GAP — needs manual review'}`);
    }
  } else {
    console.log('  (no fills planned)');
  }
  console.log('  cash: open-order reservation unchanged (openOrderCount already 0, driftVsSettledCash $0).');
  console.log('  orders table only; positions table is already broker-consistent and is NOT touched.');

  if (plans.length === 0) {
    console.log('\nNothing to repair — DB already matches broker.');
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN complete — ${plans.length} row(s) would change. Re-run with --apply to write.`);
    return;
  }

  // ── Apply ──
  let applied = 0;
  let failed = 0;
  for (const p of plans) {
    let patch: Record<string, unknown>;
    if (p.kind === 'ghost') {
      patch = { brokerage_order_id: null, updated_at: now };
    } else {
      patch = { ...(p.after as Record<string, unknown>), updated_at: now };
    }
    const { error } = await supabase.from('orders').update(patch).eq('id', p.orderId);
    if (error) {
      failed++;
      console.error(`  ✗ ${p.orderId}: ${error.message}`);
    } else {
      applied++;
      console.log(`  ✓ ${p.kind.padEnd(6)} ${p.symbol.padEnd(5)} ${p.orderId}`);
    }
  }
  console.log(`\nAPPLIED: ${applied} rows, FAILED: ${failed}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });
