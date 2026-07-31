// ─── POST /api/connections/start ──────────────────────────────
// Initiates a broker connection via SnapTrade.
//
// Body: { brokerage_slug: string, connection_type?: "read" | "trade" | "trade-if-available" }
//
// Flow:
//   1. Authenticate user
//   2. Validate brokerage_slug against SnapTrade /partners
//   3. Get or create SnapTrade user (stored in broker_connections)
//   4. Generate Connection Portal URL
//   5. Return { redirectUrl } to client
//
// The client then redirects the user to the SnapTrade Connection Portal.
// After OAuth completes, SnapTrade redirects to /api/connections/callback.

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  getOrCreateSnapTradeUser,
  generateConnectionPortalUrl,
  encryptUserSecret,
} from '@/lib/snaptrade/client';
import { getAllowedBrokerages } from '@/lib/snaptrade/auth';

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  // ── Parse body ──
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const brokerageSlug = (body.brokerage_slug as string)?.trim();
  const connectionType =
    (body.connection_type as 'read' | 'trade' | 'trade-if-available') ||
    'trade-if-available';

  if (!brokerageSlug) {
    return NextResponse.json(
      { error: 'brokerage_slug is required' },
      { status: 400 },
    );
  }

  // ── Validate brokerage exists ──
  let brokerName: string;
  let allowsTrading: boolean;
  try {
    const brokers = await getAllowedBrokerages();
    const broker = brokers.find(
      (b) => b.slug.toUpperCase() === brokerageSlug.toUpperCase(),
    );

    if (!broker) {
      return NextResponse.json(
        {
          error: `Unknown brokerage: ${brokerageSlug}`,
          hint: 'Check /api/connections/snaptrade-brokerages for available options',
        },
        { status: 400 },
      );
    }

    brokerName = broker.displayName;
    allowsTrading = broker.allowsTrading;
  } catch (err) {
    console.error(
      '[connections/start] Failed to validate brokerage:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to validate brokerage. Try again.' },
      { status: 502 },
    );
  }

  // ── Build callback URL ──
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
  const redirectUri = `${origin}/api/connections/callback`;

  // ── Get or create SnapTrade user ──
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Check for existing SnapTrade user record
  const { data: existingConn } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted, id')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .maybeSingle();

  let snapUserId: string;
  let snapUserSecret: string;
  let isNew: boolean;

  try {
    const result = await getOrCreateSnapTradeUser(
      authUser.id,
      existingConn?.snaptrade_user_id,
      existingConn?.snaptrade_user_secret_encrypted,
    );
    snapUserId = result.userId;
    snapUserSecret = result.userSecret;
    isNew = result.isNew;
  } catch (err) {
    console.error(
      '[connections/start] SnapTrade user setup failed:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to set up SnapTrade user. Please try again.' },
      { status: 502 },
    );
  }

  // ── Store/update SnapTrade user in broker_connections ──
  const encryptedSecret = encryptUserSecret(authUser.id, snapUserSecret);
  const now = new Date().toISOString();

  if (existingConn?.id) {
    await supabase
      .from('broker_connections')
      .update({
        snaptrade_user_id: snapUserId,
        snaptrade_user_secret_encrypted: encryptedSecret,
        brokerage_slug: brokerageSlug.toUpperCase(),
        status: 'pending',
        updated_at: now,
      })
      .eq('id', existingConn.id);
  } else {
    await supabase.from('broker_connections').insert({
      user_id: authUser.id,
      connection_type: 'snaptrade',
      snaptrade_user_id: snapUserId,
      snaptrade_user_secret_encrypted: encryptedSecret,
      brokerage_slug: brokerageSlug.toUpperCase(),
      status: 'pending',
    });
  }

  // ─── Generate portal URL ──
  try {
    const portalUrl = await generateConnectionPortalUrl(
      snapUserId,
      snapUserSecret,
      brokerageSlug.toUpperCase(),
      redirectUri,
      connectionType,
    );

    return NextResponse.json({
      success: true,
      redirectUrl: portalUrl,
      broker: {
        slug: brokerageSlug.toUpperCase(),
        name: brokerName,
        allowsTrading,
        connectionType,
      },
    });
  } catch (err) {
    console.error(
      '[connections/start] Portal URL generation failed:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to generate connection portal. Please try again.' },
      { status: 502 },
    );
  }
}
