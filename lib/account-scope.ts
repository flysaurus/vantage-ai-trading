// ─── Account Scope ─────────────────────────────────────────
// Shared helpers for threading account identity through data writes/reads.
//
// The app's canonical account id (AccountContext.activeAccountId) is one of:
//   - 'demo'                                     → the demo / paper portfolio
//   - 'snaptrade:<connectionId>'                 → a live/paper broker connection
//   - 'snaptrade:<connectionId>:<snapAccountId>' → ONE SnapTrade sub-account
//
// A single broker connection can expose SEVERAL sub-accounts (e.g. Fidelity
// "Taxable SMA" + "ANIKET - YOUTH"). Those are distinct accounts and must be
// enumerated/switched separately, with NO balance merging. The 3-part id is the
// distinct-identity form; the 2-part form is the legacy connection-level id
// (still accepted on read so stored values / older rows keep working).
//
// Data tables that represent account-specific state (positions, orders,
// trade_history, position_lots, strategies, user_baskets, chat_messages,
// daily_briefs, weekly_snapshots) must carry BOTH user_id AND one of:
//   - connection_id (broker_connections.id) for live/paper rows, OR
//   - is_demo = true for demo rows.
// NOTE: those tables are still keyed at CONNECTION granularity; per-sub-account
// data separation (a `snaptrade_account_id` column) is a follow-up migration.
//
// This module is the single place that converts between the human-facing
// account id and the DB scope tuple, so the mapping can never drift.
// ─────────────────────────────────────────────────────────────

export interface AccountScope {
  /** true → demo portfolio; false → live/paper broker account. */
  isDemo: boolean;
  /** broker_connections.id when !isDemo, otherwise null. */
  connectionId: string | null;
  /** SnapTrade sub-account id when the account id named a specific one, else null/absent. */
  snapAccountId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse an account id into its scope tuple.
 * Returns null for unrecognized/empty input (callers should treat null as
 * "no scope supplied" and fall back to their legacy behavior).
 */
export function parseAccountScope(accountId: string | null | undefined): AccountScope | null {
  if (!accountId || typeof accountId !== 'string') return null;
  const id = accountId.trim();
  if (id === 'demo') return { isDemo: true, connectionId: null, snapAccountId: null };
  if (id.toLowerCase().startsWith('snaptrade:')) {
    const rest = id.slice('snaptrade:'.length);
    // 3-part form names one sub-account: <connectionId>:<snapAccountId>.
    const [connId, snapAcctId] = rest.split(':');
    if (!UUID_RE.test(connId)) return null;
    return {
      isDemo: false,
      connectionId: connId,
      snapAccountId: snapAcctId && snapAcctId.length > 0 ? snapAcctId : null,
    };
  }
  // Accept a bare connection UUID (some callers pass connectionId directly).
  if (UUID_RE.test(id)) return { isDemo: false, connectionId: id, snapAccountId: null };
  return null;
}

/**
 * Extract just the broker_connections.id from any canonical account id form
 * ('demo' → null, 'snaptrade:<conn>' → conn, 'snaptrade:<conn>:<acct>' → conn,
 * bare UUID → UUID). Use this instead of `id.slice('snaptrade:'.length)`, which
 * silently returns '<conn>:<acct>' for the 3-part sub-account form.
 */
export function connectionIdFromAccountId(accountId: string | null | undefined): string | null {
  return parseAccountScope(accountId)?.connectionId ?? null;
}

/** Build a distinct per-sub-account canonical id for a broker connection. */
export function subAccountId(connectionId: string, snapAccountId: string | null | undefined): string {
  return snapAccountId ? `snaptrade:${connectionId}:${snapAccountId}` : `snaptrade:${connectionId}`;
}

/** Inverse of parseAccountScope — build the canonical account id string. */
export function accountIdFromScope(scope: AccountScope): string {
  if (scope.isDemo) return 'demo';
  return subAccountId(scope.connectionId as string, scope.snapAccountId);
}

/**
 * Apply an account-scope filter to a Supabase query builder chain.
 * `isDemo` scope → `.eq('is_demo', true)`; live scope → `.eq('connection_id', connId)`.
 * Returns the (mutated) query for chaining.
 */
export function applyAccountScopeFilter(query: any, scope: AccountScope): any {
  if (scope.isDemo) {
    return query.eq('is_demo', true);
  }
  if (scope.connectionId) {
    return query.eq('connection_id', scope.connectionId);
  }
  return query;
}

/**
 * Build the insert columns for an account-scoped write.
 * null/unrecognized accountId → live default (is_demo=false, connection_id=null).
 */
export function accountScopeColumns(
  accountId?: string | null,
): { connection_id: string | null; is_demo: boolean } {
  const scope = parseAccountScope(accountId);
  if (!scope) return { connection_id: null, is_demo: false };
  return { connection_id: scope.connectionId, is_demo: scope.isDemo };
}

/**
 * True when a row's scope matches the supplied accountId. An omitted/null
 * accountId returns true (legacy callers keep their old user-level behavior,
 * no cross-account check beyond the existing user_id ownership check).
 */
export function accountScopeMatches(
  accountId: string | null | undefined,
  row: { is_demo?: boolean | null; connection_id?: string | null },
): boolean {
  const scope = parseAccountScope(accountId);
  if (!scope) return true;
  const rowDemo = row?.is_demo === true;
  const rowConn = (row?.connection_id as string | null | undefined) ?? null;
  if (scope.isDemo) return rowDemo;
  if (scope.connectionId) return rowConn === scope.connectionId;
  return !rowDemo;
}

/**
 * Client-side helper: read the explicit active-account choice from localStorage.
 * Returns undefined when nothing is stored (callers then omit accountId, and the
 * server defaults to live-only). Mirrors AccountContext's 'vantage:activeAccount' key.
 */
export function getStoredActiveAccountId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return localStorage.getItem('vantage:activeAccount') || undefined;
  } catch {
    return undefined;
  }
}
