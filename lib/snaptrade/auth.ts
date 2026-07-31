// ─── SnapTrade Request Signatures ─────────────────────────────
// HMAC-SHA256 signature per SnapTrade's canonical JSON spec.
//
// Signature payload:
//   { "content": <body or null>, "path": "/snapTrade/...", "query": "clientId=..." }
//
// Canonical JSON rules: sort keys, no whitespace, UTF-8.
// Sign with HMAC-SHA256(consumerKey, canonicalJson) → Base64.

import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────

export interface SnapTradeCredentials {
  clientId: string;
  consumerKey: string;
}

// ─── Credentials from env ────────────────────────────────────

function getCredentials(): SnapTradeCredentials {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;

  if (!clientId || !consumerKey) {
    throw new Error('SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY must be set');
  }

  return { clientId, consumerKey };
}

// ─── Signature Generation ────────────────────────────────────

/**
 * Sort object keys recursively for canonical JSON output.
 * Matches Python's json.dumps(..., sort_keys=True) behavior.
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  Object.keys(obj as Record<string, unknown>)
    .sort()
    .forEach((k) => {
      sorted[k] = sortKeys((obj as Record<string, unknown>)[k]);
    });
  return sorted;
}

/**
 * Generate a SnapTrade-compatible HMAC-SHA256 signature.
 *
 * Canonical JSON per SnapTrade spec:
 *   - { "content": <body or null>, "path": "...", "query": "..." }
 *   - Keys sorted alphabetically at all nesting levels
 *   - No whitespace
 *   - Sign with HMAC-SHA256(consumerKey, canonical) → base64
 */
export function signRequest(
  path: string,
  query: string,
  body: Record<string, unknown> | null = null,
): string {
  const { consumerKey } = getCredentials();

  const payload = sortKeys({
    content: body ?? null,
    path,
    query,
  }) as Record<string, unknown>;

  // NOTE: Do NOT use a replacer array — it applies recursively and strips
  // nested keys like content.userId / content.userSecret, breaking the signature.
  const canonical = JSON.stringify(payload);

  const hmac = crypto.createHmac('sha256', consumerKey);
  hmac.update(canonical);
  return hmac.digest('base64');
}

/**
 * Build the full authenticated URL + headers for a SnapTrade API call.
 *
 * @param path   - API path (e.g. "/snapTrade/partners")
 * @param body   - Request body for POST/PUT, null for GET
 * @param extraParams - Additional query parameters (e.g. { userId: "...", userSecret: "..." })
 * @returns { url, headers } ready for fetch()
 */
export function buildSnapTradeRequest(
  path: string,
  body: Record<string, unknown> | null = null,
  extraParams: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const { clientId } = getCredentials();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Build query string: clientId + timestamp are always required
  const params = new URLSearchParams({ clientId, timestamp, ...extraParams });
  const query = params.toString();

  const signature = signRequest(path, query, body);

  const headers: Record<string, string> = {
    Signature: signature,
  };

  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  return {
    url: `https://api.snaptrade.com${path}?${query}`,
    headers,
  };
}

/**
 * Make an authenticated request to the SnapTrade API.
 *
 * @returns Parsed JSON response
 * @throws On non-2xx responses (with parsed error detail when available)
 */
export async function snapTradeFetch<T = unknown>(
  path: string,
  body: Record<string, unknown> | null = null,
  extraParams: Record<string, string> = {},
  options: { method?: string } = {},
): Promise<T> {
  const { url, headers } = buildSnapTradeRequest(path, body, extraParams);

  const method = body !== null ? 'POST' : options.method || 'GET';

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body !== null) {
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    throw new Error(
      `SnapTrade network error: ${err instanceof Error ? err.message : 'Unknown'}`,
    );
  }

  if (!response.ok) {
    let errorBody: Record<string, unknown> = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error
    }
    const detail =
      (errorBody.default_detail as string) ||
      (errorBody.detail as string) ||
      (errorBody.error as string) ||
      response.statusText ||
      'Unknown error';

    throw new Error(`SnapTrade API ${response.status}: ${detail}`);
  }

  if (response.status === 204) return null as T;

  return response.json() as Promise<T>;
}

// ─── Safe context for route handlers ─────────────────────────

/** Non-sensitive broker metadata — safe to send to the client. */
export interface BrokerInfo {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  description: string;
  logoUrl: string;
  allowsTrading: boolean;
  allowsFractionalUnits: boolean | null;
  allowsCrypto: boolean;
  releaseStage: string;
  authTypes: Array<{ type: string; authType: string }>;
}

/**
 * Get the list of allowed brokerages from SnapTrade.
 * Results are cached for BROKER_CACHE_TTL_MS (default 1 hour).
 */
let _brokerCache: { data: BrokerInfo[]; timestamp: number } | null = null;
const BROKER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getAllowedBrokerages(): Promise<BrokerInfo[]> {
  if (_brokerCache && Date.now() - _brokerCache.timestamp < BROKER_CACHE_TTL_MS) {
    return _brokerCache.data;
  }

  const response = await snapTradeFetch<{
    allowed_brokerages: Array<Record<string, unknown>>;
  }>('/snapTrade/partners');

  const brokerages = (response.allowed_brokerages || []).map(
    (b: Record<string, unknown>): BrokerInfo => ({
      id: b.id as string,
      slug: b.slug as string,
      name: b.name as string,
      displayName: (b.display_name as string) || (b.name as string),
      description: (b.description as string) || '',
      logoUrl: (b.aws_s3_logo_url as string) || (b.aws_s3_square_logo_url as string) || '',
      allowsTrading: (b.allows_trading as boolean) || false,
      allowsFractionalUnits: b.allows_fractional_units as boolean | null,
      allowsCrypto: (b.allows_cryptocurrency_symbols as boolean) || false,
      releaseStage: (b.release_stage as string) || 'UNKNOWN',
      authTypes: ((b.authorization_types as Array<{ type: string; auth_type: string }>) || []).map(
        (a) => ({ type: a.type, authType: a.auth_type }),
      ),
    }),
  );

  _brokerCache = { data: brokerages, timestamp: Date.now() };
  return brokerages;
}

/** Clear the in-memory broker cache (useful after API key changes). */
export function clearBrokerCache(): void {
  _brokerCache = null;
}
