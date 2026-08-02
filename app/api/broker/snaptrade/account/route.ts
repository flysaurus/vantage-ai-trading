// ─── GET /api/broker/snaptrade/account ────────────────────
// Returns aggregated account balances across all SnapTrade-
// connected brokerage accounts for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SNAPTRADE_API = 'https://api.snaptrade.com/api/v1';
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

// DEBUG — tracks what happened during the request
interface DebugInfo {
  dbRowFound: boolean;
  hasSecretEncrypted: boolean;
  secretEncryptedLen: number | null;
  hasVAULT_KEY: boolean;
  hasCLIENT_ID: boolean;
  hasCONSUMER_KEY: boolean;
  decrypted: boolean;
  decryptedLen: number | null;
  decryptedPreview: string;
  apiAccountCount: number;
  apiAccountFailed: string | null;
  balanceFetches: { id: string; ok: boolean; equity: number }[];
  finalEquity: number;
}

export async function GET(_req: NextRequest) {
  const debug: DebugInfo = {
    dbRowFound: false,
    hasSecretEncrypted: false,
    secretEncryptedLen: null,
    hasVAULT_KEY: !!process.env.VAULT_ENCRYPTION_KEY,
    hasCLIENT_ID: !!process.env.SNAPTRADE_CLIENT_ID,
    hasCONSUMER_KEY: !!process.env.SNAPTRADE_CONSUMER_KEY,
    decrypted: false,
    decryptedLen: null,
    decryptedPreview: '',
    apiAccountCount: 0,
    apiAccountFailed: null,
    balanceFetches: [],
    finalEquity: 0,
  };

  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: conn, error: connErr } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_broker_id, status')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'connected')
    .single();

  debug.dbRowFound = !!conn && !connErr;

  if (connErr || !conn) {
    return NextResponse.json({
      error: 'No active SnapTrade connection found',
      _debug: debug,
    }, { status: 404 });
  }

  debug.hasSecretEncrypted = !!conn.snaptrade_user_secret_encrypted;
  debug.secretEncryptedLen = conn.snaptrade_user_secret_encrypted?.length ?? null;

  if (!debug.hasCLIENT_ID) {
    return NextResponse.json({
      equity: 101_779.14,
      cash: 12_345.67,
      buying_power: 12_345.67,
      status: 'ACTIVE',
      currency: 'USD',
      _debug: { ...debug, note: 'Dev mode — SNAPTRADE_CLIENT_ID not configured' },
    });
  }

  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';
  const snaptradeUserId = conn.snaptrade_user_id || authUser.id;
  let snaptradeUserSecret = '';

  try {
    if (conn.snaptrade_user_secret_encrypted) {
      snaptradeUserSecret = decryptSnaptradeSecret(conn.snaptrade_user_secret_encrypted, authUser.id);
      debug.decrypted = true;
      debug.decryptedLen = snaptradeUserSecret.length;
      debug.decryptedPreview = snaptradeUserSecret.substring(0, 12);
    } else {
      snaptradeUserSecret = authUser.id;
    }
  } catch {
    snaptradeUserSecret = authUser.id;
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'clientId': process.env.SNAPTRADE_CLIENT_ID!,
      'consumerKey': consumerKey,
    };

    const accountsRes = await fetch(
      `${SNAPTRADE_API}/accounts?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
      { headers },
    );

    if (!accountsRes.ok) {
      debug.apiAccountFailed = `status=${accountsRes.status}`;
      return NextResponse.json({
        equity: 0, cash: 0, buying_power: 0,
        status: 'ACTIVE', currency: 'USD',
        _debug: debug,
      });
    }

    const accounts: SnapTradeAccount[] = await accountsRes.json();
    debug.apiAccountCount = accounts.length;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json({
        equity: 0, cash: 0, buying_power: 0,
        status: 'ACTIVE', currency: 'USD',
        _debug: debug,
      });
    }

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
          const eq = parseFloat(String(bal.equity || bal.total_value || 0));
          totalEquity += eq;
          totalCash += parseFloat(String(bal.cash || 0));
          totalBuyingPower += parseFloat(String(bal.buying_power || bal.cash || 0));
          debug.balanceFetches.push({ id: account.id.substring(0, 8), ok: true, equity: eq });
        } else {
          debug.balanceFetches.push({ id: account.id.substring(0, 8), ok: false, equity: 0 });
        }
      } catch {
        debug.balanceFetches.push({ id: account.id.substring(0, 8), ok: false, equity: 0 });
      }
    }

    debug.finalEquity = totalEquity;
    return NextResponse.json({
      equity: totalEquity,
      cash: totalCash,
      buyingPower: totalBuyingPower,
      status: 'ACTIVE',
      currency: 'USD',
      _debug: debug,
    });
  } catch (err) {
    return NextResponse.json({
      error: 'Failed to fetch SnapTrade account data',
      _debug: debug,
    }, { status: 502 });
  }
}
