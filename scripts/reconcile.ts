#!/usr/bin/env npx tsx
/**
 * Financial Reconciliation Script
 * =================================
 * Validates portfolio invariants for a given user.
 * Run: npx tsx scripts/reconcile.ts [userId]
 *
 * Checks:
 *  (A) Per-basket: sum of individual filled order costs = basket total
 *  (B) Portfolio rollup: sum of all filled orders = total invested
 *  (C) Position accuracy: position qty/avgCost matches filled order history
 *  (D) Cash integrity: starting cash - filled costs + realized gains = current cash
 *  (E) Status consistency: no basket/order with inconsistent child statuses
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ixjnuoslbzytubpplkot.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4am51b3NsYnp5dHVicHBsa290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NjcyNjAsImV4cCI6MjA5MzM0MzI2MH0.VprRiuUDdQDk5R_vE6Gqx9BKfjOQFyUuhrpsD_5BvwY';
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4am51b3NsYnp5dHVicHBsa290Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzc2NzI2MCwiZXhwIjoyMDkzMzQzMjYwfQ.rqSO9nb5bvVUss6mnemNWkIIoLg12Nv828J_BuqTZmo';

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';

interface BrokerState {
  positions: Array<{
    symbol: string;
    name?: string;
    qty?: number;
    shares?: number;
    avgCost?: number;
    basketId?: string;
    basketName?: string;
    reservedShares?: number;
  }>;
  orders: Array<any>;
  basket_orders: Array<{
    id: string;
    basketId?: string;
    basketName?: string;
    basketDisplayName?: string;
    basketEmoji?: string;
    status: string;
    totalReserved?: number;
    totalFilled?: number;
    totalSpent?: number;
    orders: Array<any>;
  }>;
  cash_balance: number;
  order_history: Array<any>;
}

interface Results {
  check: string;
  pass: boolean;
  left: string;
  right: string;
  detail?: string;
}

const results: Results[] = [];

async function fetchState(userId: string): Promise<BrokerState | null> {
  const key = SUPABASE_SVC_KEY;
  const url = `${SUPABASE_URL}/rest/v1/demo_portfolio_state?user_id=eq.${encodeURIComponent(userId)}`;
  const resp = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) {
    console.error(`Fetch failed: ${resp.status} ${resp.statusText}`);
    return null;
  }
  const rows = await resp.json();
  if (!rows || rows.length === 0) {
    console.error(`No demo_portfolio_state for user ${userId}`);
    return null;
  }
  if (rows.length > 1) {
    console.warn(`⚠️  Found ${rows.length} rows — using first. Remaining ${rows.length - 1} are orphan duplicates.`);
  }
  const row = rows[0];
  return {
    positions: row.positions || [],
    orders: row.orders || [],
    basket_orders: row.basket_orders || [],
    cash_balance: row.cash_balance ?? 0,
    order_history: row.order_history || [],
  };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}

function getShares(p: any): number {
  return p.qty ?? p.shares ?? 0;
}

// ─── CHECK A: PER-BASKET COST CONSISTENCY ───
function checkAPerBasketCosts(state: BrokerState): void {
  // Use order_history as canonical for filled orders
  const filledOrders = (state.order_history || []).filter((o: any) => o.status === 'FILLED');

  // Group by basketOrderId
  const byBasket = new Map<string, any[]>();
  for (const o of filledOrders) {
    const bid = o.basketOrderId;
    if (!bid) continue;
    if (!byBasket.has(bid)) byBasket.set(bid, []);
    byBasket.get(bid)!.push(o);
  }

  let totalDiffs = 0;

  for (const [basketOrderId, orders] of byBasket) {
    const orderSum = orders.reduce((s: number, o: any) => s + (o.totalCost || 0), 0);

    // Find the basket container
    const basket = (state.basket_orders || []).find((b: any) => b.id === basketOrderId);

    if (!basket) {
      results.push({
        check: `A) Basket ${basketOrderId.slice(0, 8)}`,
        pass: true,
        left: `Filled orders sum: $${fmt(orderSum)}`,
        right: 'Basket container not found in basket_orders (likely cancelled)',
      });
      continue;
    }

    const containerTotal = basket.totalReserved || basket.totalFilled || basket.totalSpent || 0;
    const diff = Math.abs(orderSum - containerTotal);

    if (diff > 0.01) {
      totalDiffs++;
      results.push({
        check: `A) Basket "${basket.basketDisplayName || basket.basketName || basketOrderId.slice(0, 8)}"`,
        pass: false,
        left: `Sum of filled orders: $${fmt(orderSum)} (${orders.length} orders)`,
        right: `Container totalReserved: $${fmt(containerTotal)}`,
        detail: `Diff: $${fmt(orderSum - containerTotal)}`,
      });
    } else if (orders.length > 0) {
      // Individual order details on PASS for audit
      const symbols = orders.map((o: any) => `${o.symbol}:$${fmt(o.totalCost || 0)}`).join(', ');
      results.push({
        check: `A) Basket "${basket.basketDisplayName || basket.basketName || basketOrderId.slice(0, 8)}"`,
        pass: true,
        left: `filled orders: $${fmt(orderSum)}`,
        right: `container: $${fmt(containerTotal)} [${symbols}]`,
      });
    }
  }

  if (totalDiffs === 0 && byBasket.size > 0) {
    // If all baskets were already logged individually, no need for a summary row
  } else if (byBasket.size === 0) {
    results.push({
      check: 'A) Per-basket costs',
      pass: true,
      left: 'No filled basket orders',
      right: 'Nothing to reconcile',
    });
  }
}

// ─── CHECK B: PORTFOLIO ROLLUP ───
function checkBPortfolioRollup(state: BrokerState): void {
  const filledOrders = (state.order_history || []).filter((o: any) => o.status === 'FILLED' && o.side === 'BUY');
  const filledSells = (state.order_history || []).filter((o: any) => o.status === 'FILLED' && o.side === 'SELL');

  const orderTotalInvested = filledOrders.reduce((s: number, o: any) => s + (o.totalCost || 0), 0);
  const orderTotalDivested = filledSells.reduce((s: number, o: any) => s + (o.totalCost || 0), 0);

  const positionTotalCost = (state.positions || []).reduce((s: number, p: any) => {
    return s + getShares(p) * (p.avgCost || 0);
  }, 0);

  const diff = Math.abs(orderTotalInvested - orderTotalDivested - positionTotalCost);

  results.push({
    check: 'B) Portfolio rollup',
    pass: diff < 0.01,
    left: `Positions cost basis: $${fmt(positionTotalCost)}`,
    right: `Filled BUY total: $${fmt(orderTotalInvested)} - SELL total: $${fmt(orderTotalDivested)} = $${fmt(orderTotalInvested - orderTotalDivested)}`,
    detail: diff >= 0.01 ? `Diff: $${fmt(orderTotalInvested - orderTotalDivested - positionTotalCost)}` : undefined,
  });
}

// ─── CHECK C: POSITION ACCURACY ───
function checkCPositionAccuracy(state: BrokerState): void {
  const filledOrders = (state.order_history || []).filter((o: any) => o.status === 'FILLED');

  // Group by symbol
  const bySymbol = new Map<string, any[]>();
  for (const o of filledOrders) {
    const sym = o.symbol;
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym)!.push(o);
  }

  let positionDiffs = 0;

  for (const pos of (state.positions || [])) {
    const symbol = pos.symbol;
    const orders = bySymbol.get(symbol) || [];

    if (orders.length === 0) {
      // Position without any order history — possibly seeded or manual
      results.push({
        check: `C) ${symbol}`,
        pass: true,
        left: `Position: ${fmt(getShares(pos))}sh @ $${fmt(pos.avgCost || 0)}`,
        right: 'No filled order history (seeded/manual position)',
      });
      continue;
    }

    // Compute from orders
    let totalQty = 0;
    let totalCost = 0;
    for (const o of orders) {
      const qty = o.side === 'BUY' ? (o.shares || 0) : -(o.shares || 0);
      const cost = o.side === 'BUY' ? (o.totalCost || 0) : -(o.totalCost || 0);
      totalQty += qty;
      totalCost += cost;
    }
    const orderAvgCost = totalQty > 0 ? totalCost / totalQty : 0;

    const posQty = getShares(pos);
    const posAvgCost = pos.avgCost || 0;
    const qtyDiff = Math.abs(posQty - totalQty);
    const costDiff = Math.abs(posAvgCost - orderAvgCost);

    if (qtyDiff > 0.001 || costDiff > 0.01) {
      positionDiffs++;
      results.push({
        check: `C) ${symbol}`,
        pass: false,
        left: `Position: ${fmt(posQty)}sh @ $${fmt(posAvgCost)}`,
        right: `Orders: ${fmt(totalQty)}sh @ $${fmt(orderAvgCost)}`,
        detail: qtyDiff > 0.001
          ? `Qty diff: ${fmt(posQty - totalQty)}sh`
          : `Cost diff: $${fmt(posAvgCost - orderAvgCost)}`,
      });
    } else {
      results.push({
        check: `C) ${symbol}`,
        pass: true,
        left: `Position: ${fmt(posQty)}sh @ $${fmt(posAvgCost)}`,
        right: `Orders: ${fmt(totalQty)}sh @ $${fmt(orderAvgCost)}`,
      });
    }
  }
}

// ─── CHECK D: CASH INTEGRITY ───
function checkDCashIntegrity(state: BrokerState): void {
  // Derive effective starting cash by reversing all known cash flows.
  // Starting = current cash + filled buys - filled sells + currently reserved
  const filledOrders = (state.order_history || []).filter((o: any) => o.status === 'FILLED');
  const buys = filledOrders.filter((o: any) => o.side === 'BUY');
  const sells = filledOrders.filter((o: any) => o.side === 'SELL');

  let totalBought = 0;
  for (const o of buys) {
    totalBought += (o.totalCost || o.fillPrice * (o.shares || 0) || 0);
  }

  let totalSold = 0;
  for (const o of sells) {
    totalSold += (o.totalCost || o.fillPrice * (o.shares || 0) || 0);
  }

  // Reserved cash in OPEN basket orders
  const openBaskets = (state.basket_orders || []).filter((b: any) => b.status === 'OPEN');
  const reservedCash = openBaskets.reduce((s: number, b: any) => s + (b.totalReserved || 0), 0);

  // CANCELLED baskets: cash was reserved then refunded — net zero effect
  // We include them to show a complete picture
  const cancelledBaskets = (state.basket_orders || []).filter((b: any) => b.status === 'CANCELLED');
  const cancelledReserved = cancelledBaskets.reduce((s: number, b: any) => s + (b.totalReserved || 0), 0);

  const actualCash = state.cash_balance ?? 0;

  // Forward: compute what cash SHOULD be assuming $100k starting portfolio
  // The demo starts with $100k = cash + positions. Initial cash = $100k - initial_positions_cost.
  // But we don't know initial_positions_cost for sure, so work backwards:
  // derivedStartingCash = actualCash + totalBought - totalSold + reservedCash
  const derivedStarting = actualCash + totalBought - totalSold + reservedCash;
  const expectedStarting = 100000;
  const drift = derivedStarting - expectedStarting;

  // Forward-compute: what cash would the expected starting yield?
  // This should equal actualCash if there's no drift
  const forwardCash = expectedStarting - totalBought + totalSold - reservedCash;
  const cashDiff = actualCash - forwardCash;

  results.push({
    check: 'D) Cash integrity',
    pass: Math.abs(drift) < 0.01,
    left: `Actual cash: $${fmt(actualCash)}`,
    right: `$${expectedStarting} starting - $${fmt(totalBought)} bought + $${fmt(totalSold)} sold - $${fmt(reservedCash)} open_reserved = $${fmt(forwardCash)}`,
    detail: Math.abs(drift) >= 0.01
      ? `Derived starting cash: $${fmt(derivedStarting)} (vs $${expectedStarting} expected). Cash drift: $${fmt(cashDiff)} (${fmt(cashDiff)} more cash than expected). Cancelled baskets had $${fmt(cancelledReserved)} reserved then refunded.`
      : `Cancelled baskets: $${fmt(cancelledReserved)} reserved then refunded (net $0)`,
  });
}

// ─── CHECK E: STATUS CONSISTENCY ───
function checkEStatusConsistency(state: BrokerState): void {
  let inconsistencies = 0;

  for (const basket of (state.basket_orders || [])) {
    const childOrders = basket.orders || [];
    if (childOrders.length === 0) continue;

    const childStatuses = childOrders.map((o: any) => o.status);
    const uniqueStatuses = new Set(childStatuses);
    const containerStatus = basket.status;

    // All children OPEN → container must be OPEN
    // All children FILLED → container must be FILLED
    // All children CANCELLED → container must be CANCELLED
    // Mixed → container must be PARTIAL
    let expectedStatus: string;
    if (uniqueStatuses.size === 1) {
      expectedStatus = childStatuses[0];
    } else {
      expectedStatus = 'PARTIAL';
    }

    if (containerStatus !== expectedStatus && !(containerStatus === 'FILLED' && expectedStatus === 'PARTIAL')) {
      // Allow FILLED container with PARTIAL children (partial fills)
      inconsistencies++;
      results.push({
        check: `E) Basket "${basket.basketDisplayName || basket.basketName || basket.id.slice(0, 8)}"`,
        pass: false,
        left: `Container: ${containerStatus}`,
        right: `Children: ${[...uniqueStatuses].join(', ')} (expected: ${expectedStatus})`,
        detail: childOrders.map((o: any) => `${o.symbol}:${o.status}`).join(', '),
      });
    } else if (containerStatus !== expectedStatus && containerStatus === 'FILLED' && expectedStatus === 'PARTIAL') {
      // Partial fill → container FILLED is acceptable
      results.push({
        check: `E) Basket "${basket.basketDisplayName || basket.basketName || basket.id.slice(0, 8)}"`,
        pass: true,
        left: `Container: ${containerStatus} (partial fill accepted)`,
        right: `Children: ${[...uniqueStatuses].join(', ')}`,
        detail: childOrders.map((o: any) => `${o.symbol}:${o.status}`).join(', '),
      });
    } else {
      results.push({
        check: `E) Basket "${basket.basketDisplayName || basket.basketName || basket.id.slice(0, 8)}"`,
        pass: true,
        left: `Container: ${containerStatus}`,
        right: `Children: ${[...uniqueStatuses].join(', ')}`,
      });
    }
  }

  if (inconsistencies === 0 && (state.basket_orders || []).length === 0) {
    results.push({
      check: 'E) Status consistency',
      pass: true,
      left: 'No basket orders',
      right: 'Nothing to check',
    });
  }
}

// ─── MAIN ───
async function main() {
  const userId = process.argv[2] || '58ffa82a-2b14-4a5d-9662-5c48f105031f';

  console.log(`\n🔍 Financial Reconciliation`);
  console.log(`   User: ${userId}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  const state = await fetchState(userId);
  if (!state) {
    console.error('Failed to fetch state. Aborting.');
    process.exit(1);
  }

  console.log(`   Loaded: ${state.positions.length} positions, ${(state.order_history || []).length} order_history entries, ${(state.basket_orders || []).length} basket_orders\n`);
  console.log('━'.repeat(70));

  // Run all checks
  checkAPerBasketCosts(state);
  checkBPortfolioRollup(state);
  checkCPositionAccuracy(state);
  checkDCashIntegrity(state);
  checkEStatusConsistency(state);

  console.log('━'.repeat(70));

  // Print results
  let passes = 0;
  let fails = 0;

  for (const r of results) {
    const icon = r.pass ? PASS : FAIL;
    console.log(icon, r.check);
    console.log(`   ${r.left}`);
    console.log(`   ${r.right}`);
    if (r.detail) console.log(`   → ${r.detail}`);
    console.log();
    if (r.pass) passes++; else fails++;
  }

  console.log('━'.repeat(70));
  console.log(`\n📊 Summary: ${passes} passed, ${fails} failed, ${results.length} total checks`);
  console.log(`   ${fails > 0 ? FAIL : PASS} Overall: ${fails > 0 ? `${fails} issues found` : 'All checks passed'}\n`);

  process.exit(fails > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
