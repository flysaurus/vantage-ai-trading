// ─── SnapTrade Client ─────────────────────────────────────────
// Server-side only. Manages SnapTrade users and connections.
//
// SnapTrade uses a two-layer identity model:
//   1. SnapTrade user (userId + userSecret) — one per Vantage user
//   2. Connections (brokerage authorizations) — many per SnapTrade user
//
// Flow:
//   registerSnapTradeUser(vantageUserId) → { userId, userSecret }
//   generateConnectionPortalUrl(userId, userSecret, broker, ...) → redirectURI
//   listConnections(userId, userSecret) → [{ id, brokerage, ... }]
//   listAccounts(connectionId, userId, userSecret) → [{ id, name, ... }]

import { snapTradeFetch } from './auth';
import { decryptData, encryptData, deriveUserKey } from '@/lib/vault';

// ─── Types ────────────────────────────────────────────────────

export interface SnapTradeUser {
  userId: string;
  userSecret: string;
}

export interface SnapTradeConnection {
  id: string;
  brokerage: {
    id: string;
    slug: string;
    name: string;
  };
  name: string;
  created_date: string;
  type: string;
  status: string;
}

export interface SnapTradeAccount {
  id: string;
  number: string;
  name: string;
  currency: string;
  type: string;
  cash: number | null;
  buying_power: number | null;
  total_value: number | null;
}

// ─── User Management ─────────────────────────────────────────

/**
 * Register a new SnapTrade user under our Client ID.
 *
 * SnapTrade generates a userSecret automatically.
 * The userId must be immutable per Vantage user.
 * We use the Vantage user UUID (not email) for this.
 *
 * @param vantageUserId - The Vantage user's UUID (stable, immutable)
 */
export async function registerSnapTradeUser(
  vantageUserId: string,
): Promise<SnapTradeUser> {
  // SnapTrade userId can be any immutable string. We prefix to avoid
  // collisions with other apps using the same SnapTrade client.
  const snapUserId = `vantage_${vantageUserId}`;

  const response = await snapTradeFetch<{
    userId: string;
    userSecret: string;
  }>('/snapTrade/registerUser', { userId: snapUserId });

  if (!response.userId || !response.userSecret) {
    throw new Error('SnapTrade registration returned incomplete data');
  }

  return {
    userId: response.userId,
    userSecret: response.userSecret,
  };
}

// ─── Connection Portal ───────────────────────────────────────

/**
 * Generate the SnapTrade Connection Portal URL.
 *
 * The user will be redirected to this URL to authenticate with their brokerage.
 * After completion, SnapTrade redirects to `redirectUri` with ?success=true.
 *
 * @param userId       - SnapTrade user ID
 * @param userSecret   - SnapTrade user secret
 * @param broker       - Brokerage slug (e.g. "ALPACA-PAPER", "ETRADE")
 * @param redirectUri  - Our callback URL (e.g. "https://our.app/api/connections/callback")
 * @param connectionType - "read", "trade", or "trade-if-available"
 */
export async function generateConnectionPortalUrl(
  userId: string,
  userSecret: string,
  broker: string,
  redirectUri: string,
  connectionType: 'read' | 'trade' | 'trade-if-available' = 'trade-if-available',
): Promise<string> {
  const response = await snapTradeFetch<{ redirectURI: string }>(
    '/snapTrade/login',
    {
      userId,
      userSecret,
      broker,
      immediateRedirect: true,
      customRedirect: redirectUri,
      connectionType,
      connectionPortalVersion: 'v4',
    },
    { userId, userSecret },
  );

  if (!response.redirectURI) {
    throw new Error('SnapTrade did not return a redirect URI');
  }

  return response.redirectURI;
}

// ─── Connections ─────────────────────────────────────────────

/**
 * List all brokerage connections for a SnapTrade user.
 */
export async function listConnections(
  userId: string,
  userSecret: string,
): Promise<SnapTradeConnection[]> {
  return snapTradeFetch<SnapTradeConnection[]>(
    '/authorizations',
    null,
    { userId, userSecret },
  );
}

/**
 * Get a single connection by ID.
 */
export async function getConnection(
  connectionId: string,
  userId: string,
  userSecret: string,
): Promise<SnapTradeConnection> {
  return snapTradeFetch<SnapTradeConnection>(
    `/authorizations/${connectionId}`,
    null,
    { userId, userSecret },
  );
}

/**
 * Delete a connection (disconnect brokerage).
 */
export async function deleteConnection(
  connectionId: string,
  userId: string,
  userSecret: string,
): Promise<void> {
  await snapTradeFetch(
    `/authorizations/${connectionId}`,
    null,
    { userId, userSecret },
    { method: 'DELETE' },
  );
}

// ─── Accounts ────────────────────────────────────────────────

/**
 * List all accounts under a specific connection.
 */
