// ─── Account Scope ─────────────────────────────────────────
// Shared helpers for threading account identity through data writes/reads.
//
// The app's canonical account id (AccountContext.activeAccountId) is one of:
//   - 'demo'                          → the demo / paper portfolio
//   - 'snaptrade:<broker_connections.id>' → a live/paper broker account
//
// Data tables that represent account-specific state (positions, orders,
// trade_history, position_lots, strategies, user_baskets, chat_messages,
// daily_briefs, weekly_snapshots) must carry BOTH user_id AND one of:
//   - connection_id (broker_connections.id) for live/paper rows, OR
//   - is_demo = true for demo rows.
//
// This module is the single place that converts between the human-facing
// account id and the DB scope tuple, so the mapping can never drift.
// ─────────────────────────────────────────────────────────────

export interface AccountScope {
  /** true → demo portfolio; false → live/paper broker account. */
  isDemo: boolean;
  /** broker_connections.id when !isDemo, otherwise null. */
  connectionId: string | null;
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
  if (id === 'demo') return { isDemo: true, connectionId: null };
  if (id.toLowerCase().startsWith('snaptrade:')) {
    const connId = id.slice('snaptrade:'.length);
    return UUID_RE.test(connId) ? { isDemo: false, connectionId: connId } : null;
  }
  // Accept a bare connection UUID (some callers pass connectionId directly).
  if (UUID_RE.test(id)) return { isDemo: false, connectionId: id };
  return null;
}

/** Inverse of parseAccountScope — build the canonical account id string. */
export function accountIdFromScope(scope: AccountScope): string {
  return scope.isDemo ? 'demo' : `snaptrade:${scope.connectionId}`;
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
