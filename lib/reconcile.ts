// ─── lib/reconcile.ts — Broker ↔ Vantage reconciliation engine ───
//
// SINGLE SOURCE OF TRUTH for the "did anything drift from the broker?" check.
// The broker (Alpaca via SnapTrade) is authoritative; Vantage must never
// compute/display a number that drifts from the broker's API.
//
// Used by:
//   • GET /api/reconcile?connectionId=…  (interactive, on-demand)
//   • scripts/run-reconcile.ts           (local / CI replay)
//
// Reconciles three axes against live broker data:
//   1. CASH      — broker buying_power vs Vantage's displayed available cash
//                  (settled cash − local open-order reservations).
//   2. ORDERS    — broker recentOrders vs orders table (per brokerage_order_id),
//                  flagging status/qty/price drift + external (broker-only) and
//                  ghost (DB-only) orders.
//   3. POSITIONS — broker positions vs positions snapshot (qty + avg_cost) AND
//                  vs position_lots remaining_qty sum (FIFO cost-basis gap).

import type { SupabaseClient } from '@supabase/supabase-js';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import { listAccounts, getAccountBalances } from '@/lib/snaptrade/client';
import { extractOrderSymbol, extractPositionTicker } from '@/lib/snaptrade/mapping';
import { sumOpenReservedAmount, availableCash } from '@/lib/available-cash';
import { formatBrokerName } from '@/lib/broker-name';

// ─── Constants ────────────────────────────────────────────────

// Broker average-cost is rounded to 1 decimal place (±0.05/share) for some
// fractional positions (e.g. RCAT: broker 9.1 vs DB 9.089657). A plain 1¢
// threshold would flag these as drift when they're just precision artifacts.
// Allow that rounding slack: >0.05, plus a hair for float representation.
const COST_TOLERANCE_PER_SHARE = 0.06;

// ─── Types ────────────────────────────────────────────────────

export interface ReconcileInput {
  supabase: SupabaseClient;
  /** Authenticated Vantage user UUID. */
  userId: string;
  /** SnapTrade authorization id (what SnapTrade API calls need). */
  connectionId: string;
  /** broker_connections.id (internal row — orders/positions/lots scope). */
  brokerConnectionId: string;
  brokerSlug: string;
  snaptradeUserId: string;
  snaptradeUserSecret: string;
}

export interface CashReconciliation {
  brokerName: string;
  brokerCash: number;
  brokerBuyingPower: number;
  brokerTotalValue: number;
  openOrderCount: number;
  openBuyCount: number;
  openSellCount: number;
  /** Dollars reserved by still-open BUY orders (local). */
  openReservedAmount: number;
  /** Vantage's displayed "available cash" = settled cash − reservations. */
  vantageAvailableCash: number;
  /** brokerCash − vantageAvailableCash. Should equal openReservedAmount. */
  driftVsSettledCash: number;
  /** brokerBuyingPower − vantageAvailableCash. = margin gap (+ reservations). */
  driftVsBuyingPower: number;
  /** True when buyingPower materially exceeds settled cash (margin account). */
  marginAccount: boolean;
}

export interface OrderStatusMismatch {
  brokerageOrderId: string;
  symbol: string;
  side: string;
  dbStatus: string;
  brokerStatus: string;
  dbFilledQty: number;
  brokerFilledQty: number;
  dbFilledPrice: number | null;
  brokerFilledPrice: number | null;
}

export interface ExternalOrder {
  brokerageOrderId: string;
  symbol: string;
  side: string;
  status: string;
  filledQty: number;
  filledPrice: number | null;
  placedAt: string | null;
}

export interface GhostOrder {
  id: string;
  brokerageOrderId: string | null;
  symbol: string;
  side: string;
  status: string;
  createdAt: string;
}

export interface OrderReconciliation {
  brokerCount: number;
  dbCount: number;
  dbWithBrokerId: number;
  dbWithoutBrokerId: number;
  matched: number;
  statusMismatches: OrderStatusMismatch[];
  qtyMismatches: number;
  priceMismatches: number;
  /** DB orders whose brokerage_order_id is absent from broker recentOrders. */
  dbOnlyCount: number;
  dbOnlyOpenCount: number;
  ghostOrders: GhostOrder[];
  /** Broker orders absent from the DB (external / linkage lost). */
  brokerOnlyCount: number;
  externalOrders: ExternalOrder[];
}

export interface PositionDetail {
  symbol: string;
  brokerQty: number;
  dbQty: number;
  lotsRemaining: number;
  brokerAvgCost: number;
  dbAvgCost: number;
  qtyMismatch: boolean;
  costMismatch: boolean;
  lotMismatch: boolean;
}

