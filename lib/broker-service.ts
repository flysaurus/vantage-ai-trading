// ─── Broker Service Layer ──────────────────────────────────────
// Single source of truth for all broker API interactions.
//
// CRITICAL RULES:
// 1. NEVER use encryptData/decryptData from lib/crypto for broker keys
// 2. ONLY use Supabase Vault RPC (get_broker_secret, store_broker_secret, etc.)
// 3. NEVER log credentials to console — errors must not include key values
// 4. NEVER return decrypted credentials to the client — this is SERVER-ONLY
// 5. Only import from supabase server client (createServerClient)
// 6. Every error path returns demo context — the app never crashes on auth failure
//
// Architecture:
//   Client → API Route → broker-service (decrypt + call) → Broker API
//   ─────────────────────────────────────────────────────────────
//   Demo path: broker-service returns demo context → demo-data engine
//
// All broker API calls flow through this service. No other file
// handles broker credentials or makes direct broker HTTP calls.

import { createServerClient } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────

export type BrokerProvider = 'alpaca' | 'tastytrade' | 'schwab' | 'etrade' | 'ibkr';

/** Credential shape returned internally. Never sent to the client. */
export interface BrokerCredentials {
  provider: BrokerProvider;
  alpacaApiKey?: string;
  alpacaSecretKey?: string;
  alpacaBaseUrl?: string;
  tastytradeApiKey?: string;
  tastytradeAccountNumber?: string;
}

/** Safe context for route handlers — no secrets exposed. */
export interface BrokerContext {
  isDemo: boolean;
  provider: BrokerProvider | null;
  credentials: BrokerCredentials | null;
  accountNumber: string | null;
  investorStyle: string;
}

// ─── Internal Helpers ────────────────────────────────────────

/** Create a SUPABASE_SERVICE_ROLE_KEY client. Server-only. */
function supabase() {
  return createServerClient() as any;
}

/** Default demo context — returned on any auth/provisioning failure. */
const DEMO_FALLBACK: BrokerContext = {
  isDemo: true,
  provider: null,
  credentials: null,
  accountNumber: null,
  investorStyle: 'lynch',
};

/**
 * Decrypt a single secret via Supabase Vault RPC.
 *
 * Uses the `get_broker_secret` Postgres function which:
 *  - Looks up the secret by UUID in the Supabase Vault table
 *  - Returns the plaintext value (decrypted internally by Vault)
 *  - Requires service_role permissions (server-side only)
 *
 * NEVER use encryptData/decryptData from lib/crypto for broker keys.
 * Supabase Vault handles encryption at rest — we only do retrieval.
 */
async function decryptSecret(secretId: string): Promise<string> {
  const { data, error } = await supabase().rpc('get_broker_secret', {
    p_secret_id: secretId,
  });

  if (error || !data) {
    // DO NOT log the secretId — it's sensitive metadata
    throw new Error('Failed to retrieve broker credential from vault');
  }

  return data as string;
}

// ─── getBrokerContext ─────────────────────────────────────────
//
// Central broker provisioning check. Called by every API route
// that needs to interact with a broker.
//
// Flow:
//   1. Fetch user profile (broker_connected, investor_style)
//   2. If broker_connected = false → return demo context
//   3. Fetch active api_connections row
//   4. Fetch matching api_credentials row
//   5. Decrypt secrets via Supabase Vault RPC
//   6. Return live BrokerContext with decrypted credentials
//
// On ANY failure, returns demo context. The app is designed
// to degrade gracefully — no broker connection = demo mode.

