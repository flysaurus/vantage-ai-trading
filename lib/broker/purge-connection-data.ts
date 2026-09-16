// ─── Purge derived data for a broker connection ───────────────
//
// ⚠️ WRITE-CAPABLE (standing rule): this module issues DELETEs against
// account-scoped tables. It is intentionally narrow:
//   - rows are matched by BOTH user_id AND the broker connection id, so a
//     purge can never touch another user's data;
//   - it NEVER deletes from `broker_connections` itself (callers own that).
//
// WHY THIS EXISTS
// Disconnecting / deleting an account used to remove only the
// `broker_connections` row — it left every DERIVED row behind (noticed cards,
// cached insights, positions, orders, lots, briefs, chat history…). Those rows
// keep the deleted connection_id, so nothing renders them any more (they look
// harmless) until the SAME connection id is reused, at which point stale cards
// reappear — the "Rufus Noticed card from a deleted account" bug. Purging on
// disconnect is the fix.
//
// THREE scoping shapes exist in this schema:
//   - connection_id (UUID)  → positions, orders, trade_history,
//                             user_baskets, strategies, watchlists, alerts,
//                             recent_notifications, rebalance_sessions
//   - account_id (UUID)     → position_lots — this is the LEGACY broker
//                             CONNECTION id (migration 058), NOT a text account
//                             handle. There is no `connection_id` column on it.
//   - account_id (TEXT)     → chat_messages, daily_briefs, weekly_snapshots,
//                             noticed_items, pending_actions
//                             ('demo' | 'snaptrade:<connId>' | 'snaptrade:<connId>:<acct>')
//
// ⚠️ position_lots used to sit in CONNECTION_ID_TABLES and its delete failed
// with `column position_lots.connection_id does not exist` on EVERY disconnect —
// logged as a warning and skipped, so deleting a connection left all of its
// FIFO lots behind (stale cost basis that would be re-consumed if the same
// connection was ever re-added). It now has its own scoped block below and is
// deleted by BOTH the legacy connection key (`account_id`) and the Part B
// account key (`broker_account_id`, migration 077).
//
// Every delete is best-effort: a missing table/column is logged and skipped so
// a schema drift can't make disconnect itself fail.

import type { SupabaseClient } from '@supabase/supabase-js';

const CONNECTION_ID_TABLES = [
  'positions',
  'orders',
  'trade_history',
  'user_baskets',
  'strategies',
  'watchlists',
  'alerts',
  'recent_notifications',
  'rebalance_sessions',
] as const;

const ACCOUNT_ID_TABLES = [
  'chat_messages',
  'daily_briefs',
  'weekly_snapshots',
  'noticed_items',
  'pending_actions',
] as const;

/**
 * Delete all derived rows tied to the given user + broker connection ids.
 * Returns the number of successful table-deletes (for logging only).
 */
export async function purgeConnectionDerivedData(
  supabase: SupabaseClient,
  userId: string,
  connectionIds: Array<string | null | undefined>,
): Promise<{ purgedDeletes: number }> {
  const unique = Array.from(new Set(connectionIds.filter((c): c is string => !!c)));
  if (unique.length === 0) return { purgedDeletes: 0 };

  let purgedDeletes = 0;
  for (const connId of unique) {
    for (const table of CONNECTION_ID_TABLES) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('user_id', userId)
        .eq('connection_id', connId);
      if (error) console.warn(`[purge] ${table} (conn ${connId}):`, error.message);
      else purgedDeletes++;
    }
    for (const table of ACCOUNT_ID_TABLES) {
      // Matches both the legacy connection form and any per-sub-account form.
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('user_id', userId)
        .like('account_id', `snaptrade:${connId}%`);
      if (error) console.warn(`[purge] ${table} (account ${connId}):`, error.message);
      else purgedDeletes++;
    }

    // ── position_lots — special shape ──
    // Legacy rows key the CONNECTION in `account_id` (UUID, migration 058);
    // Part B rows key the SUB-ACCOUNT in `broker_account_id` (migration 077).
    // Both must go, or the deleted connection's cost basis survives the delete.
    const { error: legacyLotErr } = await supabase
      .from('position_lots')
      .delete()
      .eq('user_id', userId)
      .eq('account_id', connId);
    if (legacyLotErr) console.warn(`[purge] position_lots/legacy (conn ${connId}):`, legacyLotErr.message);
    else purgedDeletes++;

    // Registry lookup (enumeration, never inference): which sub-accounts did
    // this connection own? A lookup failure skips the stamped-lot delete and
    // warns rather than guessing an id.
    const { data: acctRows, error: acctErr } = await supabase
      .from('broker_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('connection_id', connId);
    if (acctErr) {
      console.warn(`[purge] broker_accounts lookup failed (conn ${connId}):`, acctErr.message);
    } else {
      const accountIds = (acctRows ?? []).map((r: { id: string }) => r.id);
      if (accountIds.length > 0) {
        const { error: lotErr } = await supabase
          .from('position_lots')
          .delete()
          .eq('user_id', userId)
          .in('broker_account_id', accountIds);
        if (lotErr) console.warn(`[purge] position_lots/stamped (conn ${connId}):`, lotErr.message);
        else purgedDeletes++;
      }
    }
  }
  return { purgedDeletes };
}
