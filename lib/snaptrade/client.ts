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
import { decryptDataCompat, encryptData, deriveUserKey } from '@/lib/vault';

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
    /** Broker-level trading ceiling (can this broker trade at all via SnapTrade). */
    allows_trading?: boolean;
    authorization_types?: Array<{ type: string; auth_type: string }>;
  };
  name: string;
  created_date: string;
  /** Connection-level grant: "trade" | "read". Authoritative per-connection signal. */
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
  account_category: string | null;
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
      account_category: a.account_category ?? null,
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
      const userSecret = decryptDataCompat(existingSecretEncrypted, vantageUserId);
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
// THE single entry point for resolving SnapTrade credentials / connection
// rows in any route handler. No route should ever manually construct
// userId/userSecret from raw DB fields or authUserId, and no route should
// `.maybeSingle()` broker_connections to "pick whichever row comes back
// first" — that is exactly the cross-account-substitution bug class this
// replaces. Arbitrary selection is structurally impossible here.

export interface ResolvedSnapTrade {
  snaptradeUserId: string;
  snaptradeUserSecret: string;
  /** SnapTrade authorization id — what SnapTrade API calls need. */
  connectionId: string;
  /** broker_connections.id — our internal row UUID (the client-facing account id). */
  brokerConnectionId: string;
  brokerSlug: string;
  tradingEnabled: boolean;
}

/** Normalized broker_connections row. */
export interface BrokerConnectionRow {
  id: string;
  snaptradeConnectionId: string;
  snaptradeUserId: string;
  snaptradeUserSecretEncrypted: string;
  brokerSlug: string;
  tradingEnabled: boolean;
}

export class SnapTradeAuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'SnapTradeAuthError';
  }
}

/** Thrown when a user has 2+ connected brokers and no explicit account id was given. */
export class SnapTradeAmbiguousError extends Error {
  status = 409;
  constructor(message = 'Multiple brokers connected — specify an account.') {
    super(message);
    this.name = 'SnapTradeAmbiguousError';
  }
}

async function getSupabaseAdmin() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Canonical query for the user's connected SnapTrade connection rows.
 * Deterministically ordered by created_at so "the first one" is stable.
 */
export async function listConnectedSnapTradeConnections(
  authUserId: string,
): Promise<BrokerConnectionRow[]> {
  const supabase = await getSupabaseAdmin();
  const { data, error } = await supabase
    .from('broker_connections')
    .select('id, snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_connection_id, brokerage_slug, trading_enabled')
    .eq('user_id', authUserId)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'connected')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[snaptrade] listConnectedSnapTradeConnections error:', error.message);
    return [];
  }

  return (data || []).map((c: any) => ({
    id: c.id,
    snaptradeConnectionId: c.snaptrade_connection_id || '',
    snaptradeUserId: c.snaptrade_user_id,
    snaptradeUserSecretEncrypted: c.snaptrade_user_secret_encrypted,
    brokerSlug: c.brokerage_slug || '',
    tradingEnabled: c.trading_enabled === true,
  }));
}

/**
 * Resolve a single connection row, enforcing an explicit, verified account id.
 *
 * - `connectionId` provided → resolve EXACTLY that row (must belong to the
 *   user, be snaptrade type, and be connected). Missing/foreign → auth error.
 * - `connectionId` omitted → resolve only if the user has EXACTLY ONE connected
 *   broker. 0 → SnapTradeAuthError; 2+ → SnapTradeAmbiguousError (409).
 *   Arbitrary "first row wins" selection is structurally impossible here.
 */
export async function resolveBrokerConnection(
  authUserId: string,
  connectionId?: string | null,
): Promise<BrokerConnectionRow> {
  const all = await listConnectedSnapTradeConnections(authUserId);

  if (connectionId) {
    const match = all.find((c) => c.id === connectionId);
    if (!match) {
      throw new SnapTradeAuthError(
        'No connected SnapTrade brokerage found for that account. Please reconnect the broker.',
      );
    }
    return match;
  }

  if (all.length === 0) {
    throw new SnapTradeAuthError('No connected SnapTrade brokerage found. Please connect a broker.');
  }
  if (all.length > 1) {
    throw new SnapTradeAmbiguousError();
  }
  return all[0];
}

/**
 * Resolve SnapTrade credentials (userId/userSecret + authorization id) for a
 * verified connection. Decrypts the user secret server-side.
 */
export async function resolveSnapTradeCredentials(
  authUserId: string,
  connectionId?: string | null,
): Promise<ResolvedSnapTrade> {
  const conn = await resolveBrokerConnection(authUserId, connectionId);

  if (!conn.snaptradeUserId || !conn.snaptradeUserSecretEncrypted || !conn.snaptradeConnectionId) {
    throw new SnapTradeAuthError('No connected SnapTrade brokerage found. Please connect a broker.');
  }

  const snapUser = await getOrCreateSnapTradeUser(
    authUserId,
    conn.snaptradeUserId,
    conn.snaptradeUserSecretEncrypted,
  );

  return {
    snaptradeUserId: snapUser.userId,
    snaptradeUserSecret: snapUser.userSecret,
    connectionId: conn.snaptradeConnectionId,
    brokerConnectionId: conn.id,
    brokerSlug: conn.brokerSlug,
    tradingEnabled: conn.tradingEnabled,
  };
}
