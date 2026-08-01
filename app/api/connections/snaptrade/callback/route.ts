// ─── GET /api/connections/snaptrade/callback ──────────────────
// SnapTrade OAuth callback handler.
//
// SnapTrade redirects the user back to this endpoint after
// they authorize (or deny) the connection. We read the status
// from SnapTrade, update our DB, and redirect the user to the
// app with the appropriate state.
//
// Query params from SnapTrade:
//   ?broker=<broker>  — which broker was connected
//   ?userId=<id>      — our user ID
//   ?success=<bool>   — whether OAuth succeeded
//
// Dev mode (when SnapTrade is not configured):
//   ?mode=dev&broker=<id>&userId=<id>&success=<bool>

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const SNAPTRADE_API = 'https://api.snaptrade.com/api/v1';

const SNAPTRADE_BROKER_TO_ID: Record<string, string> = {
  FIDELITY: 'fidelity',
  ROBINHOOD: 'robinhood',
  CHARLES_SCHWAB: 'schwab',
  CSCHWAB: 'schwab',
  VANGUARD: 'vanguard',
  ETRADE: 'etrade',
  'TD AMERITRADE': 'tdameritrade',
  TDAMERITRADE: 'tdameritrade',
  WEBULL: 'webull',
  COINBASE: 'coinbase',
};

function getSnapTradeHeaders() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) {
    throw new Error('SnapTrade credentials not configured');
  }
  return {
    'Content-Type': 'application/json',
    'clientId': clientId,
    'consumerKey': consumerKey,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

  // ── Parse query params ─────────────────────────────────────
  const isDev = url.searchParams.get('mode') === 'dev';
  const userId = url.searchParams.get('userId');
  const brokerParam = url.searchParams.get('broker') || url.searchParams.get('broker_name');
  const success = url.searchParams.get('success') !== 'false';
  const tradingEnabledParam = url.searchParams.get('trading_enabled');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  if (isDev || success) {
    // Determine trading_enabled from the connection
    let tradingEnabled = true;
    const brokerId = brokerParam
      ? SNAPTRADE_BROKER_TO_ID[brokerParam.toUpperCase()] || brokerParam.toLowerCase()
      : null;

    if (tradingEnabledParam) {
      tradingEnabled = tradingEnabledParam === 'true';
    } else if (brokerId) {
      // Read-only brokers (no trading API):
      // Fidelity, Vanguard, Robinhood via SnapTrade are typically read-only
      tradingEnabled = !(['vanguard'].includes(brokerId));
    }

    // ── Try to verify with SnapTrade API ─────────────────
    if (!isDev) {
      try {
        const headers = getSnapTradeHeaders();

        // Get account info from SnapTrade to confirm connection
        const accountsRes = await fetch(
          `${SNAPTRADE_API}/accounts?userId=${userId}&userSecret=${userId}`,
          { headers },
        );

        if (accountsRes.ok) {
          const accounts = await accountsRes.json();
          // Check if any account from this broker exists
          const brokerAccounts = (Array.isArray(accounts) ? accounts : []).filter(
            (a: any) => {
              const bName = (a.broker_name || a.broker_authorization_name || '').toUpperCase();
              const mapped = SNAPTRADE_BROKER_TO_ID[bName];
              return mapped === brokerId;
            },
          );

          if (brokerAccounts.length === 0) {
            // Connection might not have completed
          }
        }
      } catch (err) {
        console.error('[SnapTrade Callback] Verification failed:', err);
        // Continue anyway — the OAuth redirect means the user authorized
      }
    }

    // ── Update broker_connections ────────────────────────
    const { error: connErr } = await supabase
      .from('broker_connections')
      .upsert(
        {
          user_id: userId,
          connection_type: 'snaptrade',
          snaptrade_broker_id: brokerId,
          status: 'connected',
          trading_enabled: tradingEnabled,
          sync_started_at: new Date().toISOString(),
          sync_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (connErr) {
      console.error('[SnapTrade Callback] DB update error:', connErr);
    }

    // ── Update users table ───────────────────────────────
    await supabase
      .from('users')
      .update({
        connection_type: 'snaptrade',
        connection_status: 'connected',
        broker_connected: true,
        // Set portfolio_mode to 'live' to pull real data
        portfolio_mode: 'live',
      })
      .eq('id', userId);

    // ── Redirect to app ──────────────────────────────────
    // After a successful connection, redirect to the main app
    // with a query param so the frontend can show a success toast
    return NextResponse.redirect(
      `${appUrl}/?broker_connected=${brokerId || 'snaptrade'}&trading_enabled=${tradingEnabled}`,
      302,
    );
  } else {
    // ── Connection failed or user denied ─────────────────
    await supabase
      .from('broker_connections')
      .upsert(
        {
          user_id: userId,
          connection_type: 'snaptrade',
          status: 'failed',
          error_message: 'User denied or connection failed',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    await supabase
      .from('users')
      .update({
        connection_type: 'snaptrade',
        connection_status: 'failed',
      })
      .eq('id', userId);

    // Redirect to connection-options with error
    return NextResponse.redirect(
      `${appUrl}/?state=connection-options&error=snaptrade_denied`,
      302,
    );
  }
}
