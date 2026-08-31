// ─── GET /api/connections/callback ────────────────────────────
// Handles the redirect from SnapTrade after the user completes
// brokerage OAuth in the Connection Portal.
//
// SnapTrade redirects here with: ?success=true (or ?success=false)
//
// Flow:
//   1. Check success parameter
//   2. Authenticate user via Supabase session
//   3. Look up their SnapTrade credentials from broker_connections
//   4. List connections to find the newly created one
//   5. Verify trading capability from the actual connection (don't assume)
//   6. List accounts for the connection
//   7. Store everything in broker_connections
//   8. Redirect user back to the app with status params

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateSnapTradeUser, listConnections, listAccounts } from '@/lib/snaptrade/client';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const success = url.searchParams.get('success');

  // ── Failure from SnapTrade ──
  if (success === 'false') {
    const error = url.searchParams.get('error') || 'Connection was not completed';
    console.warn('[connections/callback] SnapTrade reported failure:', error);

    // Redirect back to broker setup with error
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
    return NextResponse.redirect(
      new URL(`/broker-setup?error=${encodeURIComponent(error)}`, appUrl),
    );
  }

  // ── Authenticate user ──
  const { authUser, authError } = await requireAuth();
  if (authError) {
    // User not authenticated — redirect to broker setup with auth error
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
    return NextResponse.redirect(
      new URL('/broker-setup?error=Authentication+required', appUrl),
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Look up the pending SnapTrade connection ──
  // A user can have multiple broker rows (one per brokerage_slug). Pick the
  // MOST RECENTLY initiated pending row deterministically (never `.maybeSingle()`
  // over the whole set, which breaks when 2+ brokers exist).
  const { data: conn } = await supabase
    .from('broker_connections')
    .select('*')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'pending')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conn?.snaptrade_user_id || !conn?.snaptrade_user_secret_encrypted) {
    console.error('[connections/callback] No pending SnapTrade connection found');
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
    return NextResponse.redirect(
      new URL('/broker-setup?error=No+pending+connection+found', appUrl),
    );
  }

  // ── Decrypt user secret ──
  let snapUserSecret: string;
  try {
    const result = await getOrCreateSnapTradeUser(
      authUser.id,
      conn.snaptrade_user_id,
      conn.snaptrade_user_secret_encrypted,
    );
    snapUserSecret = result.userSecret;
  } catch (err) {
    console.error(
      '[connections/callback] Failed to decrypt SnapTrade secret:',
      err instanceof Error ? err.message : 'Unknown',
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
    return NextResponse.redirect(
      new URL('/broker-setup?error=Failed+to+verify+identity', appUrl),
    );
  }

  // ── Find the newly created connection ──
  try {
    const connections = await listConnections(conn.snaptrade_user_id, snapUserSecret);

    if (!connections || connections.length === 0) {
      console.error('[connections/callback] No connections found after OAuth');
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
      return NextResponse.redirect(
        new URL('/broker-setup?error=Connection+not+found+after+authorization', appUrl),
      );
    }

    // ── Match the newly created connection to the broker being connected ──
    // A user can hold multiple SnapTrade connections (Alpaca Paper + Robinhood,
    // etc.). Blindly picking the globally-newest connection is the exact bug that
    // overwrote the Alpaca Paper row with a Robinhood read connection: it must
    // match the pending row's brokerage_slug.
    const targetSlug = (conn.brokerage_slug || '').toUpperCase();
    const matches = connections.filter(
      (c) => (c.brokerage?.slug || '').toUpperCase() === targetSlug,
    );
    if (matches.length === 0) {
      console.error(
        `[connections/callback] No connection found for broker slug "${targetSlug}" after OAuth; available slugs: ${
          connections.map((c) => c.brokerage?.slug).join(', ')
        }`,
      );
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
      return NextResponse.redirect(
        new URL(
          `/broker-setup?error=${encodeURIComponent('Connection did not match the requested broker. Please try again.')}`,
          appUrl,
        ),
      );
    }
    // Most recent matching connection (the one just created for this broker)
    const latest = matches.reduce((a, b) =>
      new Date(a.created_date) > new Date(b.created_date) ? a : b,
    );

    // ── Verify trading capability (from actual connection, not assumption) ──
    // Authoritative signal = the connection's own `type` ("trade"|"read")
    // combined with the brokerage's `allows_trading` ceiling. Never a hardcoded
    // broker-name list: a broker that supports trading can still be connected
    // read-only (and vice-versa). Fail closed: if we can't confirm both, treat
    // as read-only.
    const brokerSlug = latest.brokerage.slug || conn.brokerage_slug;
    const tradingEnabled =
      latest.type === 'trade' && latest.brokerage?.allows_trading === true;

    // ── List accounts ──
    let accountsList: Array<Record<string, unknown>> = [];
    try {
      const accounts = await listAccounts(latest.id, conn.snaptrade_user_id, snapUserSecret);
      accountsList = accounts.map((a) => ({
        id: a.id,
        number: a.number,
        name: a.name,
        type: a.type,
        currency: a.currency,
        cash: a.cash,
        buyingPower: a.buying_power,
        totalValue: a.total_value,
      }));
    } catch (acctErr) {
      console.warn(
        '[connections/callback] Failed to list accounts (non-fatal):',
        acctErr instanceof Error ? acctErr.message : 'Unknown',
      );
    }

    // ── Store connection in DB ──
    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('broker_connections')
      .update({
        snaptrade_connection_id: latest.id,
        trading_enabled: tradingEnabled,
        snaptrade_accounts: accountsList,
        status: 'connected',
        sync_started_at: now,
        sync_completed_at: now,
        brokerage_slug: brokerSlug,
        error_message: null,
      })
      .eq('id', conn.id);

    if (updateErr) {
      console.error(
        '[connections/callback] Failed to store connection:',
        updateErr.message,
      );
    }

    // ── Also update users table for quick status checks ──
    await supabase
      .from('users')
      .update({
        connection_type: 'snaptrade',
        connection_status: 'connected',
        connection_initiated_at: conn.created_at || now,
      })
      .eq('id', authUser.id);

    // ── Redirect to broker setup with success ──
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
    const params = new URLSearchParams({
      connected: 'true',
      broker: brokerSlug,
      trading: tradingEnabled ? 'true' : 'false',
      accounts: String(accountsList.length),
    });
    return NextResponse.redirect(new URL(`/broker-setup?${params}`, appUrl));
  } catch (err) {
    console.error(
      '[connections/callback] Connection verification failed:',
      err instanceof Error ? err.message : 'Unknown',
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '/';
    return NextResponse.redirect(
      new URL(
        `/broker-setup?error=${encodeURIComponent('Failed to verify connection. Please try again.')}`,
        appUrl,
      ),
    );
  }
}
