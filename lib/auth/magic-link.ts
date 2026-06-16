// ─── Magic Link Utilities ────────────────────────────────────
// Shared helpers for signing and verifying anonymous IDs
// during the magic-link authentication flow.
//
// signAnonId()  — HMAC-SHA256 signs the anonymousId with SESSION_SECRET
// verifyAnonId() — verifies the signature, returns original ID or null

import crypto from 'crypto';

/**
 * Signs the anonymous ID to prevent tampering.
 * Uses HMAC-SHA256 with SESSION_SECRET.
 */
export function signAnonId(anonymousId: string): string {
  const secret = process.env.SESSION_SECRET || 'vantage-dev-secret';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(anonymousId);
  return `${anonymousId}.${hmac.digest('hex')}`;
}

/**
 * Verifies a signed anonymous ID.
 * Returns the original ID if valid, null if tampered.
 */
export function verifyAnonId(signed: string): string | null {
  const dotIndex = signed.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const id = signed.slice(0, dotIndex);
  const expected = signAnonId(id);
  return expected === signed ? id : null;
}
