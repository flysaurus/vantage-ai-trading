// ─── POST /api/connections/start ──────────────────────────────
// Initiates a broker connection via SnapTrade.

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

  if (!brokerageSlug) {
    return NextResponse.json({ error: 'brokerage_slug is required' }, { status: 400 });
  }

  // ── Validate brokerage ──
  let brokerName: string;
  let allowsTrading: boolean;
  try {
    const brokers = await getAllowedBrokerages();
    const broker = brokers.find(
      (b) => b.slug.toUpperCase() === brokerageSlug.toUpperCase(),
    );
    if (!broker) {
      return NextResponse.json(
        { error: `Unknown brokerage: ${brokerageSlug}` },
        { status: 400 },
      );
    }
    brokerName = broker.displayName;
    allowsTrading = broker.allowsTrading;
  } catch (err) {
    console.error('[start] Broker validation failed:', err);
    return NextResponse.json(
      { error: 'Failed to validate brokerage. Try again.' },
      { status: 502 },
    );
  }

  // ── Callback URL ──
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';
  const redirectUri = `${appUrl}/api/connections/callback`;

  // ── Supabase ──
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: snapUserConn } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // ── Get/create SnapTrade user ──
  let snapUserId: string;
  let snapUserSecret: string;
  try {
    const result = await getOrCreateSnapTradeUser(
      authUser.id,
      snapUserConn?.snaptrade_user_id,
      snapUserConn?.snaptrade_user_secret_encrypted,
    );
    snapUserId = result.userId;
    snapUserSecret = result.userSecret;
  } catch (err) {
    console.error('[start] SnapTrade user setup failed:', err);
    return NextResponse.json(
      { error: 'Failed to set up SnapTrade user. Please try again.' },
      { status: 502 },
    );
  }

  // ── Store encrypted secret ──
  const encryptedSecret = encryptUserSecret(authUser.id, snapUserSecret);
  const now = new Date().toISOString();

  // Upsert by (user_id, brokerage_slug) — each broker gets its own row; never
  // clobber an existing connected broker with a different slug.
  const { data: existingBySlug } = await supabase
    .from('broker_connections')
    .select('id')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .eq('brokerage_slug', brokerageSlug.toUpperCase())
    .maybeSingle();

  if (existingBySlug?.id) {
    await supabase
      .from('broker_connections')
      .update({
        snaptrade_user_id: snapUserId,
        snaptrade_user_secret_encrypted: encryptedSecret,
        status: 'pending',
        updated_at: now,
      })
      .eq('id', existingBySlug.id);
  } else {
    await supabase
      .from('broker_connections')
      .insert({
        user_id: authUser.id,
        connection_type: 'snaptrade',
        snaptrade_user_id: snapUserId,
        snaptrade_user_secret_encrypted: encryptedSecret,
        brokerage_slug: brokerageSlug.toUpperCase(),
        status: 'pending',
      });
  }

  // ── Generate portal URL ──
  try {
    const portalUrl = await generateConnectionPortalUrl(
      snapUserId,
      snapUserSecret,
      brokerageSlug.toUpperCase(),
      redirectUri,
      'trade-if-available',
    );

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
    console.error('[start] Portal URL generation failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate connection portal. Please try again.' },
      { status: 502 },
    );
  }
}
