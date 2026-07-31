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
  return snapTradeFetch<SnapTradeAccount[]>(
    `/authorizations/${connectionId}/accounts`,
    null,
    { userId, userSecret },
  );
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