export async function getBrokerContext(userId: string): Promise<BrokerContext> {
  try {
    // Step 1: Fetch user profile
    const { data: user, error: userErr } = await supabase()
      .from('users')
      .select('broker_connected, investor_style, api_provider')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      return { ...DEMO_FALLBACK, investorStyle: 'lynch' };
    }

    // Step 2: If the user has never connected a broker, return demo
    if (!user.broker_connected) {
      return {
        ...DEMO_FALLBACK,
        investorStyle: user.investor_style || 'lynch',
      };
    }

    // Step 3: Get the active connection record
    const { data: connection, error: connErr } = await supabase()
      .from('api_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_connected', true)
      .single();

    if (connErr || !connection) {
      return {
        ...DEMO_FALLBACK,
        investorStyle: user.investor_style || 'lynch',
      };
    }

    // Step 4: Get the matching credentials row
    const { data: creds, error: credsErr } = await supabase()
      .from('api_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', connection.provider)
      .single();

    if (credsErr || !creds) {
      return {
        ...DEMO_FALLBACK,
        investorStyle: user.investor_style || 'lynch',
      };
    }

    const style = user.investor_style || 'lynch';

    // Step 5: Decrypt provider-specific secrets via Vault RPC
    switch (connection.provider) {
      case 'alpaca': {
        if (!creds.alpaca_api_key_secret_id || !creds.alpaca_secret_key_secret_id) {
          return { ...DEMO_FALLBACK, investorStyle: style };
        }

        const [apiKey, secretKey] = await Promise.all([
          decryptSecret(creds.alpaca_api_key_secret_id),
          decryptSecret(creds.alpaca_secret_key_secret_id),
        ]);

        return {
          isDemo: false,
          provider: 'alpaca',
          credentials: {
            provider: 'alpaca',
            alpacaApiKey: apiKey,
            alpacaSecretKey: secretKey,
            alpacaBaseUrl: creds.alpaca_base_url || 'https://api.alpaca.markets',
          },
          accountNumber: connection.account_number || null,
          investorStyle: style,
        };
      }

      case 'tastytrade': {
        if (!creds.tastytrade_api_key_secret_id) {
          return { ...DEMO_FALLBACK, investorStyle: style };
        }

        const apiKey = await decryptSecret(creds.tastytrade_api_key_secret_id);

        return {
          isDemo: false,
          provider: 'tastytrade',
          credentials: {
            provider: 'tastytrade',
            tastytradeApiKey: apiKey,
            tastytradeAccountNumber: creds.tastytrade_account_number,
          },
          accountNumber: creds.tastytrade_account_number || null,
          investorStyle: style,
        };
      }

      default:
        // Unknown/unhandled provider — fall back to demo
        return { ...DEMO_FALLBACK, investorStyle: style };
    }
  } catch {
    // Any unexpected error (network, DB, Vault) → demo mode
    return DEMO_FALLBACK;
  }
}

// ─── Broker HTTP Clients ─────────────────────────────────────

/**
 * Make an authenticated request to the Alpaca API.
 *
 * Uses Alpaca's custom header auth (APCA-API-KEY-ID + APCA-API-SECRET-KEY).
 * Handles error parsing and surfaces meaningful messages.
 *
 * @param endpoint - API path (e.g. '/v2/account', '/v2/positions')
 * @param credentials - Decrypted broker credentials (never logged)
 * @param options - Optional fetch overrides (method, body, etc.)
 */
export async function makeAlpacaRequest(
  endpoint: string,
  credentials: BrokerCredentials,
  options?: RequestInit,
): Promise<unknown> {
  if (!credentials.alpacaApiKey || !credentials.alpacaSecretKey) {
    throw new Error('Missing Alpaca credentials');
  }

  const baseUrl = credentials.alpacaBaseUrl || 'https://api.alpaca.markets';
  const url = `${baseUrl}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'APCA-API-KEY-ID': credentials.alpacaApiKey,
        'APCA-API-SECRET-KEY': credentials.alpacaSecretKey,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  } catch (err) {
    throw new Error(`Alpaca API network error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  if (!response.ok) {
    let errorBody: Record<string, unknown> = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error response — use status text
    }

    const message =
      (errorBody.message as string) ||
      (errorBody.code as string) ||
      response.statusText ||
      'Unknown';

    throw new Error(`Alpaca API error ${response.status}: ${message}`);
  }

  // Handle 204 No Content (e.g. cancel order)
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * Verify Alpaca credentials by calling /v2/account.
 *
 * Returns { valid: true, accountNumber } on success,
 * or { valid: false, error } with a sanitized message on failure.
 *
 * Used during broker connection setup — the result tells the UI
 * whether the keys work without exposing them.
 */
export async function verifyAlpacaCredentials(
  credentials: BrokerCredentials,
): Promise<{ valid: boolean; accountNumber?: string; error?: string }> {
  try {
    const account = (await makeAlpacaRequest('/v2/account', credentials)) as {
      account_number?: string;
      status?: string;
    };

    if (!account.account_number) {
      return { valid: false, error: 'Alpaca returned an unexpected response' };
    }

    return { valid: true, accountNumber: account.account_number };
  } catch (err: unknown) {
    // Sanitize — never include key values in error messages
    const message = err instanceof Error ? err.message : 'Verification failed';
    return { valid: false, error: message };
  }
}

