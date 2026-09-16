/**
 * Live per-account settled CASH for a broker account.
 *
 * ## Why this exists
 * `broker_connections.snaptrade_accounts` is a **connect-time snapshot**: it is
 * written exactly once, in `app/api/connections/callback/route.ts`, and never
 * refreshed. Reading cash out of it reported Alpaca's July balance
 * ($100,865.95) as today's cash when the account actually held $468.81 — a
 * number months out of date, rendered as current. A stale figure presented as
 * current is the same failure class as a fabricated one, so the snapshot is no
 * longer a cash source.
 *
 * Cash is read from the authoritative live endpoint
 * (`GET /accounts/{id}/balances`, the same one `SnapTradeBroker.getAccount`
 * uses) and reported as UNKNOWN (`null`) whenever it cannot be established.
 *
 * ## Rules (and what they protect against)
 *  - Never merges: a shared login with no resolvable sub-account scope returns
 *    `null` instead of summing the siblings' cash.
 *  - One null/absent balance row poisons the sum: partial data is not a
 *    measurement, so the account's cash goes unknown rather than understated.
 *  - Credentials missing / network failure / non-2xx ⇒ `null`. Unknown, never
 *    guessed. Callers must render "unknown", never `$0`.
 *
 * READ-ONLY: performs SnapTrade GETs only. Writes nothing, anywhere.
 */

import { getAccountBalances, getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';
import { createServerClient } from '@/lib/supabase';

/** Short in-process cache — the noticed/cron paths can run several times a minute. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: number | null }>();

/** Test seam. */
export function __clearLiveCashCache(): void {
  cache.clear();
}

type SnapTradeCredsRow = {
  snaptrade_user_id: string | null;
  snaptrade_user_secret_encrypted: string | null;
  snaptrade_connection_id: string | null;
  snaptrade_accounts: unknown;
};

/** Live cash for one SnapTrade sub-account. `null` when not established. */
async function cashForAccount(
  snapAccountId: string,
  ep: { userId: string; userSecret: string },
): Promise<number | null> {
  try {
    const balances = await getAccountBalances(snapAccountId, ep.userId, ep.userSecret);
    if (!Array.isArray(balances) || balances.length === 0) return null;
    let total = 0;
    for (const b of balances) {
      const v = b?.cash;
      if (typeof v !== 'number' || !Number.isFinite(v)) return null; // partial ⇒ unknown
      total += v;
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Resolve the live settled cash for a broker account.
 *
 * @param userId       Vantage user id (SnapTrade user secret is encrypted per user).
 * @param connectionId `broker_connections.id`
 * @param snapAccountId SnapTrade sub-account id, or `null`/`undefined` for a
 *   connection-level call — which resolves ONLY when the connection exposes a
 *   single account (a shared login has no unambiguous account, so cash is
 *   unknown rather than merged).
 * @returns the cash amount, or `null` when unknown.
 */
export async function resolveLiveAccountCash(
  userId: string,
  connectionId: string,
  snapAccountId?: string | null,
): Promise<number | null> {
  const key = `${userId}:${connectionId}:${snapAccountId ?? '*'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await resolveUncached(userId, connectionId, snapAccountId ?? null);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function resolveUncached(
  userId: string,
  connectionId: string,
  snapAccountId: string | null,
): Promise<number | null> {
  try {
    const supabase = createServerClient() as any;
    const { data: conn } = await (supabase
      .from('broker_connections')
      .select('snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_connection_id, snaptrade_accounts')
      .eq('user_id', userId)
      .eq('id', connectionId)
      .maybeSingle() as Promise<{ data: SnapTradeCredsRow | null }>);

    if (!conn?.snaptrade_connection_id) {
      console.warn(`[live-cash] no SnapTrade authorization for connection ${connectionId} — cash unknown`);
      return null;
    }

    // Which sub-account(s)? Only ever the one that was named, or the single one
    // the connection exposes. Never "all of them".
    const snapshot = Array.isArray(conn.snaptrade_accounts) ? (conn.snaptrade_accounts as any[]) : [];
    let target = snapAccountId;
    if (!target) {
      if (snapshot.length !== 1) {
        console.warn(
          `[live-cash] connection ${connectionId} exposes ${snapshot.length} accounts and no snapAccountId was given — cash unknown (aggregating across sub-accounts is disabled)`,
        );
        return null;
      }
      target = (snapshot[0]?.id as string) || null;
      if (!target) {
        // No snapshot to read the account id from — cash stays unknown rather
        // than being attributed to a guess.
        console.warn(`[live-cash] connection ${connectionId} has no account snapshot — cash unknown`);
        return null;
      }
    }

    const snapUser = await getOrCreateSnapTradeUser(
      userId,
      conn.snaptrade_user_id,
      conn.snaptrade_user_secret_encrypted,
    );
    if (!snapUser?.userSecret) return null;

    return await cashForAccount(target, { userId: snapUser.userId, userSecret: snapUser.userSecret });
  } catch (err) {
    console.warn(
      `[live-cash] cash lookup failed for ${connectionId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
