// ─── SnapTrade Auth Diagnostic ───────────────────────────────
// GET /api/debug/snaptrade-auth
//
// Tests all candidate userId/userSecret combos to find which one
// actually authenticates for the user's Alpaca connection.
//
// Root cause hypothesis:
//   Route 2 (/api/connections/snaptrade/init) stores the userSecret
//   as RAW PLAINTEXT ("Supabase encrypts at rest; vault encryption on read"
//   but NEVER calls encryptUserSecret()). When broker-factory loads it,
//   getOrCreateSnapTradeUser → decryptData(rawPlaintext) → FAILS →
//   falls through to registerSnapTradeUser(vantage_xxx) → NEW user
//   with NO connections → 401.
//
//   Route 1 (/api/connections/start) properly encrypts via encryptUserSecret().

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import { registerSnapTradeUser } from '@/lib/snaptrade/client';
import { decryptDataCompat } from '@/lib/vault';

async function testPair(
  label: string,
  userId: string,
  userSecret: string,
): Promise<{
  label: string;
  userId: string;
  userSecret_preview: string;
  status: number;
  connections?: unknown[];
  error?: string;
}> {
  try {
    const result = await snapTradeFetch<unknown[]>(
      '/authorizations',
      null,
      { userId, userSecret },
    );
    return {
      label, userId,
      userSecret_preview: userSecret.slice(0, 8) + '…',
      status: 200,
      connections: result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const m = msg.match(/SnapTrade API (\d+)/);
    return {
      label, userId,
      userSecret_preview: userSecret.slice(0, 8) + '…',
      status: m ? +m[1] : 0,
      error: msg,
    };
  }
}

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const vantageUserId = authUser!.id;
  const supabase = createServerClient();

  const results: Record<string, unknown> = {
    vantage_user_id: vantageUserId,
    tests: [],
    summary: null,
  };

  // Load stored credentials
  const { data: rawConn, error: connErr } = await supabase
    .from('broker_connections')
    .select('id, snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_connection_id, brokerage_slug, status')
    .eq('user_id', vantageUserId)
    .eq('connection_type', 'snaptrade')
    .maybeSingle();
  const conn = rawConn as Record<string, string | null> | null;

  const c = conn as any;
  results.stored_row = {
    found: !!conn,
    db_error: connErr?.message ?? null,
    snaptrade_user_id: c?.snaptrade_user_id ?? null,
    has_encrypted_secret: !!c?.snaptrade_user_secret_encrypted,
    encrypted_secret_len: c?.snaptrade_user_secret_encrypted?.length ?? null,
    encrypted_secret_preview: c?.snaptrade_user_secret_encrypted?.slice(0, 24) ?? null,
    connection_id: c?.snaptrade_connection_id ?? null,
    brokerage_slug: c?.brokerage_slug ?? null,
    status: c?.status ?? null,
  };

  if (!c?.snaptrade_user_id || !c?.snaptrade_user_secret_encrypted) {
    results.diagnosis = 'NO_CREDENTIALS — No stored SnapTrade credentials found';
    return NextResponse.json(results);
  }

  const storedUserId = c.snaptrade_user_id;
  const storedSecretRaw = c.snaptrade_user_secret_encrypted; // may be plaintext or encrypted!
  const tests: unknown[] = [];

  // ── A: stored userId + raw stored value (treat as plaintext) ──
  const a = await testPair('A_raw_stored_value', storedUserId, storedSecretRaw);
  tests.push(a);

  // ── B: stored userId + decrypted stored value (treat as encrypted) ──
  try {
    const decrypted = decryptDataCompat(storedSecretRaw, vantageUserId);
    const b = await testPair('B_decrypted_stored', storedUserId, decrypted);
    tests.push(b);
  } catch (e) {
    tests.push({ label: 'B_decrypted_stored', status: 'DECRYPT_FAILED', error: e instanceof Error ? e.message : String(e) });
  }

  // ── C: unprefixed userId (strip vantage_) + raw secret ──
  if (storedUserId.startsWith('vantage_')) {
    const u = storedUserId.replace(/^vantage_/, '');
    tests.push(await testPair('C_unprefixed_raw', u, storedSecretRaw));
    tests.push(await testPair('C_vantage_uuid_raw', vantageUserId, storedSecretRaw));
  }

  // ── D: Route 2 pattern — raw UUID stored, try vantage_ prefix ──
  if (!storedUserId.startsWith('vantage_')) {
    tests.push(await testPair('D_vantage_prefixed_raw', `vantage_${storedUserId}`, storedSecretRaw));
  }

  // ── E: fresh registration ──────────────────────────────────
  try {
    const nu = await registerSnapTradeUser(vantageUserId);
    tests.push(await testPair('E_fresh_registration', nu.userId, nu.userSecret));
  } catch (e) {
    tests.push({ label: 'E_fresh_registration', status: 'FAILED', error: e instanceof Error ? e.message : String(e) });
  }

  results.tests = tests;

  // ── Summary ───────────────────────────────────────────────
  const successes = tests.filter((t: any) => t.status === 200);
  const withConn = successes.filter((t: any) => t.connections?.length > 0);

  if (withConn.length > 0) {
    const w = withConn[0] as any;
    results.summary = { diagnosis: 'WORKING_COMBO_FOUND', label: w.label, userId: w.userId, connection_count: w.connections.length };

    if (w.label === 'A_raw_stored_value') {
      results.fix = 'ENCRYPTION_MISMATCH — Secret stored as plaintext but broker-factory calls decryptData(). Fix: re-encrypt with encryptUserSecret() and store, OR fix broker-factory to detect plaintext.';
    } else if (w.label === 'B_decrypted_stored') {
      results.fix = 'OK — stored credentials are correct. 401 comes from elsewhere.';
    } else {
      results.fix = `USERID_MISMATCH — Update snaptrade_user_id from "${storedUserId}" to "${w.userId}".`;
    }
  } else if (successes.length > 0) {
    results.summary = { diagnosis: 'AUTH_OK_NO_CONNECTIONS', note: 'Creds authenticate but no connections — connection bound to different SnapTrade user. Re-do OAuth flow.' };
  } else {
    results.summary = { diagnosis: 'ALL_FAILED', note: 'Verify SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY are valid.' };
  }

  return NextResponse.json(results);
}
