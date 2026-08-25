// One-off recovery: the "Critical Minerals Supply Chain - 08252026" basket
// (id 2f3f94ca-c766-49ab-b46d-0d2c99e3281e) placed successfully at the broker
// (Alpaca) but its `orders` rows were never persisted because the insert
// included `company_name`, a column that doesn't exist yet (migration 059 not
// applied). Result: stocks bought but no basket linkage → ungrouped positions.
//
// This script reconstructs the 6 filled `orders` + matching `position_lots`
// rows from the authoritative `positions` table (qty + avg_cost), linked to
// basket 2f3f94ca. Idempotent-ish: it skips symbols that already have a
// filled order for this basket. Run with the service-role key.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ixjnuoslbzytubpplkot.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BASKET_ID = '2f3f94ca-c766-49ab-b46d-0d2c99e3281e';
const SYMBOLS = ['MP', 'LAC', 'UUUU', 'ALB', 'CPER', 'NEM'];
// Fill time: between basket creation (16:26:08Z) and positions sync (16:26:57Z).
const FILLED_AT = '2026-08-25T16:26:40.000+00:00';

async function main() {
  // 1. Authoritative qty + avg cost from positions.
  const { data: positions, error: posErr } = await supabase
    .from('positions')
    .select('symbol, qty, avg_cost')
    .in('symbol', SYMBOLS);
  if (posErr) {
    console.error('positions read failed:', posErr.message);
    process.exit(1);
  }
  const bySymbol = new Map(
    (positions || []).map((p) => [p.symbol.toUpperCase(), p]),
  );

  // 2. Basket row (need user_id + connection_id).
  const { data: basket, error: basketErr } = await supabase
    .from('user_baskets')
    .select('id, user_id, connection_id')
    .eq('id', BASKET_ID)
    .single();
  if (basketErr || !basket) {
    console.error('basket read failed:', basketErr?.message);
    process.exit(1);
  }
  const userId = basket.user_id;
  const accountId = basket.connection_id;

  console.log(`Recovering basket ${BASKET_ID} (user ${userId})`);

  for (const sym of SYMBOLS) {
    const p = bySymbol.get(sym);
    if (!p) {
      console.warn(`⚠️  ${sym}: no position row — skipping`);
      continue;
    }
    const qty = Number(p.qty);
    const price = Number(p.avg_cost);
    const notional = Math.round(qty * price * 100) / 100;

    // Already recovered? skip if a filled order for this basket exists.
    const { data: existing } = await supabase
      .from('orders')
      .select('id')
      .eq('basket_id', BASKET_ID)
      .eq('symbol', sym)
      .eq('status', 'filled')
      .maybeSingle();
    if (existing) {
      console.log(`✓ ${sym}: already has filled order ${existing.id} — skip`);
      continue;
    }

    const orderId = randomUUID();
    const { error: orderErr } = await supabase.from('orders').insert({
      id: orderId,
      user_id: userId,
      connection_id: accountId,
      basket_id: BASKET_ID,
      symbol: sym,
      qty: 0,
      order_unit: 'dollars',
      requested_amount: notional,
      requested_qty: null,
      filled_qty: qty,
      side: 'buy',
      order_type: 'market',
      status: 'filled',
      filled_price: price,
      filled_at: FILLED_AT,
      time_in_force: 'day',
      is_demo: false,
      brokerage_order_id: null,
      source: 'manual',
      notional,
      created_at: FILLED_AT,
    });
    if (orderErr) {
      console.error(`✗ ${sym}: order insert failed:`, orderErr.message);
      continue;
    }

    const { error: lotErr } = await supabase.from('position_lots').insert({
      id: randomUUID(),
      user_id: userId,
      account_id: accountId,
      basket_id: BASKET_ID,
      ticker: sym,
      qty,
      remaining_qty: qty,
      price_at_fill: price,
      filled_at: FILLED_AT,
      source: 'vantage',
      order_id: orderId,
      origin_tag: 'basket_buy',
      created_at: new Date().toISOString(),
    });
    if (lotErr) {
      console.error(`✗ ${sym}: lot insert failed:`, lotErr.message);
      continue;
    }

    console.log(`✓ ${sym}: qty=${qty} price=${price} notional=${notional} → order ${orderId}`);
  }
}

main().then(() => console.log('done')).catch((e) => {
  console.error(e);
  process.exit(1);
});