export interface PositionReconciliation {
  brokerCount: number;
  dbCount: number;
  qtyMismatches: number;
  costMismatches: number;
  lotMismatches: number;
  /** Symbols present in broker but missing from the DB snapshot. */
  missingFromDb: string[];
  /** Symbols present in DB but missing from broker. */
  missingFromBroker: string[];
  details: PositionDetail[];
}

export interface ReconcileReport {
  generatedAt: string;
  brokerName: string;
  brokerConnectionId: string;
  cash: CashReconciliation;
  orders: OrderReconciliation;
  positions: PositionReconciliation;
  /** True when NOTHING drifted (all three axes clean). */
  healthy: boolean;
}

// ─── Status mapping (SnapTrade raw → Vantage DB status) ────────
// Mirrors SnapTradeBroker._mapSnapTradeStatusToOrderStatus, lowercased to the
// canonical orders.status values (submitted|open|partially_filled|filled|
// cancelled|rejected).

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

export function brokerStatusToDb(status: string | undefined): string {
  return BROKER_STATUS_TO_DB[(status || '').toUpperCase()] || 'open';
}

const OPEN_DB_STATUSES = new Set(['submitted', 'open', 'pending', 'partially_filled']);

// ─── Engine ────────────────────────────────────────────────────

export async function runReconciliation(input: ReconcileInput): Promise<ReconcileReport> {
  const { supabase, userId, connectionId, brokerConnectionId, brokerSlug, snaptradeUserId, snaptradeUserSecret } = input;
  const ep = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };
  const brokerName = formatBrokerName(brokerSlug);

  // ── 1. Broker: accounts → cash / buying power / total value ──
  // total_value is authoritative from the accounts endpoint; cash + buying
  // power are authoritative from the per-account BALANCES endpoint (the
  // accounts payload does not reliably surface them at the top level).
  const accounts = await listAccounts(connectionId, snaptradeUserId, snaptradeUserSecret);
  let brokerCash = 0;
  let brokerBuyingPower = 0;
  let brokerTotalValue = 0;
  for (const a of accounts) {
    brokerTotalValue += a.total_value ?? 0;
  }
  for (const a of accounts) {
    try {
      const balances = await getAccountBalances(a.id, snaptradeUserId, snaptradeUserSecret);
      for (const b of balances) {
        brokerCash += b.cash ?? 0;
        brokerBuyingPower += b.buying_power ?? 0;
      }
    } catch (err) {
      console.error(`[reconcile] balances fetch failed for ${a.id}:`, (err as Error).message);
    }
  }

  // ── 2. Broker: positions (per account) ──
  const brokerPositions = new Map<string, { qty: number; avgCost: number }>();
  const accountIds = accounts.map((a) => a.id);
  for (const acctId of accountIds) {
    try {
      const raw = await snapTradeFetch<unknown>(`/accounts/${acctId}/positions`, null, ep);
      const list = extractPositionArray(raw);
      for (const p of list) {
        const symbol = extractPositionTicker(p as Record<string, unknown>).toUpperCase();
        if (!symbol) continue;
        const units = Number((p as any).units ?? (p as any).fractional_units ?? (p as any).quantity ?? 0);
        const avgCost = Number((p as any).average_purchase_price ?? (p as any).price ?? 0);
        brokerPositions.set(symbol, { qty: units, avgCost });
      }
    } catch (err) {
      console.error(`[reconcile] positions fetch failed for ${acctId}:`, (err as Error).message);
    }
  }

  // ── 3. Broker: recentOrders (per account, merged) ──
  interface RawBrokerOrder {
    brokerage_order_id?: string;
    status?: string;
    action?: string;
    quantity?: number | string | null;
    filled_quantity?: number | string | null;
    average_fill_price?: number | string | null;
    execution_price?: number | string | null;
    time_placed?: string | null;
    create_date?: string | null;
  }
  const brokerOrders = new Map<string, RawBrokerOrder>();
  for (const acctId of accountIds) {
    try {
      const resp = await snapTradeFetch<{ orders?: RawBrokerOrder[] }>(
        `/accounts/${acctId}/recentOrders`,
        null,
        { ...ep, only_executed: 'false' },
      );
      for (const o of resp.orders || []) {
        const id = o.brokerage_order_id;
        if (id) brokerOrders.set(id, o);
      }
    } catch (err) {
      console.error(`[reconcile] recentOrders fetch failed for ${acctId}:`, (err as Error).message);
    }
  }

  // ── 4. DB: orders / positions / lots ──
  const { data: dbOrders } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .eq('connection_id', brokerConnectionId);
  const { data: dbPositions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .eq('connection_id', brokerConnectionId);
  const { data: dbLots } = await supabase
    .from('position_lots')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', brokerConnectionId);

  const orders = (dbOrders || []) as any[];
  const positions = (dbPositions || []) as any[];
  const lots = (dbLots || []) as any[];

  // ── CASH reconciliation ──
  const openOrders = orders.filter((o) => OPEN_DB_STATUSES.has(String(o.status || '').toLowerCase()));
  const openBuys = openOrders.filter((o) => String(o.side || '').toLowerCase() !== 'sell');
  const openSells = openOrders.filter((o) => String(o.side || '').toLowerCase() === 'sell');
  const openReservedAmount = sumOpenReservedAmount(
    openOrders.map((o) => ({
      side: o.side,
      status: o.status,
      requestedAmount: o.requested_amount,
      requestedQty: o.requested_qty,
      orderUnit: o.order_unit,
      notional: o.notional,
      qty: o.qty,
      fillPrice: o.filled_price,
      limitPrice: null,
    })),
  );
  const vantageAvailableCash = availableCash(
    { cash: brokerCash, buyingPower: brokerBuyingPower },
    openReservedAmount,
  );

  const cash: CashReconciliation = {
    brokerName,
    brokerCash,
    brokerBuyingPower,
    brokerTotalValue,
    openOrderCount: openOrders.length,
    openBuyCount: openBuys.length,
    openSellCount: openSells.length,
    openReservedAmount,
    vantageAvailableCash,
    driftVsSettledCash: round2(brokerCash - vantageAvailableCash),
    driftVsBuyingPower: round2(brokerBuyingPower - vantageAvailableCash),
    marginAccount: brokerBuyingPower > brokerCash * 1.2,
  };

  // ── ORDER reconciliation ──
  const brokerOnlyMap = new Map(brokerOrders);
  const dbByBrokerId = new Map<string, any>();
  const dbNoBrokerId: any[] = [];
  for (const o of orders) {
    if (o.brokerage_order_id) dbByBrokerId.set(String(o.brokerage_order_id).toLowerCase(), o);
    else dbNoBrokerId.push(o);
  }

  const statusMismatches: OrderStatusMismatch[] = [];
  let orderQtyMismatches = 0;
  let orderPriceMismatches = 0;
  let matched = 0;

  for (const o of orders) {
    if (!o.brokerage_order_id) continue;
    const raw = brokerOnlyMap.get(String(o.brokerage_order_id).toLowerCase());
    if (!raw) continue;
    matched++;
    const brokerDbStatus = brokerStatusToDb(raw.status);
    const brokerFilledQty = Number(raw.filled_quantity ?? raw.quantity ?? 0);
    const brokerFilledPrice = numOrNull(raw.average_fill_price ?? raw.execution_price);

    if (brokerDbStatus !== String(o.status || '').toLowerCase()) {
      statusMismatches.push({
        brokerageOrderId: raw.brokerage_order_id!,
        symbol: extractOrderSymbol(raw as unknown as Record<string, unknown>) || String(o.symbol || ''),
        side: String(o.side || ''),
        dbStatus: String(o.status || ''),
        brokerStatus: brokerDbStatus,
        dbFilledQty: Number(o.filled_qty || 0),
        brokerFilledQty,
        dbFilledPrice: numOrNull(o.filled_price),
        brokerFilledPrice,
      });
    }
    if (Math.abs(Number(o.filled_qty || 0) - brokerFilledQty) > 1e-6) orderQtyMismatches++;
    const dbPx = numOrNull(o.filled_price);
    if (dbPx != null && brokerFilledPrice != null && Math.abs(dbPx - brokerFilledPrice) > 0.005) orderPriceMismatches++;
  }

  // Ghost = DB orders (with brokerage id) absent from broker recentOrders.
  const ghostOrders: GhostOrder[] = [];
  let dbOnlyOpenCount = 0;
  for (const o of orders) {
    if (!o.brokerage_order_id) continue;
    if (brokerOnlyMap.has(String(o.brokerage_order_id).toLowerCase())) continue;
    const st = String(o.status || '').toLowerCase();
    if (OPEN_DB_STATUSES.has(st)) dbOnlyOpenCount++;
    ghostOrders.push({
      id: o.id,
      brokerageOrderId: o.brokerage_order_id,
      symbol: String(o.symbol || ''),
      side: String(o.side || ''),
      status: st,
      createdAt: o.created_at,
    });
  }

  // External = broker orders absent from DB (by brokerage id).
  const externalOrders: ExternalOrder[] = [];
  for (const [id, raw] of brokerOnlyMap) {
    if (dbByBrokerId.has(id)) continue;
    externalOrders.push({
      brokerageOrderId: id,
      symbol: extractOrderSymbol(raw as unknown as Record<string, unknown>) || '',
      side: String(raw.action || '').toUpperCase() === 'SELL' ? 'sell' : 'buy',
      status: brokerStatusToDb(raw.status),
      filledQty: Number(raw.filled_quantity ?? raw.quantity ?? 0),
      filledPrice: numOrNull(raw.average_fill_price ?? raw.execution_price),
      placedAt: raw.time_placed || raw.create_date || null,
    });
  }

  const ordersReport: OrderReconciliation = {
    brokerCount: brokerOrders.size,
    dbCount: orders.length,
    dbWithBrokerId: orders.length - dbNoBrokerId.length,
    dbWithoutBrokerId: dbNoBrokerId.length,
    matched,
    statusMismatches,
    qtyMismatches: orderQtyMismatches,
    priceMismatches: orderPriceMismatches,
    dbOnlyCount: ghostOrders.length,
    dbOnlyOpenCount,
    ghostOrders,
    brokerOnlyCount: externalOrders.length,
    externalOrders,
  };

  // ── POSITION reconciliation ──
  const dbPosMap = new Map<string, any>();
  for (const p of positions) dbPosMap.set(String(p.symbol || '').toUpperCase(), p);

  const lotsRemainingBySymbol = new Map<string, number>();
  for (const l of lots) {
    const s = String(l.ticker || '').toUpperCase();
    lotsRemainingBySymbol.set(s, (lotsRemainingBySymbol.get(s) || 0) + Number(l.remaining_qty || 0));
  }

  const allSymbols = new Set<string>([...brokerPositions.keys(), ...dbPosMap.keys()]);
  const missingFromDb: string[] = [];
  const missingFromBroker: string[] = [];
  const details: PositionDetail[] = [];
  let qtyMismatches = 0;
  let costMismatches = 0;
  let lotMismatches = 0;

  for (const sym of allSymbols) {
    const b = brokerPositions.get(sym);
    const d = dbPosMap.get(sym);
    if (b && !d) missingFromDb.push(sym);
    if (!b && d) missingFromBroker.push(sym);
    const brokerQty = b?.qty ?? 0;
    const dbQty = Number(d?.qty ?? 0);
    const brokerAvgCost = b?.avgCost ?? 0;
    const dbAvgCost = Number(d?.avg_cost ?? 0);
    const lotsRemaining = lotsRemainingBySymbol.get(sym) || 0;
    const qtyMismatch = Math.abs(brokerQty - dbQty) > 1e-4;
    const costMismatch = Math.abs(brokerAvgCost - dbAvgCost) > COST_TOLERANCE_PER_SHARE;
    const lotMismatch = Math.abs(dbQty - lotsRemaining) > 1e-4;
    if (qtyMismatch) qtyMismatches++;
    if (costMismatch) costMismatches++;
    if (lotMismatch) lotMismatches++;
    details.push({
      symbol: sym,
      brokerQty,
      dbQty,
      lotsRemaining,
      brokerAvgCost,
      dbAvgCost,
      qtyMismatch,
      costMismatch,
      lotMismatch,
    });
  }
  details.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const positionsReport: PositionReconciliation = {
    brokerCount: brokerPositions.size,
    dbCount: positions.length,
    qtyMismatches,
    costMismatches,
    lotMismatches,
    missingFromDb,
    missingFromBroker,
    details,
  };

  const healthy =
    cash.driftVsSettledCash < 0.02 &&
    ordersReport.statusMismatches.length === 0 &&
    ordersReport.dbOnlyOpenCount === 0 &&
    ordersReport.brokerOnlyCount === 0 &&
    positionsReport.qtyMismatches === 0 &&
    positionsReport.costMismatches === 0;

  return {
    generatedAt: new Date().toISOString(),
    brokerName,
    brokerConnectionId,
    cash,
    orders: ordersReport,
    positions: positionsReport,
    healthy,
  };
}

// ─── Helpers ───────────────────────────────────────────────────

function extractPositionArray(raw: unknown): unknown[] {
  if (raw && typeof raw === 'object' && 'results' in (raw as Record<string, unknown>)) {
    const arr = (raw as { results: unknown[] }).results;
    return Array.isArray(arr) ? arr : [];
  }
  return Array.isArray(raw) ? raw : [];
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