export async function listAccounts(
  connectionId: string,
  userId: string,
  userSecret: string,
): Promise<SnapTradeAccount[]> {
  const raw = await snapTradeFetch<any[]>(
    `/authorizations/${connectionId}/accounts`,
    null,
    { userId, userSecret },
  );
  // Normalize SnapTrade's nested balance structure into flat fields
  return raw.map((a) => {
    const bal = a.balance || {};
    return {
      id: a.id,
      number: a.number,
      name: a.name,
      currency: a.currency,
      type: a.type,
      cash: a.cash ?? bal.cash?.amount ?? bal.cash ?? bal.available_cash?.amount ?? bal.available_cash ?? null,
      buying_power: a.buying_power ?? bal.buying_power?.amount ?? bal.buying_power ?? null,
      total_value: a.total_value ?? bal.total?.amount ?? bal.total ?? 0,
    };
  });
}

/**
 * Fetch per-currency cash and buying power for a single SnapTrade account.
 * Uses GET /accounts/{accountId}/balances.
 *
 * Returns a list of currency balances — sum across currencies to get totals.
 */
export async function getAccountBalances(
  accountId: string,
  userId: string,
  userSecret: string,
): Promise<SnapTradeBalance[]> {
  return snapTradeFetch<SnapTradeBalance[]>(
    `/accounts/${accountId}/balances`,
    null,
    { userId, userSecret },
  );
}

/** Per-currency balance entry from SnapTrade balances endpoint. */
export interface SnapTradeBalance {
  currency?: { code: string; name?: string; id?: string };
  cash: number | null;
  buying_power: number | null;
}

// ─── Higher-level helpers ────────────────────────────────────

/**
 * Get or create a SnapTrade user for a given Vantage user.
 *
 * If `existingSnapUserId` and `existingSecretEncrypted` are provided,
 * decrypts the secret and returns the existing user.
 * Otherwise, registers a new SnapTrade user.
 *
 * @returns userId, userSecret, and whether this is a new registration.
 */
export async function getOrCreateSnapTradeUser(
  vantageUserId: string,
  existingSnapUserId?: string | null,
  existingSecretEncrypted?: string | null,
): Promise<{ userId: string; userSecret: string; isNew: boolean }> {
  // If we already have a SnapTrade user, decrypt the secret
  if (existingSnapUserId && existingSecretEncrypted) {
    try {
      const key = deriveUserKey(vantageUserId);
      const userSecret = decryptData(existingSecretEncrypted, key);
      return { userId: existingSnapUserId, userSecret, isNew: false };
    } catch (err) {
      // Decryption failed — re-register
      console.warn(
        '[snaptrade] Failed to decrypt existing user secret, re-registering',
        err instanceof Error ? err.message : 'Unknown',
      );
    }
  }

  // Register new SnapTrade user
  const newUser = await registerSnapTradeUser(vantageUserId);
  return { ...newUser, isNew: true };
}

/**
 * Encrypt a SnapTrade user secret for storage in the database.
 */
export function encryptUserSecret(vantageUserId: string, userSecret: string): string {
  const key = deriveUserKey(vantageUserId);
  return encryptData(userSecret, key);
}

// ── Shared Credential Resolution ─────────────────────────────
// THE single entry point for resolving SnapTrade credentials
// in any route handler. No route should ever manually construct
// userId/userSecret from raw DB fields or authUserId.
//
// This is what prevents the "constructed wrong credentials" bug
// class from recurring in every new SnapTrade route.

export interface ResolvedSnapTrade {
  snaptradeUserId: string;
  snaptradeUserSecret: string;
  connectionId: string;
  brokerSlug: string;
}

export class SnapTradeAuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'SnapTradeAuthError';
  }
}

/**
 * Resolve SnapTrade credentials for the authenticated user.
 *
 * Queries broker_connections for the first connected SnapTrade row,
 * decrypts the stored userSecret server-side, and returns the
 * values needed for ANY SnapTrade API call.
 *
 * Throws SnapTradeAuthError (401) if no connected brokerage exists.
 */
export async function resolveSnapTradeCredentials(
  authUserId: string,
): Promise<ResolvedSnapTrade> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: conn } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_connection_id, brokerage_slug')
    .eq('user_id', authUserId)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'connected')
    .maybeSingle();

  if (!conn?.snaptrade_user_id || !conn?.snaptrade_user_secret_encrypted || !conn?.snaptrade_connection_id) {
    throw new SnapTradeAuthError('No connected SnapTrade brokerage found. Please connect a broker.');
  }

  const snapUser = await getOrCreateSnapTradeUser(
    authUserId,
    conn.snaptrade_user_id,
    conn.snaptrade_user_secret_encrypted,
  );

  return {
    snaptradeUserId: snapUser.userId,
    snaptradeUserSecret: snapUser.userSecret,
    connectionId: conn.snaptrade_connection_id,
    brokerSlug: conn.brokerage_slug || '',
  };
}
