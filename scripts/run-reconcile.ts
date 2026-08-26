// ─── scripts/run-reconcile.ts — local/CI reconciliation runner ───
// Runs the SAME engine as GET /api/reconcile against live broker data.
// Requires the following env vars (sourced from a temp env file, never committed):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY, VAULT_ENCRYPTION_KEY
// Optional: RECONCILE_USER_ID, RECONCILE_CONNECTION_ID (broker_connections.id)
//
// Usage:  npx tsx scripts/run-reconcile.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { resolveSnapTradeCredentials } from '../lib/snaptrade/client';
import { runReconciliation } from '../lib/reconcile';

const USER_ID =
  process.env.RECONCILE_USER_ID || '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONNECTION_ID =
  process.env.RECONCILE_CONNECTION_ID || 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const creds = await resolveSnapTradeCredentials(USER_ID, CONNECTION_ID);

  const report = await runReconciliation({
    supabase,
    userId: USER_ID,
    connectionId: creds.connectionId,
    brokerConnectionId: creds.brokerConnectionId,
    brokerSlug: creds.brokerSlug,
    snaptradeUserId: creds.snaptradeUserId,
    snaptradeUserSecret: creds.snaptradeUserSecret,
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('Reconcile failed:', err);
  process.exit(1);
});
