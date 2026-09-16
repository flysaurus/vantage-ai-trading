// ─── "Rufus Noticed" feed scope ────────────────────────────────────────────
// Stored `noticed_items.account_id` values take two shapes:
//   'snaptrade:<conn>:<snap_account>'  (scoped — written by the scoped pipeline)
//   'snaptrade:<conn>'                 (legacy, connection-level)
// Extracted from app/api/ai/noticed/route.ts (Next route files may not export
// helpers — the route type only allows HTTP-method exports).

import { parseAccountScope } from '@/lib/account-scope';

/**
 * Resolve which stored `noticed_items.account_id` values are valid for the
 * ACTIVE account. This is the account-scoping fix for the stale-card bug:
 *
 *  - A specific sub-account ('snaptrade:<conn>:<acct>') sees its own rows, and
 *    ALSO the legacy connection-level rows ('snaptrade:<conn>') — but ONLY when
 *    the connection is UNAMBIGUOUS (a single sub-account). When a connection
 *    exposes 2+ sub-accounts (e.g. Fidelity → "Taxable SMA" + "ANIKET - YOUTH"),
 *    connection-level rows cannot be attributed to either, so they are treated
 *    as ambiguous and hidden rather than shown under the wrong account.
 *  - The legacy connection form ('snaptrade:<conn>') sees only its own rows —
 *    and for a SHARED login (2+ sub-accounts) it sees NOTHING: a
 *    connection-level row cannot be attributed to either sub-account, so
 *    serving it under the ambiguous scope would attribute data by guess.
 *  - Demo sees only 'demo'.
 */
export async function resolveNoticedAccountIds(
  supabase: any,
  userId: string,
  accountId: string,
): Promise<string[]> {
  const scope = parseAccountScope(accountId);
  if (!scope || scope.isDemo) return ['demo'];

  const connId = scope.connectionId as string;
  const legacy = `snaptrade:${connId}`;

  // How many sub-accounts does this connection expose? 2+ means a stored
  // connection-level row cannot be attributed to any single sub-account.
  // `null` = the lookup failed → keep the old single-account default so a DB
  // hiccup cannot blank the feed.
  let snapCount: number | null = null;
  try {
    const { data: conn } = await supabase
      .from('broker_connections')
      .select('snaptrade_accounts')
      .eq('id', connId)
      .eq('user_id', userId)
      .maybeSingle();
    const snapAccounts = conn?.snaptrade_accounts;
    if (Array.isArray(snapAccounts)) snapCount = snapAccounts.length;
  } catch { /* unknown → single-account default */ }

  const unambiguous = snapCount == null || snapCount <= 1;

  // Legacy/connection-level active account.
  if (!scope.snapAccountId) {
    // A shared login has no unambiguous account: report NOTHING rather than
    // attribute a legacy row to a guessed sub-account.
    if (!unambiguous) {
      console.warn(
        `[noticed] connection ${connId} exposes ${snapCount} accounts — connection-level feed scope is ambiguous, returning no items`,
      );
      return [];
    }
    return [legacy];
  }

  const own = `snaptrade:${connId}:${scope.snapAccountId}`;
  return unambiguous ? [own, legacy] : [own];
}
