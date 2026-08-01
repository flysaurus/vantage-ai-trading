// ─── GET /api/broker/snaptrade/positions ──────────────────
// Returns aggregated positions across all SnapTrade-connected
// brokerage accounts for the authenticated user.
//
// Dev mode (no SNAPTRADE_PARTNER_CLIENT_ID): returns synthetic
// portfolio holdings so the adapter can be tested end-to-end.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SNAPTRADE_API = 'https://api.snaptrade.com/api/v1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

function deriveUserKey(userId: string): Buffer {
  const secret = process.env.VAULT_ENCRYPTION_KEY || 'dev-encryption-key-change-me';
  return crypto.createHash('sha256').update(userId + secret).digest();
}

function decryptSnaptradeSecret(encrypted: string, userId: string): string {
  const { encrypted: enc, iv, authTag } = JSON.parse(encrypted);
  const key = deriveUserKey(userId);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return decipher.update(enc, 'base64', 'utf8') + decipher.final('utf8');
}

interface SnapTradePosition {
  symbol: string;
  name?: string;
  description?: string;
  quantity: number;
  price: number;
  market_value: number;
  cost_basis: number;
  day_change: number;
  day_change_pct: number;
  total_pnl: number;
  total_pnl_pct: number;
  asset_type?: string;
  currency?: string;
}

// ─── Dev mode — realistic synthetic portfolio ────────────
const DEV_POSITIONS: SnapTradePosition[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', quantity: 50, price: 192.58, market_value: 9629.00, cost_basis: 8750.00, day_change: 85.50, day_change_pct: 0.89, total_pnl: 879.00, total_pnl_pct: 10.05, asset_type: 'stock' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', quantity: 30, price: 428.15, market_value: 12844.50, cost_basis: 11250.00, day_change: 42.90, day_change_pct: 0.33, total_pnl: 1594.50, total_pnl_pct: 14.17, asset_type: 'stock' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', quantity: 40, price: 121.44, market_value: 4857.60, cost_basis: 3800.00, day_change: -28.80, day_change_pct: -0.59, total_pnl: 1057.60, total_pnl_pct: 27.83, asset_type: 'stock' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', quantity: 25, price: 178.33, market_value: 4458.25, cost_basis: 4125.00, day_change: 18.75, day_change_pct: 0.42, total_pnl: 333.25, total_pnl_pct: 8.08, asset_type: 'stock' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', quantity: 35, price: 196.21, market_value: 6867.35, cost_basis: 6300.00, day_change: 52.50, day_change_pct: 0.77, total_pnl: 567.35, total_pnl_pct: 9.01, asset_type: 'stock' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', quantity: 20, price: 535.78, market_value: 10715.60, cost_basis: 9450.00, day_change: -21.40, day_change_pct: -0.20, total_pnl: 1265.60, total_pnl_pct: 13.39, asset_type: 'etf' },
  { symbol: 'TSLA', name: 'Tesla Inc.', quantity: 15, price: 248.50, market_value: 3727.50, cost_basis: 3300.00, day_change: 18.75, day_change_pct: 0.50, total_pnl: 427.50, total_pnl_pct: 12.95, asset_type: 'stock' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', quantity: 15, price: 478.62, market_value: 7179.30, cost_basis: 6300.00, day_change: 35.85, day_change_pct: 0.50, total_pnl: 879.30, total_pnl_pct: 13.96, asset_type: 'etf' },
];

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Get SnapTrade connection + credentials ──────────────
  const { data: conn, error: connErr } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret, snaptrade_broker_id, status')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'connected')
    .single();

  if (connErr || !conn) {
    return NextResponse.json(
      { error: 'No active SnapTrade connection found' },
      { status: 404 },
    );
  }

  // ── Dev mode — return synthetic portfolio ───────────────
  const clientId = process.env.SNAPTRADE_PARTNER_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(DEV_POSITIONS);
  }

  // ── Production — call SnapTrade API ─────────────────────
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';
  const snaptradeUserId = conn.snaptrade_user_id || authUser.id;
  let snaptradeUserSecret = '';

  try {
    snaptradeUserSecret = conn.snaptrade_user_secret
      ? decryptSnaptradeSecret(conn.snaptrade_user_secret, authUser.id)
      : authUser.id;
  } catch {
    snaptradeUserSecret = authUser.id;
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'clientId': clientId,
      'consumerKey': consumerKey,
    };

    // Get all accounts
    const accountsRes = await fetch(
      `${SNAPTRADE_API}/accounts?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
      { headers },
    );

    if (!accountsRes.ok) {
      const errText = await accountsRes.text().catch(() => '');
      console.error('[SnapTrade Positions] Accounts fetch failed:', accountsRes.status, errText);
      return NextResponse.json([]);
    }

    const accounts = await accountsRes.json();

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json([]);
    }

    // Aggregate positions across all accounts
    const allPositions: SnapTradePosition[] = [];

    for (const account of accounts) {
      try {
        const posRes = await fetch(
          `${SNAPTRADE_API}/accounts/${account.id}/positions?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
          { headers },
        );

        if (posRes.ok) {
          const rawPositions: SnapTradePosition[] = await posRes.json();
          if (Array.isArray(rawPositions)) {
            allPositions.push(...rawPositions);
          }
        }
      } catch (posErr) {
        console.error(`[SnapTrade Positions] Fetch failed for account ${account.id}:`, posErr);
      }
    }

    return NextResponse.json(allPositions);
  } catch (err) {
    console.error('[SnapTrade Positions] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch SnapTrade positions' },
      { status: 502 },
    );
  }
}
