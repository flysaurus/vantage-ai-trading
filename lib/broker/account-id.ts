// ═══════════════════════════════════════════════════════════════
// lib/broker/account-id.ts — Part B step 3b (WRITE-SIDE stamping)
//                              + Part B step 4 (READ-SIDE filter)
// ═══════════════════════════════════════════════════════════════
//
// READ SIDE (step 4, added after 077/078 + the first stamped syncs):
//   `resolveBrokerAccountReadFilter` decides whether a reader may narrow to a
//   single sub-account. Rule: only a connection with **2+ registered
//   accounts** needs the filter — a single-account connection's connection
//   scope IS the account scope, so its readers keep today's behaviour and
//   unstamped legacy rows stay readable. On a shared login with no usable
//   sub-account scope the reader must NOT fall back to the connection scope:
//   that is the summed book the original bug produced (item 2's rule — a
//   multi-account connection hides connection-level rows).
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

export type ReadAccountFilterReason =
  /** 2+ registered accounts and the scope named one that exists → FILTER. */
  | 'shared_login_account'
  /** 0–1 registered accounts: connection scope IS the account scope. */
  | 'single_account'
  /** 2+ registered accounts, but no usable sub-account scope → do not widen. */
  | 'shared_login_no_scope'
  /** broker_accounts could not be read → behave as before (connection scope). */
  | 'lookup_failed';

export interface ReadAccountFilter {
  /** When set, the reader MUST add `.eq('account_id', filterAccountId)`. */
  filterAccountId: string | null;
  /** How many sub-accounts the connection has registered (0 = none). */
  registeredAccounts: number;
  reason: ReadAccountFilterReason;
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
 * Decide whether a READ may narrow a connection's derived rows to one
 * sub-account (Part B step 4). Never throws; never infers an account.
 *
 * The lookup is deliberately NOT gated by BROKER_ACCOUNT_ID_WRITES: that flag
 * governs what the writers stamp, not what readers are allowed to trust.
 */
export async function resolveBrokerAccountReadFilter(
  supabase: SupabaseClient,
  scope: WriteAccountScope,
): Promise<ReadAccountFilter> {
  const { userId, connectionId, snapAccountId } = scope;
  const failed: ReadAccountFilter = {
    filterAccountId: null,
    registeredAccounts: 0,
    reason: 'lookup_failed',
  };
  if (!userId || !connectionId) return failed;

  try {
    const { data, error } = await (supabase as any)
      .from('broker_accounts')
      .select('id, snaptrade_account_id')
      .eq('connection_id', connectionId);
    if (error) return failed;

    const rows: any[] = Array.isArray(data) ? data : [];
    const registeredAccounts = rows.length;

    // One account (or none registered yet) — connection scope is not ambiguous.
    if (registeredAccounts < 2) {
      return { filterAccountId: null, registeredAccounts, reason: 'single_account' };
    }

    // Shared login: only an exact sub-account match may narrow the read.
    const match = snapAccountId
      ? rows.find((r) => r?.snaptrade_account_id === snapAccountId)
      : undefined;
    if (!match?.id) {
      return { filterAccountId: null, registeredAccounts, reason: 'shared_login_no_scope' };
    }
    return {
      filterAccountId: String(match.id),
      registeredAccounts,
      reason: 'shared_login_account',
    };
  } catch (err) {
    console.warn(
      '[account-id] read-scope lookup failed — using connection scope:',
      err instanceof Error ? err.message : err,
    );
    return failed;
  }
}

/**
 * Pure decision for the FIFO lot-ledger write scope (Part B).
 *
 * Shared by the sync-orders cron so "which account may a lot fill touch?" is
 * decided in ONE place, from the order row's own stamped `account_id`:
 *   • no connection (legacy/demo) or a failed lookup (`null`) → connection scope
 *   • 0–1 registered accounts → connection scope (single account IS the scope;
 *     protects legacy lots that predate stamping)
 *   • 2+ registered accounts + the order's account IS registered → that account
 *   • 2+ registered accounts + no usable account → `unavailable`: the caller
 *     must SKIP the lot write and warn, never post into the merged pool.
 */
export type LotScopeDecision =
  | { mode: 'account'; brokerAccountId: string }
  | { mode: 'connection' }
  | { mode: 'unavailable' };

export function decideLotScope(
  registeredAccountIds: string[] | null,
  orderAccountId: string | null,
  connectionId: string | null,
): LotScopeDecision {
  if (!connectionId) return { mode: 'connection' };
  if (!registeredAccountIds || registeredAccountIds.length <= 1) {
    return { mode: 'connection' };
  }
  if (orderAccountId && registeredAccountIds.includes(orderAccountId)) {
    return { mode: 'account', brokerAccountId: orderAccountId };
  }
  return { mode: 'unavailable' };
}

/**
 * Resolve `broker_accounts.id` for an ORDER row (Part B stamping).
 *
 * Same contract as `resolveBrokerAccountIdForWrite` — a thin, self-documenting
 * wrapper for the order-insert paths. `snapAccountId` MUST be the sub-account
 * the broker actually placed the order on (e.g. `OrderResult.accountId`), i.e.
 * part of the 1:1 request, never re-derived from the payload or the symbol.
 *
 * Returns null when the flag is off, the scope is incomplete, or no row
 * matches — the insert then omits `account_id` (NULL = not yet attributed).
 */
export async function resolveOrderAccountIdForWrite(
  supabase: SupabaseClient,
  scope: WriteAccountScope,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const id = await resolveBrokerAccountIdForWrite(supabase, scope, env);
  // Flag on + a named sub-account that has no registry row = a real data gap
  // (the order WOULD have been attributable). Surface it, never guess a sibling.
  if (!id && accountIdWritesEnabled(env) && scope.snapAccountId) {
    console.warn(
      `[account-id] no broker_accounts row for connection ${scope.connectionId} / account ${scope.snapAccountId} — order left unattributed`,
    );
  }
  return id;
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
