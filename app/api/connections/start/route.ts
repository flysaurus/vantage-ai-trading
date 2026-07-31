// ─── POST /api/connections/start ──────────────────────────────
// Initiates a broker connection via SnapTrade.
//
// Body: { brokerage_slug: string, connection_type?: "read" | "trade" | "trade-if-available" }

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
  try {
    return await handlePost(req);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack || err.message) : 'Unknown error';
    console.error('[connections/start] UNHANDLED CRASH:', detail.substring(0, 500));
    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 },
    );
  }
}

async function handlePost(req: NextRequest) {
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
    console.log('[connections/start] Fetching brokerages...');
    const brokers = await getAllowedBrokerages();
    console.log(`[connections/start] Got ${brokers.length} brokerages`);
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
    console.log(`[connections/start] Broker validated: ${brokerName}`);
  } catch (err) {
    console.error(
      '[connections/start] Failed to validate brokerage:',
      err instanceof Error ? err.stack || err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to validate brokerage. Try again.' },
      { status: 502 },
    );
  }

  // ── Build callback URL ──
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';
  const redirectUri = `${appUrl}/api/connections/callback`;
  console.log('[connections/start] Callback URL:', redirectUri);

  // ── Get or create SnapTrade user ──
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  console.log('[connections/start] Looking up existing SnapTrade user...');
  const { data: existingConn, error: lookupErr } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted, id')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .maybeSingle();

  if (lookupErr) {
    console.warn('[connections/start] DB lookup warning (non-fatal):', lookupErr.message);
  }

  let snapUserId: string;
  let snapUserSecret: string;

  try {
    console.log('[connections/start] Getting/creating SnapTrade user...');
    const result = await getOrCreateSnapTradeUser(
      authUser.id,
      existingConn?.snaptrade_user_id,
      existingConn?.snaptrade_user_secret_encrypted,
    );
    snapUserId = result.userId;
    snapUserSecret = result.userSecret;
    console.log('[connections/start] SnapTrade user ready, isNew:', result.isNew);
  } catch (err) {
    console.error(
      '[connections/start] SnapTrade user setup failed:',
      err instanceof Error ? err.stack || err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to set up SnapTrade user. Please try again.' },
      { status: 502 },
    );
  }

  // ── Store/update SnapTrade user in broker_connections ──
  let encryptedSecret: string;
  try {
    encryptedSecret = encryptUserSecret(authUser.id, snapUserSecret);
    console.log('[connections/start] User secret encrypted');
  } catch (err) {
    console.error(
      '[connections/start] Encryption failed:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to secure credentials. Please try again.' },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();

  if (existingConn?.id) {
    console.log('[connections/start] Updating existing connection row:', existingConn.id);
    const { error: updateErr } = await supabase
      .from('broker_connections')
      .update({
        snaptrade_user_id: snapUserId,
        snaptrade_user_secret_encrypted: encryptedSecret,
        brokerage_slug: brokerageSlug.toUpperCase(),
        status: 'pending',
        updated_at: now,
      })
      .eq('id', existingConn.id);
    if (updateErr) {
      console.warn('[connections/start] DB update warning (non-fatal):', updateErr.message);
    }
  } else {
    console.log('[connections/start] Inserting new connection row');
    const { error: insertErr } = await supabase
      .from('broker_connections')
      .insert({
        user_id: authUser.id,
        connection_type: 'snaptrade',
        snaptrade_user_id: snapUserId,
        snaptrade_user_secret_encrypted: encryptedSecret,
        brokerage_slug: brokerageSlug.toUpperCase(),
        status: 'pending',
      });
    if (insertErr) {
      console.warn('[connections/start] DB insert warning (non-fatal):', insertErr.message);
    }
  }

  // ─── Generate portal URL ──
  try {
    console.log('[connections/start] Generating portal URL for', brokerageSlug);
    const portalUrl = await generateConnectionPortalUrl(
      snapUserId,
      snapUserSecret,
      brokerageSlug.toUpperCase(),
      redirectUri,
      'trade-if-available',
    );
    console.log('[connections/start] Portal URL generated successfully');

    return NextResponse.json({
      success: true,
      redirectUrl: portalUrl,
      broker: {
        slug: brokerageSlug.toUpperCase(),
        name: brokerName,
        allowsTrading,
        connectionType: 'trade-if-available',
      },
    });
  } catch (err) {
    console.error(
      '[connections/start] Portal URL generation failed:',
      err instanceof Error ? err.stack || err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to generate connection portal. Please try again.' },
      { status: 502 },
    );
  }
}
