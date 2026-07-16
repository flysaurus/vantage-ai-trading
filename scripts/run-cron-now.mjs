// Direct trigger: runs processAllPendingOrders against Supabase now
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ixjnuoslbzytubpplkot.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Dynamic import doesn't work easily for TS, so query directly
async function run() {
  // Fetch all users with data in order_history
  const { data: rows, error } = await supabase
    .from('demo_portfolio_state')
    .select('user_id, positions, cash_balance, order_history, basket_orders');

  if (error) { console.error('Query error:', error.message); process.exit(1); }

  let totalFilled = 0, totalExpired = 0, totalSkipped = 0, totalErrors = 0, totalCashReleased = 0;
  const perUser = [];

  for (const row of rows || []) {
    const orders = (row.order_history || [])
      .map(o => ({ ...o, submittedAt: o.submittedAt || o.createdAt || o.submitted_at }));
    const openOrders = orders.filter(o => o.status === 'OPEN');
    if (openOrders.length === 0) continue;

    console.log(`\n🔍 User ${row.user_id?.substring(0,8)}... — ${openOrders.length} OPEN orders`);
    
    // Now we need the full fill logic. Instead of reimplementing, let's use the
    // dynamic import trick with TypeScript.
    
    // This approach is limited - let's just call the API endpoint instead
    console.log(`  → Needs processing via deployed API`);
  }

  console.log(`\n📊 Total: ${rows?.length || 0} users checked`);
  console.log('⚠️  Run the deployed API endpoint to process orders properly.');
}

run().catch(e => { console.error(e); process.exit(1); });
