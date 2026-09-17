// ─── GET /api/connections ─────────────────────────────────────
// Returns all connections for the authenticated user.
// DELETE /api/connections/[id] handles disconnects.
//
// ENUMERATION vs VALUES.
//
// `accountCount` and `accounts[]` used to be read straight off the
// connect-time `snaptrade_accounts` JSONB snapshot — an artifact written once
// in the connect callback and never updated. That is stale by construction: a
// sub-account added (or removed) later is invisible, and the snapshot is the
// same class of bug as the snapshot-cash fabrication (see `0f55682`).
//
// So enumeration is registry-first, via the shared `enumerateConnectionAccounts`
// helper used by GET /api/accounts:
//   • `broker_accounts` rows exist → they ARE the enumeration (never widened);
//   • no rows yet → legacy connection-level behaviour (snapshot / single entry).
// Values are a separate axis and follow the same helper: the snapshot is only a
// value fallback, and each entry carries `valueSource` ('live' | 'snapshot' |
// 'unknown') plus `null` for anything unverifiable — never a fabricated 0.
//
// No SnapTrade network call is made here: this is the light connection list, and
// the registry already answers "which accounts exist". Live balances live in
// GET /api/accounts (which does fetch them).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import {
  enumerateConnectionAccounts,
  type LegacySnapAccount,
  type RegisteredAccountRow,
} from '@/lib/broker/account-enumeration';
import { NextResponse } from 'next/server';

export async function GET() {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: connections, error } = await supabase
    .from('broker_connections')
    .select(`
      id,
      connection_type,
      brokerage_slug,
      trading_enabled,
      status,
      snaptrade_connection_id,
      snaptrade_accounts,
      created_at,
      updated_at,
      sync_completed_at,
      error_message
    `)
    .eq('user_id', authUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[connections] Fetch error:', error.message);
    return NextResponse.json({ error: 'Failed to load connections' }, { status: 500 });
  }

  const rows = connections || [];

  // ── Registry lookup (the enumeration source) ──
  let registry: RegisteredAccountRow[] = [];
  let registryError: string | null = null;
  const connectionIds = rows.map((c) => c.id);
  if (connectionIds.length > 0) {
    const { data: acctRows, error: acctErr } = await supabase
      .from('broker_accounts')
      .select('id, connection_id, snaptrade_account_id, name, status')
      .in('connection_id', connectionIds);
    if (acctErr) {
      // Registry unavailable ⇒ legacy enumeration for every connection (the
      // snapshot path), which is exactly the pre-Part-B behaviour. Degraded, but
      // never widened or invented.
      registryError = acctErr.message;
      console.error('[connections] Registry lookup failed (using stored snapshot):', acctErr.message);
    } else {
      registry = (acctRows ?? []) as RegisteredAccountRow[];
    }
  }

  // Strip sensitive fields before returning to client
  const sanitized = rows.map((c) => {
    const snapshot: LegacySnapAccount[] = Array.isArray(c.snaptrade_accounts)
      ? (c.snaptrade_accounts as LegacySnapAccount[])
      : [];
    const registered = registry.filter((r) => r.connection_id === c.id);
    const enumerated = enumerateConnectionAccounts({
      registered,
      live: null,
      snapshot,
      brokerName: mapSlugToName(c.brokerage_slug),
    });

    return {
      id: c.id,
      connection_type: c.connection_type,
      brokerage_slug: c.brokerage_slug,
      trading_enabled: c.trading_enabled,
      status: c.status,
      snaptrade_connection_id: c.snaptrade_connection_id,
      accounts: enumerated.map((a) => ({
        /** Deprecated alias — prefer `snapAccountId` (same value). */
        id: a.snapAccountId,
        snapAccountId: a.snapAccountId,
        brokerAccountId: a.brokerAccountId,
        name: a.name,
        totalValue: a.totalValue,
        cash: a.cash,
        buyingPower: a.buyingPower,
        valueSource: a.valueSource,
      })),
      accountCount: enumerated.length,
      /**
       * Where the enumeration came from: 'registry' (broker_accounts rows),
       * 'snapshot' (legacy connect-time artifact — no registry rows yet), or
       * 'none' (nothing to enumerate from). Honest about a degraded read.
       */
      accountsSource:
        registered.length > 0 ? 'registry' : snapshot.length > 0 ? 'snapshot' : 'none',
      created_at: c.created_at,
      updated_at: c.updated_at,
      last_synced: c.sync_completed_at,
      error: c.error_message,
    };
  });

  return NextResponse.json({ connections: sanitized });
}

function mapSlugToName(slug: string): string {
  const map: Record<string, string> = {
    'ALPACA-PAPER': 'Alpaca Paper',
    ALPACA: 'Alpaca',
    FIDELITY: 'Fidelity',
    TASTYTRADE: 'Tastytrade',
    ETRADE: 'E*TRADE',
    WEBULL: 'Webull',
    PUBLIC: 'Public',
    MOOMOO: 'Moomoo',
    IBKR: 'Interactive Brokers',
    SCHWAB: 'Charles Schwab',
    ROBINHOOD: 'Robinhood',
  };
  return map[slug] || slug;
}
