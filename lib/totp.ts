// ─── TOTP Utilities ──────────────────────────────────────────
// Uses speakeasy for TOTP generation & verification.
// Server-only — never imported by client code.
// Imports speakeasy dynamically to avoid bundling native deps client-side.

import type speakeasy from 'speakeasy';

let _speakeasy: typeof speakeasy | null = null;
async function getSpeakeasy(): Promise<typeof speakeasy> {
  if (!_speakeasy) {
    _speakeasy = await import('speakeasy');
  }
  return _speakeasy;
}

export interface TotpSetup {
  secret: string;        // base32 secret (store this)
  otpauthUrl: string;    // otpauth:// URI for QR code
  manualKey: string;     // human-readable key for manual entry
}

/**
 * Generate a new TOTP secret + otpauth URL for QR code.
 * Call once during setup, store `secret` in DB.
 */
export async function generateTotpSecret(
  email: string,
  issuer = 'Vantage',
): Promise<TotpSetup> {
  const s = await getSpeakeasy();
  const secretObj = s.generateSecret({
    name: `Vantage:${email}`,
    length: 20, // 160 bits
  });

  return {
    secret: secretObj.base32,
    otpauthUrl: secretObj.otpauth_url || '',
    manualKey: secretObj.base32,
  };
}

/**
 * Verify a TOTP token against a stored secret.
 * Returns true if valid, false if not.
 */
export async function verifyTotpToken(
  secret: string,
  token: string,
): Promise<boolean> {
  if (!token || token.length !== 6) return false;

  try {
    const s = await getSpeakeasy();
    const result = s.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1, // Allow ±1 period (30s tolerance) = up to 90s clock skew
    });
    return result;
  } catch {
    return false;
  }
}

/**
 * Generate a TOTP token for the current time window.
 * Used only for testing — never exposed in production.
 */
export async function generateTotpToken(secret: string): Promise<string> {
  const s = await getSpeakeasy();
  return s.totp({
    secret,
    encoding: 'base32',
  });
}
