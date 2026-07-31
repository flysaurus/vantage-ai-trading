// ─── Vault Integration ────────────────────────────────────────
// Encrypt/decrypt broker API credentials via AES-256-GCM in
// application code. Credentials are encrypted BEFORE any DB
// interaction — Supabase never sees plaintext keys.
//
// Each user's credentials are encrypted with a per-user derived key:
//   SHA-256(userId + VAULT_ENCRYPTION_KEY)
//
// CRITICAL: Decrypted credentials must NEVER leave the server.
// Only broker proxy/session endpoints decrypt internally.
//
// Client-side is NEVER allowed to access decrypted credentials.
// Client → API route → server-side vault → broker.

import { createServerClient } from './supabase';
import crypto from 'crypto';

// ─── Inline crypto (was lib/crypto.ts — now deleted) ─────────

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

export function deriveUserKey(userId: string): Buffer {
  const secret = process.env.VAULT_ENCRYPTION_KEY || 'dev-encryption-key-change-me';
  return crypto.createHash('sha256').update(userId + secret).digest();
}

export function encryptData(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  });
}

export function decryptData(payload: string, key: Buffer): string {
  const { encrypted, iv, authTag } = JSON.parse(payload);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'), { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8');
}

// ─── Store Credentials ────────────────────────────────────────

/**
 * Encrypt and store broker credentials in the vault.
 * SERVER-SIDE ONLY. Credentials are encrypted with a per-user derived key.
 *
 * Also stores a SHA-256 hash of the plaintext credentials for integrity
 * verification, so tampering can be detected on read.
 *
 * @param userId - The authenticated user's UUID
 * @param brokerId - The broker identifier (e.g. 'alpaca', 'tastytrade')
 * @param credentials - The raw credentials object (never logged)
 */
export async function storeCredentials(
  userId: string,
  brokerId: string,
  credentials: Record<string, unknown>
): Promise<void> {
  const supabase = createServerClient();

  // Serialize and hash credentials for integrity verification
  const plaintext = JSON.stringify(credentials);
  const credentialHash = crypto
    .createHash('sha256')
    .update(plaintext)
    .digest('hex');

  // Derive per-user key and encrypt
  const userKey = deriveUserKey(userId);
  const encrypted = encryptData(plaintext, userKey);

  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('vault')
    .upsert(
      {
        user_id: userId,
        broker_id: brokerId,
        encrypted_credentials: encrypted,
        credential_hash: credentialHash,
        is_connected: true,
        connected_at: now,
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('[Vault] storeCredentials failed:', error);
    throw new Error('Failed to store broker credentials');
  }
}

// ─── Get Credentials (decrypted) ───────────────────────────────

/**
 * Retrieve and decrypt broker credentials from the vault.
 * SERVER-SIDE ONLY. Must never pass the decrypted result to the client.
 *
 * Verifies integrity by comparing stored hash against decrypted data hash.
 *
 * @param userId - The authenticated user's UUID
 * @returns Decrypted credentials and broker ID
 */
export async function getCredentials(
  userId: string
): Promise<{ brokerId: string; credentials: Record<string, unknown> }> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('vault')
    .select('broker_id, encrypted_credentials, credential_hash')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[Vault] getCredentials failed:', error);
    throw new Error('Failed to retrieve broker credentials');
  }

  if (!data || !data.encrypted_credentials) {
    throw new Error('No credentials found for this user');
  }

  // Derive per-user key and decrypt
  const userKey = deriveUserKey(userId);
  const decrypted = decryptData(data.encrypted_credentials, userKey);

  // Integrity check
  const computedHash = crypto
    .createHash('sha256')
    .update(decrypted)
    .digest('hex');

  if (computedHash !== data.credential_hash) {
    console.error('[Vault] Credential integrity check FAILED for user:', userId);
    throw new Error('Credential integrity check failed — data may be corrupted');
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(decrypted);
  } catch {
    console.error('[Vault] Failed to parse decrypted credentials');
    throw new Error('Failed to parse stored credentials');
  }

  return {
    brokerId: data.broker_id,
    credentials,
  };
}

// ─── Clear Credentials ────────────────────────────────────────

/**
 * Wipe all stored credentials for a user from the vault.
 * This is a hard delete — no recovery, no backups.
 *
 * @param userId - The authenticated user's UUID
 */
export async function clearCredentials(userId: string): Promise<void> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('vault')
    .update({
      broker_id: null,
      encrypted_credentials: null,
      credential_hash: null,
      is_connected: false,
      connected_at: null,
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[Vault] clearCredentials failed:', error);
    throw new Error('Failed to clear broker credentials');
  }
}

// ─── Get Connection Status (no decryption) ────────────────────

/**
 * Return broker connection status WITHOUT decrypting credentials.
 * Safe to call from any endpoint, including those that return data to the client.
 *
 * @param userId - The authenticated user's UUID
 * @returns Connection status info (no credentials)
 */
export async function getConnectionStatus(
  userId: string
): Promise<{
  connected: boolean;
  brokerId: string | null;
  connectedAt: string | null;
}> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('vault')
    .select('broker_id, is_connected, connected_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[Vault] getConnectionStatus failed:', error);
    return { connected: false, brokerId: null, connectedAt: null };
  }

  if (!data || !data.is_connected) {
    return { connected: false, brokerId: null, connectedAt: null };
  }

  return {
    connected: true,
    brokerId: data.broker_id || null,
    connectedAt: data.connected_at || null,
  };
}

// ============================================================================
// LEGACY COMPATIBILITY — keep old exports working during transition
// These are thin wrappers that will be removed once consumers are migrated.
// ============================================================================

/**
 * @deprecated Use storeCredentials() instead.
 */
export async function storeKeys(
  userId: string,
  apiKey: string,
  secretKey: string,
  _masterPassword: string
): Promise<void> {
  const credentials: Record<string, unknown> = {
    apiKey,
    secretKey,
    environment: process.env.ALPACA_ENVIRONMENT === 'live' ? 'live' : 'paper',
  };
  await storeCredentials(userId, 'alpaca', credentials);
}

/**
 * @deprecated Use getCredentials() instead.
 */
export async function getKeys(
  userId: string
): Promise<{ apiKey: string; secretKey: string }> {
  const result = await getCredentials(userId);
  const creds = result.credentials;
  return {
    apiKey: String(creds.apiKey || ''),
    secretKey: String(creds.secretKey || ''),
  };
}

/**
 * @deprecated Use clearCredentials() instead.
 */
export async function clearKeys(userId: string): Promise<void> {
  await clearCredentials(userId);
}

/**
 * @deprecated No longer stored. Always returns true.
 */
export async function verifyMasterPassword(
  _userId: string,
  _password: string
): Promise<boolean> {
  return true;
}