/**
 * Make an authenticated request to the Tastytrade API.
 *
 * Tastytrade uses session-based auth: exchange the API key for a
 * session token, then use the session token for subsequent requests.
 *
 * This is a low-level helper — higher-level functions should handle
 * session management.
 */
export async function makeTastytradeRequest(
  endpoint: string,
  credentials: BrokerCredentials,
  sessionToken?: string,
  options?: RequestInit,
): Promise<unknown> {
  if (!credentials.tastytradeApiKey) {
    throw new Error('Missing Tastytrade credentials');
  }

  const baseUrl = 'https://api.tastytrade.com';
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options?.headers,
      },
    });
  } catch (err) {
    throw new Error(
      `Tastytrade API network error: ${err instanceof Error ? err.message : 'Unknown'}`,
    );
  }

  if (!response.ok) {
    let errorBody: Record<string, unknown> = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error response
    }

    const message =
      (errorBody.error as string) ||
      (errorBody.message as string) ||
      response.statusText ||
      'Unknown';

    throw new Error(`Tastytrade API error ${response.status}: ${message}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

// ─── Broker Connection Management ────────────────────────────

/**
 * Mark a user's broker connection as active after successful verification.
 *
 * Updates api_connections and triggers the DB trigger that sets
 * users.broker_connected = true.
 *
 * Safe to expose via API route — no credentials involved.
 */
export async function setBrokerConnected(
  userId: string,
  provider: BrokerProvider,
  accountNumber: string,
): Promise<void> {
  const now = new Date().toISOString();

  const { error } = await supabase()
    .from('api_connections')
    .upsert(
      {
        user_id: userId,
        provider,
        is_connected: true,
        connection_verified: true,
        verified_at: now,
        account_number: accountNumber,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    throw new Error(`Failed to update broker connection status: ${error.message}`);
  }
}

/**
 * Disconnect a user's broker — sets is_connected to false.
 *
 * The users.broker_connected column is auto-updated by a DB trigger.
 * Credentials remain stored in api_credentials + Vault (soft disconnect).
 * Call deleteBrokerCredentials() to fully purge secrets.
 */
export async function disconnectBroker(userId: string): Promise<void> {
  const now = new Date().toISOString();

  const { error } = await supabase()
    .from('api_connections')
    .upsert(
      {
        user_id: userId,
        is_connected: false,
        connection_verified: false,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    throw new Error(`Failed to disconnect broker: ${error.message}`);
  }
}

/**
 * Check if a user has an active broker connection.
 *
 * Lightweight — reads only the boolean flag from users table.
 * Does NOT decrypt credentials.
 */
export async function isBrokerConnected(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase()
      .from('users')
      .select('broker_connected')
      .eq('id', userId)
      .single();

    if (error || !data) return false;
    return data.broker_connected === true;
  } catch {
    return false;
  }
}

// ─── Credential Management ───────────────────────────────────

/**
 * Store broker credentials in Supabase Vault.
 *
 * Flow:
 *   1. Store plaintext secrets in Supabase Vault via store_broker_secret RPC
 *   2. Store the returned Vault UUIDs in api_credentials
 *   3. Create/update the api_connections record
 *
 * At NO point are credentials logged. The plaintext values flow
 * directly from the request body to the Vault RPC.
 */
export async function storeBrokerCredentials(
  userId: string,
  provider: BrokerProvider,
  credentials: {
    alpacaApiKey?: string;
    alpacaSecretKey?: string;
    alpacaBaseUrl?: string;
    tastytradeApiKey?: string;
    tastytradeAccountNumber?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();

  if (provider === 'alpaca') {
    if (!credentials.alpacaApiKey || !credentials.alpacaSecretKey) {
      throw new Error('Alpaca API key and secret key are required');
    }

    // Store secrets in Vault (returns UUIDs)
    const [apiKeyId, secretKeyId] = await Promise.all([
      supabase().rpc('store_broker_secret', {
        p_secret_value: credentials.alpacaApiKey,
        p_secret_name: `alpaca_api_key_${userId}`,
      }),
      supabase().rpc('store_broker_secret', {
        p_secret_value: credentials.alpacaSecretKey,
        p_secret_name: `alpaca_secret_key_${userId}`,
      }),
    ]);

    if (apiKeyId.error || secretKeyId.error) {
      throw new Error('Failed to store broker secrets in Vault');
    }

    // Store Vault UUIDs in api_credentials (not the secrets themselves)
    const { error: credsErr } = await supabase()
      .from('api_credentials')
      .upsert(
        {
          user_id: userId,
          provider: 'alpaca',
          alpaca_api_key_secret_id: apiKeyId.data as string,
          alpaca_secret_key_secret_id: secretKeyId.data as string,
          alpaca_base_url: credentials.alpacaBaseUrl || 'https://api.alpaca.markets',
          is_active: true,
          encrypted_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      );

    if (credsErr) {
      // Best-effort cleanup: delete the Vault secrets we just created
      await Promise.allSettled([
        supabase().rpc('delete_broker_secret', { p_secret_id: apiKeyId.data }),
        supabase().rpc('delete_broker_secret', { p_secret_id: secretKeyId.data }),
      ]);
      throw new Error(`Failed to store API credentials: ${credsErr.message}`);
    }
  } else if (provider === 'tastytrade') {
    if (!credentials.tastytradeApiKey) {
      throw new Error('Tastytrade API key is required');
    }

    const { data: secretId, error: vaultErr } = await supabase().rpc(
      'store_broker_secret',
      {
        p_secret_value: credentials.tastytradeApiKey,
        p_secret_name: `tastytrade_api_key_${userId}`,
      },
    );

    if (vaultErr || !secretId) {
      throw new Error('Failed to store Tastytrade secret in Vault');
    }

    const { error: credsErr } = await supabase()
      .from('api_credentials')
      .upsert(
        {
          user_id: userId,
          provider: 'tastytrade',
          tastytrade_api_key_secret_id: secretId as string,
          tastytrade_account_number: credentials.tastytradeAccountNumber || null,
          is_active: true,
          encrypted_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      );

    if (credsErr) {
      await supabase()
        .rpc('delete_broker_secret', { p_secret_id: secretId })
        .catch(() => {}); // Best-effort cleanup
      throw new Error(`Failed to store API credentials: ${credsErr.message}`);
    }
  } else {
    throw new Error(`Unsupported broker provider: ${provider}`);
  }
}

/**
 * Fully delete broker credentials for a user.
 *
 * Removes:
 *   1. Vault secrets (via delete_broker_secret RPC)
 *   2. api_credentials row
 *   3. Marks api_connections as disconnected
 *
 * This is a hard delete. No recovery.
 */
export async function deleteBrokerCredentials(userId: string): Promise<void> {
  // Step 1: Look up Vault secret IDs from api_credentials
  const { data: creds, error: fetchErr } = await supabase()
    .from('api_credentials')
    .select('provider, alpaca_api_key_secret_id, alpaca_secret_key_secret_id, tastytrade_api_key_secret_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed to fetch credentials for deletion: ${fetchErr.message}`);
  }

  // Step 2: Delete Vault secrets (best-effort, don't fail if missing)
  if (creds) {
    const deletePromises: Promise<unknown>[] = [];

    if (creds.alpaca_api_key_secret_id) {
      deletePromises.push(
        supabase().rpc('delete_broker_secret', {
          p_secret_id: creds.alpaca_api_key_secret_id,
        }),
      );
    }
    if (creds.alpaca_secret_key_secret_id) {
      deletePromises.push(
        supabase().rpc('delete_broker_secret', {
          p_secret_id: creds.alpaca_secret_key_secret_id,
        }),
      );
    }
    if (creds.tastytrade_api_key_secret_id) {
      deletePromises.push(
        supabase().rpc('delete_broker_secret', {
          p_secret_id: creds.tastytrade_api_key_secret_id,
        }),
      );
    }

    await Promise.allSettled(deletePromises);
  }

  // Step 3: Delete api_credentials row
  await supabase()
    .from('api_credentials')
    .delete()
    .eq('user_id', userId);

  // Step 4: Mark connection as disconnected (triggers users.broker_connected = false)
  await supabase()
    .from('api_connections')
    .update({
      is_connected: false,
      connection_verified: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

// ─── Demo Data Re-export ─────────────────────────────────────

/**
 * Re-export getDemoAccount as getDemoPortfolio for convenience.
 * All demo data generation flows through the demo-data engine.
 */
export { getDemoAccount as getDemoPortfolio } from '@/lib/demo-data';
