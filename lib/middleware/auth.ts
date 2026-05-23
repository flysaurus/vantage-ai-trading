// ─── API Route Middleware ──────────────────────────────────────
// Composable middleware wrappers for Next.js API routes.
//
// Usage:
//   export const POST = withAuth(async (req) => { ... });
//   export const GET = withVault(async (req) => {
//     const { apiKey, secretKey } = req.vault; // decrypted keys
//   });
//   export const POST = withAuth(withRateLimit(async (req, ctx) => { ... }));

import { createServerClient } from '../supabase';
import { NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  userId: string;
  sessionToken: string;
}

export interface VaultRequest extends AuthenticatedRequest {
  vault: {
    apiKey: string;
    secretKey: string;
  };
}

type RouteHandler = (req: Request, context?: any) => Promise<Response>;

// ─── withAuth ─────────────────────────────────────────────────

/**
 * Wraps an API route handler with authentication.
 * Validates the Authorization: Bearer <token> header.
 * Returns 401 if no valid session is found.
 */
export function withAuth(handler: RouteHandler): RouteHandler {
  return async (request: Request, context?: any) => {
    try {
      const authHeader = request.headers.get('Authorization');

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Missing or invalid Authorization header' },
          { status: 401 }
        );
      }

      const token = authHeader.slice(7);

      // Validate token with Supabase
      const supabase = createServerClient();
      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user) {
        return NextResponse.json(
          { error: 'Invalid or expired token' },
          { status: 401 }
        );
      }

      // Attach user info to the request
      const authenticatedReq = request as AuthenticatedRequest;
      authenticatedReq.userId = data.user.id;
      authenticatedReq.sessionToken = token;

      return handler(authenticatedReq, context);
    } catch (err) {
      console.error('[withAuth] Unexpected error:', err);
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 500 }
      );
    }
  };
}

// ─── withVault ────────────────────────────────────────────────

/**
 * Wraps an API route handler with vault key decryption.
 * Requires withAuth to run first.
 * Decrypts Alpaca API keys and attaches them to request.vault.
 * Returns 500 if vault decryption fails.
 */
export function withVault(handler: (req: VaultRequest, context?: any) => Promise<Response>): RouteHandler {
  return async (request: Request, context?: any) => {
    const authReq = request as AuthenticatedRequest;

    if (!authReq.userId) {
      return NextResponse.json(
        { error: 'Authentication required before vault access' },
        { status: 401 }
      );
    }

    try {
      const supabase = createServerClient();
      const encryptionKey = process.env.VAULT_ENCRYPTION_KEY;

      if (!encryptionKey) {
        return NextResponse.json(
          { error: 'Vault encryption key not configured' },
          { status: 500 }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('vault_get_keys', {
        p_user_id: authReq.userId,
        p_encryption_key: encryptionKey,
      });

      if (error) {
        console.error('[withVault] RPC error:', error);
        return NextResponse.json(
          { error: 'Failed to decrypt broker keys' },
          { status: 500 }
        );
      }

      const row = (data as Array<{ api_key: string; secret_key: string }> | null)?.[0];

      if (!row || !row.api_key || !row.secret_key) {
        return NextResponse.json(
          { error: 'No broker keys found. Please configure your Alpaca API keys.' },
          { status: 400 }
        );
      }

      const vaultReq = authReq as VaultRequest;
      vaultReq.vault = {
        apiKey: row.api_key,
        secretKey: row.secret_key,
      };

      return handler(vaultReq, context);
    } catch (err) {
      console.error('[withVault] Unexpected error:', err);
      return NextResponse.json(
        { error: 'Vault operation failed' },
        { status: 500 }
      );
    }
  };
}

// ─── Rate Limiter ─────────────────────────────────────────────

interface RateLimitConfig {
  max: number;      // Maximum requests in the window
  window: number;   // Window duration in milliseconds
}

const _buckets = new Map<string, { count: number; resetAt: number }>();

// Clean up expired buckets periodically (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of _buckets) {
    if (bucket.resetAt < now) {
      _buckets.delete(key);
    }
  }
}, 60_000);

/**
 * Simple in-memory rate limiter.
 * Identifies clients by IP + path combination.
 *
 * Note: This resets on server restart and doesn't work across
 * multiple instances. For production, use Upstash Redis or similar.
 */
export function rateLimit(
  handler: RouteHandler,
  config: RateLimitConfig = { max: 60, window: 60_000 }
): RouteHandler {
  return async (request: Request, context?: any) => {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const url = new URL(request.url);
    const key = `${ip}:${url.pathname}`;

    const now = Date.now();
    const bucket = _buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      _buckets.set(key, { count: 1, resetAt: now + config.window });
    } else {
      bucket.count++;
      if (bucket.count > config.max) {
        return NextResponse.json(
          { error: 'Too many requests' },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)),
            },
          }
        );
      }
    }

    return handler(request, context);
  };
}
