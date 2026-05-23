// ─── Vault Integration ────────────────────────────────────────
// Encrypt/decrypt broker API keys via Supabase RPC functions.
// All encryption happens inside PostgreSQL (pgcrypto).
//
// CRITICAL: Decrypted keys must NEVER leave the server.
// The vault RPCs are SECURITY DEFINER — only callable with
// service_role key on the server side.
//
// Client-side is NEVER allowed to call vault functions directly.
// Client → API route → server client → Supabase RPC → Alpaca.

import { createServerClient } from './supabase';

// ─── Store Keys ───────────────────────────────────────────────

/**
 * Encrypt and store broker API keys in the vault.
 * SERVER-SIDE ONLY. Uses pgcrypto via Supabase RPC.
 *
 * @param userId - The authenticated user's UUID
 * @param apiKey - The plaintext Alpaca API key ID
 * @param secretKey - The plaintext Alpaca secret key
 * @param masterPassword - User's master password (hashed before storage)
 */
export async function storeKeys(
  userId: string,
  apiKey: string,
  secretKey: string,
  masterPassword: string
): Promise<void> {
  const supabase = createServerClient();
  const encryptionKey = process.env.VAULT_ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error('VAULT_ENCRYPTION_KEY is not set');
  }

  // Hash the master password before storing
  const masterHash = await hashPassword(masterPassword);

  const { error } = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('vault_store_keys', {
    p_user_id: userId,
    p_api_key: apiKey,
    p_secret_key: secretKey,
    p_master_hash: masterHash,
    p_encryption_key: encryptionKey,
  });

  if (error) {
    console.error('[Vault] storeKeys failed:', error);
    throw new Error('Failed to store API keys');
  }
}

// ─── Get Keys ─────────────────────────────────────────────────

/**
 * Decrypt and retrieve broker API keys from the vault.
 * SERVER-SIDE ONLY. Must never pass the result to the client.
 *
 * @param userId - The authenticated user's UUID
 * @returns Decrypted API key and secret key
 */
export async function getKeys(
  userId: string
): Promise<{ apiKey: string; secretKey: string }> {
  const supabase = createServerClient();
  const encryptionKey = process.env.VAULT_ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error('VAULT_ENCRYPTION_KEY is not set');
  }

  const { data, error } = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('vault_get_keys', {
    p_user_id: userId,
    p_encryption_key: encryptionKey,
  });

  if (error) {
    console.error('[Vault] getKeys failed:', error);
    throw new Error('Failed to retrieve API keys');
  }

  // data is an array of { api_key, secret_key }
  const row = (data as Array<{ api_key: string; secret_key: string }>)?.[0];

  if (!row || !row.api_key || !row.secret_key) {
    throw new Error('No API keys found for this user');
  }

  return {
    apiKey: row.api_key,
    secretKey: row.secret_key,
  };
}

// ─── Verify Master Password ───────────────────────────────────

/**
 * Verify a user's master password against the stored hash.
 *
 * @param userId - The authenticated user's UUID
 * @param password - The plaintext master password to verify
 * @returns boolean — true if the password matches
 */
export async function verifyMasterPassword(
  userId: string,
  password: string
): Promise<boolean> {
  const supabase = createServerClient();

  const { data, error } = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('vault_get_password_hash', {
    p_user_id: userId,
  });

  if (error) {
    console.error('[Vault] verifyMasterPassword failed:', error);
    return false;
  }

  const storedHash = data as string | null;
  if (!storedHash) return false;

  return verifyPasswordHash(password, storedHash);
}

// ─── Clear Keys ───────────────────────────────────────────────

/**
 * Remove all stored API keys for a user.
 *
 * @param userId - The authenticated user's UUID
 */
export async function clearKeys(userId: string): Promise<void> {
  const supabase = createServerClient();

  const { error } = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('vault_clear_keys', {
    p_user_id: userId,
  });

  if (error) {
    console.error('[Vault] clearKeys failed:', error);
    throw new Error('Failed to clear API keys');
  }
}

// ─── Password Hashing (in-memory, NOT stored in vault) ────────

async function hashPassword(password: string): Promise<string> {
  // Use Web Crypto API for hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPasswordHash(
  password: string,
  hash: string
): Promise<boolean> {
  const computedHash = await hashPassword(password);
  return computedHash === hash;
}
