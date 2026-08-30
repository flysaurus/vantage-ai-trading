// ─── POST /api/connections/snaptrade/init ───────────────────
// Initiate SnapTrade OAuth flow for a broker.
//
// Accepts either:
//   { broker_id: 'fidelity' }        (friendly id — legacy frontend callers)
//   { brokerage_slug: 'FIDELITY' }   (canonical SnapTrade slug)
//
// The friendly id is resolved to a real SnapTrade slug via a local alias map
// plus getAllowedBrokerages() fuzzy fallback (never a blind .toUpperCase()).
//
// This route was previously broken: it hit `/snap_trade/registerUser` and
// `/snap_trade/login` (wrong paths — SnapTrade uses camelCase `/snapTrade/...`)
// and sent clientId/consumerKey as headers instead of the required
// `Signature` HMAC + `clientId`/`timestamp` query params. SnapTrade answered
// those malformed calls with 405 Method Not Allowed — the exact "SnapTrade
// returned error 405" Em hit. It now delegates to the same correct client
// (`getOrCreateSnapTradeUser` + `generateConnectionPortalUrl`) as
// `/api/connections/start`.

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  getOrCreateSnapTradeUser,
  generateConnectionPortalUrl,
  encryptUserSecret,
} from '@/lib/snaptrade/client';
import { getAllowedBrokerages } from '@/lib/snaptrade/auth';

// Friendly id → canonical SnapTrade slug. Mirrors lib/broker-name.ts.
const BROKER_ALIASES: Record<string, string> = {
  fidelity: 'FIDELITY',
  robinhood: 'ROBINHOOD',
  schwab: 'SCHWAB',
  charles_schwab: 'SCHWAB',
  cschwab: 'SCHWAB',
  vanguard: 'VANGUARD',
  etrade: 'ETRADE',
  tdameritrade: 'TDAMERITRADE',
  tda: 'TDAMERITRADE',
  webull: 'WEBULL',
  coinbase: 'COINBASE',
  alpaca: 'ALPACA',
  'alpaca-paper': 'ALPACA-PAPER',
  alpaca_paper: 'ALPACA-PAPER',
  tastytrade: 'TASTYTRADE',
  ibkr: 'INTERACTIVEBROKERS',
  interactivebrokers: 'INTERACTIVEBROKERS',
  tradestation: 'TRADESTATION',
  ally: 'ALLY',
  public: 'PUBLIC',
  moomoo: 'MOOMOO',
};

/** Resolve a friendly broker id to a canonical SnapTrade slug (fuzzy fallback). */

// NOTE: resolution is inlined in POST below; BROKER_ALIASES covers the known
// friendly ids, and anything else falls back to getAllowedBrokerages().

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawId = (body.brokerage_slug as string) || (body.broker_id as string);
  if (!rawId || typeof rawId !== 'string' || !rawId.trim()) {
    return NextResponse.json(
      { error: 'broker_id (or brokerage_slug) is required' },
      { status: 400 },
    );
  }

  // If a canonical slug was passed, use it directly; else resolve the friendly id.
  let brokerSlug: string | null = BROKER_ALIASES[rawId.trim().toLowerCase()] || null;
  if (!brokerSlug) {
    try {
      const brokers = await getAllowedBrokerages();
      const upper = rawId.trim().toUpperCase();
      const bySlug = brokers.find((b) => b.slug.toUpperCase() === upper);
      brokerSlug = bySlug?.slug || null;
      if (!brokerSlug) {
        const key = rawId.trim().toLowerCase();
        const byName = brokers.find((b) => b.name.toUpperCase().includes(key.toUpperCase()));
        brokerSlug = byName?.slug || null;
      }
    } catch (err) {
      console.error('[snaptrade/init] broker resolution failed:', err);
      return NextResponse.json(
        { error: 'Failed to validate brokerage. Try again.' },
        { status: 502 },
      );
    }
  }

  if (!brokerSlug) {
    return NextResponse.json(
      { error: `Unknown brokerage: ${rawId}` },
      { status: 400 },
    );
  }

  // Resolve display name + trading capability from SnapTrade.
  let brokerName = brokerSlug;
  let allowsTrading = false;
  try {
    const brokers = await getAllowedBrokerages();
    const broker = brokers.find((b) => b.slug.toUpperCase() === brokerSlug!.toUpperCase());
    if (broker) {
      brokerName = broker.displayName;
      allowsTrading = broker.allowsTrading;
    }
  } catch {
    // Non-fatal — name/trading flag fall back to slug/defaults.
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';
  const callbackUrl = `${appUrl}/api/connections/callback`;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // The SnapTrade user is shared across ALL broker connections for a given
  // Vantage user (one SnapTrade user id per Vantage user). Grab its creds from
  // any existing snaptrade row — deterministically the oldest — so we never
  // `.maybeSingle()` the whole set (which breaks when 2+ brokers exist).
  const { data: snapUserConn } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Get/create the SnapTrade user + decrypt the secret.
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
    console.error('[snaptrade/init] SnapTrade user setup failed:', err);
    return NextResponse.json(
      { error: 'Failed to set up SnapTrade user. Please try again.' },
      { status: 502 },
    );
  }

  const encryptedSecret = encryptUserSecret(authUser.id, snapUserSecret);
  const now = new Date().toISOString();

  // Upsert by (user_id, brokerage_slug) — NEVER clobber an existing connected
  // broker with a different slug. The schema has a UNIQUE index on
  // (user_id, brokerage_slug), so each broker gets its own row. Connecting
  // Fidelity must not overwrite the Alpaca Paper row.
  const { data: existingBySlug } = await supabase
    .from('broker_connections')
    .select('id')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .eq('brokerage_slug', brokerSlug)
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
        brokerage_slug: brokerSlug,
        status: 'pending',
      });
  }

  // Generate the SnapTrade Connection Portal URL.
  try {
    const portalUrl = await generateConnectionPortalUrl(
      snapUserId,
      snapUserSecret,
      brokerSlug,
      callbackUrl,
      'trade-if-available',
    );

    return NextResponse.json({
      success: true,
      redirect_url: portalUrl,
      redirectUri: portalUrl,
      broker_id: brokerSlug.toLowerCase(),
      broker_slug: brokerSlug,
      broker_name: brokerName,
      allows_trading: allowsTrading,
    });
  } catch (err) {
    console.error('[snaptrade/init] Portal URL generation failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate connection portal. Please try again.' },
      { status: 502 },
    );
  }
}
