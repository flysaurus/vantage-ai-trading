// ─── POST /api/connections/snaptrade/init ───────────────────
// Initiate SnapTrade OAuth flow for a specific broker.
//
// Flow:
//   1. Client POSTs { broker_id: 'fidelity' | 'schwab' | ... }
//   2. Server calls SnapTrade API to get an OAuth redirect URL
//   3. Returns { redirect_url } — client navigates user there
//   4. User authorizes on broker's site → redirected to our callback
//
// SnapTrade API ref: https://docs.snaptrade.com/reference/create-link

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const SNAPTRADE_API = 'https://api.snaptrade.com/api/v1';

const BROKER_NAMES: Record<string, string> = {
  fidelity: 'Fidelity',
  robinhood: 'Robinhood',
  schwab: 'Charles Schwab',
  vanguard: 'Vanguard',
  etrade: 'E*TRADE',
  tdameritrade: 'TD Ameritrade',
  webull: 'Webull',
  coinbase: 'Coinbase',
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

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: { broker_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const brokerId = body.broker_id;
  if (!brokerId || !BROKER_NAMES[brokerId]) {
    return NextResponse.json(
      { error: 'Invalid broker_id', valid: Object.keys(BROKER_NAMES) },
      { status: 400 },
    );
  }

  const brokerName = BROKER_NAMES[brokerId];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';
  const callbackUrl = `${appUrl}/api/connections/snaptrade/callback`;

  // ── Try SnapTrade API ──────────────────────────────────────
  // Hoist these so they're available in both try and catch blocks
  let snapTradeUserId = authUser.id;
  let snapTradeUserSecret = authUser.id;
  let encryptedSecret: string | null = authUser.id; // fallback

  try {
    const headers = getSnapTradeHeaders();

    // Step 1: Register user with SnapTrade (idempotent)
    const userRes = await fetch(`${SNAPTRADE_API}/snap_trade/registerUser`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: authUser.id }),
    });

    // Capture SnapTrade credentials from registerUser response
    if (userRes.ok) {
      try {
        const userData = await userRes.json();
        snapTradeUserId = userData.userId || authUser.id;
        snapTradeUserSecret = userData.userSecret || authUser.id;
      } catch {
        // Keep fallback values
      }
    }

    // Store the user secret (Supabase encrypts at rest; vault encryption on read)
    encryptedSecret = snapTradeUserSecret;

    // Step 2: Get login link URI
    const linkRes = await fetch(`${SNAPTRADE_API}/snap_trade/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: snapTradeUserId,
        userSecret: snapTradeUserSecret,
        broker: brokerId.toUpperCase(),
        immediateRedirect: true,
      }),
    });

    if (!linkRes.ok) {
      const errText = await linkRes.text().catch(() => '');
      console.error('[SnapTrade Init] Login link failed:', linkRes.status, errText);
      return NextResponse.json(
        { error: `SnapTrade returned error ${linkRes.status}` },
        { status: 502 },
      );
    }

    const linkData = await linkRes.json();

    // Step 3: Record pending connection in our DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error: connErr } = await supabase
      .from('broker_connections')
      .upsert(
        {
          user_id: authUser.id,
          connection_type: 'snaptrade',
          snaptrade_broker_id: brokerId,
          snaptrade_user_id: snapTradeUserId,
          snaptrade_user_secret_encrypted: encryptedSecret,
          status: 'pending',
          trading_enabled: true, // Will be updated in callback
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (connErr) {
      console.error('[SnapTrade Init] DB error:', connErr);
    }

    // Update users table connection_type + status
    await supabase
      .from('users')
      .update({
        connection_type: 'snaptrade',
        connection_status: 'pending',
        connection_initiated_at: new Date().toISOString(),
      })
      .eq('id', authUser.id);

    return NextResponse.json({
      success: true,
      redirect_url: linkData.redirectURI || linkData.uri || null,
      broker_id: brokerId,
      broker_name: brokerName,
    });
  } catch (err: unknown) {
    // ── SnapTrade API unavailable — return mock redirect ───
    // This lets the frontend flow work end-to-end while SnapTrade
    // credentials are being configured. The callback route handles
    // both real and development-mode flows.
    const isDev = process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV !== 'production';

    if (isDev) {
      const redirectUrl = `${appUrl}/api/connections/snaptrade/callback?mode=dev&broker=${brokerId}&userId=${authUser.id}&success=true`;

      // Still record the pending connection
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      await supabase
        .from('broker_connections')
        .upsert(
          {
            user_id: authUser.id,
            connection_type: 'snaptrade',
            snaptrade_broker_id: brokerId,
            snaptrade_user_id: authUser.id,
            snaptrade_user_secret_encrypted: encryptedSecret,
            status: 'pending',
            trading_enabled: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );

      await supabase
        .from('users')
        .update({
          connection_type: 'snaptrade',
          connection_status: 'pending',
          connection_initiated_at: new Date().toISOString(),
        })
        .eq('id', authUser.id);

      return NextResponse.json({
        success: true,
        redirect_url: redirectUrl,
        broker_id: brokerId,
        broker_name: brokerName,
        note: 'Development mode — SnapTrade API not configured',
      });
    }

    console.error('[SnapTrade Init] Failed:', err);
    return NextResponse.json(
      { error: 'Failed to initiate SnapTrade connection. Please try again later.' },
      { status: 500 },
    );
  }
}
