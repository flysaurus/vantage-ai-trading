// Direct trigger: processAllPendingOrders against Supabase
import { createClient } from '@supabase/supabase-js';
import { processAllPendingOrders } from '../lib/broker/order-processor';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Environment variables missing');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log('🚀 Running processAllPendingOrders directly...');
  const result = await processAllPendingOrders(supabase);
  console.log('\n📊 Result:');
  console.log(`  processedCount: ${result.processedCount}`);
  console.log(`  totalFilled: ${result.totalFilled}`);
  console.log(`  totalExpired: ${result.totalExpired}`);
  console.log(`  totalSkipped: ${result.totalSkipped}`);
  console.log(`  totalErrors: ${result.totalErrors}`);
  console.log(`  totalCashReleased: ${result.totalCashReleased}`);
  console.log('\n  perUser:');
  result.perUser.forEach(u => {
    console.log(`    ${u.userId?.substring(0,8)}...: filled=${u.filled} expired=${u.expired} skipped=${u.skipped} error=${!!u.error}`);
    if (u.fills) u.fills.forEach(f => console.log(`      ✅ ${f.side} ${f.shares} ${f.symbol} @ $${f.fillPrice}`));
    if (u.expirations) u.expirations.forEach(e => console.log(`      ⏰ EXPIRED: ${e.symbol}`));
    if (u.skips) u.skips.forEach(s => console.log(`      ⏭️  SKIP: ${s.symbol} — ${s.reason}`));
  });
  console.log('\n✅ Done!');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
