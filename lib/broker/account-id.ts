// ═══════════════════════════════════════════════════════════════
// lib/broker/account-id.ts — Part B step 3b (WRITE-SIDE stamping)
// ═══════════════════════════════════════════════════════════════
//
// Stamps `account_id` (positions / orders / trade_history) and
// `broker_account_id` (position_lots) at WRITE time, so derived rows stop
// being connection-scoped the moment they are created. Backfill cannot fix
// the legacy rows (they carry no per-row account discriminator — see
// docs/part-b-account-model-migration.md §4), so this is the only path by
// which coverage can ever improve.
//
// ⚠️ INERT BY DEFAULT. Nothing is stamped until BROKER_ACCOUNT_ID_WRITES=1.
//    With the flag unset every helper here returns null and performs ZERO
//    database work, so the write paths behave exactly as they do today.
//
// 🔒 Sourcing rule (Em's decision): the account is resolved from the SAME
//    active-account context the READ path already uses — the
//    `snapAccountId` that scopes `scopedUrl()` — never re-derived from the
//    payload, the position symbol, the account name, or any other guess.
//    No snapAccountId (or no matching broker_accounts row) ⇒ null, i.e.
//    "not yet attributed". A row is never attributed on a maybe.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Feature flag gating all write-side account stamping. */
export const ACCOUNT_ID_WRITES_ENV = 'BROKER_ACCOUNT_ID_WRITES';

/** True only when the stamping flag is explicitly on. */
export function accountIdWritesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[ACCOUNT_ID_WRITES_ENV] === '1';
}

export interface WriteAccountScope {
  /** The user who owns the rows. Part of the lookup key — never inferred. */
  userId: string | null | undefined;
  /** broker_connections.id of the active account. */
  connectionId: string | null | undefined;
  /** SnapTrade sub-account id of the active account (the read path's scope). */
  snapAccountId: string | null | undefined;
}

/** Per-process memo so a sync of N rows costs one lookup, not N. */
const cache = new Map<string, string | null>();

/** Test seam — clears the lookup memo. */
export function __clearAccountIdCache(): void {
  cache.clear();
}

/**
 * Resolve `broker_accounts.id` for a write.
 *
 * Returns null — and issues no query — when:
 *   • the flag is off (default), or
 *   • the resolved scope is incomplete (no userId / connectionId / snapAccountId), or
 *   • no broker_accounts row matches the exact (connection, account) pair, or
 *   • the lookup errors (a failed lookup must never block a write).
 *
 * Never throws. Never infers.
 */
export async function resolveBrokerAccountIdForWrite(
  supabase: SupabaseClient,
  scope: WriteAccountScope,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (!accountIdWritesEnabled(env)) return null;

  const { userId, connectionId, snapAccountId } = scope;
  if (!userId || !connectionId || !snapAccountId) return null;

  const key = `${userId}:${connectionId}:${snapAccountId}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const { data, error } = await (supabase as any)
      .from('broker_accounts')
      .select('id')
      .eq('connection_id', connectionId)
      .eq('snaptrade_account_id', snapAccountId)
      .maybeSingle();

    if (error || !data?.id) {
      cache.set(key, null);
      return null;
    }
    const id = String(data.id);
    cache.set(key, id);
    return id;
  } catch (err) {
    console.warn(
      '[account-id] lookup failed — leaving rows unattributed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
