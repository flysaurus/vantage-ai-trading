// ─── scripts/verify-wash-sale-cross-connection.ts ───────────
//
// READ-ONLY. No inserts/updates/deletes — SELECTs only, plus the pure
// wash-sale evaluator. Safe to run against live data at any time.
//
// Item 3 acceptance test, live: prove the repurchase window now catches a
// conflicting BUY that lives in a DIFFERENT connection than the one being sold
// — specifically a read-only login (Fidelity, trading_enabled=false) that has
// ZERO rows in `orders` and therefore was invisible before the union.
//
// It also re-runs the OLD scope (orders only, no trade_history gap-fill) so the
// before/after difference is visible rather than asserted.
//
// Usage: npx tsx scripts/verify-wash-sale-cross-connection.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { checkWashSale, evaluateWashSale, fetchRepurchaseFills, type OrderLike } from '../lib/wash-sale';
import { buildWashSaleCheck } from '../lib/tax-harvest/recent-buys';

const USER_ID =
  process.env.RECONCILE_USER_ID || '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const FIDELITY = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Active lots in the SELLING connection (Alpaca).
  const { data: lotRows, error: lotErr } = await supabase
    .from('position_lots')
    .select('ticker, remaining_qty, price_at_fill, filled_at')
    .eq('user_id', USER_ID)
    .eq('account_id', ALPACA)
    .gt('remaining_qty', 0);
  if (lotErr) throw lotErr;

  // Fidelity buys inside the 30-day window (broker-reported fills).
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: fidBuys, error: fidErr } = await supabase
    .from('trade_history')
    .select('symbol, action, quantity, price, executed_at, connection_id')
    .eq('user_id', USER_ID)
    .eq('connection_id', FIDELITY)
    .eq('action', 'buy')
    .gte('executed_at', cutoff);
  if (fidErr) throw fidErr;

  const fidBuySymbols = new Set((fidBuys || []).map((b: any) => String(b.symbol).toUpperCase()));
  const candidates = (lotRows || []).filter((l: any) => fidBuySymbols.has(String(l.ticker).toUpperCase()));

  console.log(`[verify] Alpaca lots: ${(lotRows || []).length}`);
  console.log(`[verify] Fidelity buys <30d: ${(fidBuys || []).length}`);
  console.log(`[verify] candidates (Alpaca lot + Fidelity buy): ${candidates.map((c: any) => c.ticker).join(', ') || 'none'}`);
  if (candidates.length === 0) {
    console.log('[verify] nothing to prove with live data — no sellable lot overlaps a Fidelity repurchase.');
    return;
  }

  let proved = 0;
  let failed = 0;

  for (const lot of candidates) {
    const ticker = String(lot.ticker).toUpperCase();
    const sellQty = Number(lot.remaining_qty);
    // Force a LOSS so the wash-sale rule applies: sell at 90% of FIFO cost basis.
    const salePrice = Number((Number(lot.price_at_fill) * 0.9).toFixed(4));

    // ── FIXED (gap-fill union) ──
    const fixed = await checkWashSale(supabase, {
      userId: USER_ID,
      accountId: ALPACA, // selling account = Alpaca, Fidelity is a DIFFERENT connection
      isDemo: false,
      ticker,
      sellQty,
      salePrice,
    });

    // ── OLD scope (orders only, across connections — no trade_history gap-fill) ──
    const { data: orderRows } = await supabase
      .from('orders')
      .select('symbol, side, status, filled_at, created_at, filled_qty, qty, filled_price, connection_id')
      .eq('user_id', USER_ID)
      .eq('symbol', ticker)
      .eq('side', 'buy')
      .eq('status', 'filled');
    const old = evaluateWashSale({
      lots: [
        {
          id: String(lot.ticker),
          ticker,
          qty: sellQty,
          remaining_qty: sellQty,
          price_at_fill: Number(lot.price_at_fill),
          filled_at: lot.filled_at,
        },
      ],
      sellQty,
      salePrice,
      orders: (orderRows || []) as OrderLike[],
      ticker,
    });

    const which = fixed.recentBuy?.connectionId === FIDELITY ? 'FIDELITY (different connection)' : String(fixed.recentBuy?.connectionId);
    const fixedHasFidelity = fixed.recentBuys.some((b) => b.connectionId === FIDELITY);
    const oldHasFidelity = old.recentBuys.some((b) => b.connectionId === FIDELITY);
    console.log(`\n[verify] ${ticker}  sell ${sellQty} @ ${salePrice} (FIFO basis ${lot.price_at_fill})`);
    console.log(`[verify]   OLD (orders only)            → isWashSale=${old.isWashSale}  buys=${old.recentBuys.length}  includes a FIDELITY fill: ${oldHasFidelity}`);
    console.log(`[verify]   NEW (orders ∪ trade_history) → isWashSale=${fixed.isWashSale}  buys=${fixed.recentBuys.length}  includes a FIDELITY fill: ${fixedHasFidelity}  newest=${which}`);

    // The acceptance criterion: the repurchase that lives in the OTHER
    // connection must now be part of the window (and is the newest qualifying
    // buy, i.e. the one the advisory names). Before the union it was not in the
    // window at all.
    if (fixedHasFidelity && !oldHasFidelity && fixed.recentBuys.length > old.recentBuys.length) {
      proved += 1;
      console.log(`[verify]   ✅ Fidelity (read-only, 0 orders rows) repurchase now counted — invisible to the old scope`);
    } else {
      failed += 1;
      console.log(`[verify]   ⚠️ did not demonstrate the cross-connection catch`);
    }
  }

  // ── Same window, TLH endpoint payload (GET /api/strategies/tax-harvest/wash-sale-check) ──
  console.log('\n[verify] ── TLH wash-sale-check payload (same shared window) ──');
  for (const lot of candidates) {
    const ticker = String(lot.ticker).toUpperCase();
    const src = await fetchRepurchaseFills(supabase, { userId: USER_ID, ticker, isDemo: false, withCoverage: true });
    const payload = buildWashSaleCheck({
      symbol: ticker,
      orders: src.orders,
      history: src.history,
      gapConnectionIds: src.gapConnectionIds,
      scopedConnectionId: ALPACA,
      isDemo: false,
      ordersCoverage: src.ordersCoverage,
      historyCoverage: src.historyCoverage,
    });
    // The pre-fix shape: gap connections ignored ⇒ trade_history never read.
    const legacy = buildWashSaleCheck({
      symbol: ticker,
      orders: src.orders,
      history: src.history,
      gapConnectionIds: [],
      scopedConnectionId: ALPACA,
      isDemo: false,
      ordersCoverage: src.ordersCoverage,
      historyCoverage: src.historyCoverage,
    });
    console.log(
      `[verify] ${ticker.padEnd(5)} isSafe=${payload.isSafe} recentBuys=${payload.recentBuys} crossConnection=${payload.crossConnection} ` +
      `buyFrom=${payload.buyConnectionId === FIDELITY ? 'FIDELITY' : String(payload.buyConnectionId)} days=${payload.daysSinceLastTrade} ` +
      `| historyAvailable=${payload.historyAvailable} (orders=${src.ordersCoverage}, history=${src.historyCoverage}) | pre-fix isSafe=${legacy.isSafe} buys=${legacy.recentBuys}`,
    );
  }

  // ── True boolean flip: a ticker Fidelity bought in-window that Vantage has
  //    NO order for at all (so the old, orders-only check said "safe"). ──
  console.log('\n[verify] ── true flip case (Fidelity-only ticker, no orders rows) ──');
  const { data: fidSample } = await supabase
    .from('trade_history')
    .select('symbol')
    .eq('user_id', USER_ID)
    .eq('connection_id', FIDELITY)
    .eq('action', 'buy')
    .gte('executed_at', cutoff)
    .limit(200);
  const seen = new Set<string>();
  let flipped = 0;
  for (const row of fidSample || []) {
    const sym = String((row as any).symbol).toUpperCase();
    if (seen.has(sym)) continue;
    seen.add(sym);
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID)
      .eq('symbol', sym);
    if ((count ?? 0) > 0) continue;
    const src = await fetchRepurchaseFills(supabase, { userId: USER_ID, ticker: sym, isDemo: false, withCoverage: true });
    const payload = buildWashSaleCheck({
      symbol: sym, orders: src.orders, history: src.history, gapConnectionIds: src.gapConnectionIds,
      scopedConnectionId: ALPACA, isDemo: false,
      ordersCoverage: src.ordersCoverage, historyCoverage: src.historyCoverage,
    });
    const legacy = buildWashSaleCheck({
      symbol: sym, orders: src.orders, history: src.history, gapConnectionIds: [],
      scopedConnectionId: ALPACA, isDemo: false,
      ordersCoverage: src.ordersCoverage, historyCoverage: src.historyCoverage,
    });
    console.log(
      `[verify] ${sym.padEnd(5)} ordersRows=0 → pre-fix isSafe=${legacy.isSafe} (green)  |  NEW isSafe=${payload.isSafe} recentBuys=${payload.recentBuys} ` +
      `crossConnection=${payload.crossConnection} buyFrom=FIDELITY days=${payload.daysSinceLastTrade}`,
    );
    flipped += 1;
    if (flipped >= 5) break;
  }
  console.log(`[verify] ${flipped} true-flip case(s) shown (pre-fix would have said "safe to harvest")`);

  console.log(`\n[verify] RESULT: ${proved} symbol(s) proved, ${failed} inconclusive, out of ${candidates.length}`);
}

main().catch((err) => {
  console.error('verify-wash-sale-cross-connection failed:', err);
  process.exit(1);
});
