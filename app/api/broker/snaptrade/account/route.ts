// ─── GET /api/broker/snaptrade/account ────────────────────
// Returns aggregated account balances across all SnapTrade-
// connected brokerage accounts for the authenticated user.
//
// Dev mode (no SNAPTRADE_CLIENT_ID): returns synthetic
// data so the adapter can be tested end-to-end.

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

interface SnapTradeAccount {
  id: string;
  account_id?: string;
  name: string;
  number: string;
  broker_name: string;
  balance?: {
    equity: number;
    cash: number;
    buying_power: number;
    currency: string;
  };
}

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
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_broker_id, status')
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

  // ── Dev mode — return synthetic balance ─────────────────
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  if (!clientId) {
    const brokerName = conn.snaptrade_broker_id || 'broker';
    return NextResponse.json({
      equity: 101_779.14,
      cash: 12_345.67,
      buying_power: 12_345.67,
      status: 'ACTIVE',
      currency: 'USD',
      note: `Dev mode — synthetic balance for ${brokerName}`,
    });
  }

  // ── Production — call SnapTrade API ─────────────────────
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';
  const snaptradeUserId = conn.snaptrade_user_id || authUser.id;
  let snaptradeUserSecret = '';

  try {
    snaptradeUserSecret = conn.snaptrade_user_secret_encrypted
      ? decryptSnaptradeSecret(conn.snaptrade_user_secret_encrypted, authUser.id)
      : authUser.id; // Fallback for existing connections without stored secret
  } catch {
    snaptradeUserSecret = authUser.id;
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'clientId': clientId,
      'consumerKey': consumerKey,
    };

    // Get all accounts for this SnapTrade user
    const accountsRes = await fetch(
      `${SNAPTRADE_API}/accounts?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
      { headers },
    );

    if (!accountsRes.ok) {
      const errText = await accountsRes.text().catch(() => '');
      console.error('[SnapTrade Account] Accounts fetch failed:', accountsRes.status, errText);

      return NextResponse.json(
        { equity: 0, cash: 0, buying_power: 0, status: 'ACTIVE', currency: 'USD' },
      );
    }

    const accounts: SnapTradeAccount[] = await accountsRes.json();

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json(
        { equity: 0, cash: 0, buying_power: 0, status: 'ACTIVE', currency: 'USD' },
      );
    }

    // Aggregate balances across all accounts
    let totalEquity = 0;
    let totalCash = 0;
    let totalBuyingPower = 0;

    for (const account of accounts) {
      try {
        const balanceRes = await fetch(
          `${SNAPTRADE_API}/accounts/${account.id}/balances?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
          { headers },
        );

        if (balanceRes.ok) {
          const balance = await balanceRes.json();
          const bal = balance.data || balance;
          totalEquity += parseFloat(String(bal.equity || bal.total_value || 0));
          totalCash += parseFloat(String(bal.cash || 0));
          totalBuyingPower += parseFloat(String(bal.buying_power || bal.cash || 0));
        }
      } catch (balanceErr) {
        console.error(`[SnapTrade Account] Balance fetch failed for account ${account.id}:`, balanceErr);
      }
    }

    return NextResponse.json({
      equity: totalEquity,
      cash: totalCash,
      buying_power: totalBuyingPower,
      status: 'ACTIVE',
      currency: 'USD',
    });
  } catch (err) {
    console.error('[SnapTrade Account] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch SnapTrade account data' },
      { status: 502 },
    );
  }
}
