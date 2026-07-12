// ─── Backup Codes ────────────────────────────────────────────
// Generates 8 single-use backup codes for TOTP recovery.
// Codes stored hashed (SHA-256). Only plaintext shown once at setup.
// Server-only — never imported by client code.

import { createHash } from 'crypto';

const CODE_COUNT = 8;
const CODE_LENGTH = 12; // 12-character readable codes

/**
 * Generate 8 unique backup codes.
 * Returns [{ plaintext, hash }] — display plaintext once, store hash in DB.
 */
export function generateBackupCodes(): Array<{ plaintext: string; hash: string }> {
  const codes: Array<{ plaintext: string; hash: string }> = [];
  const seen = new Set<string>();

  while (codes.length < CODE_COUNT) {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    // Encode as base32-like alphanumeric (uppercase letters + digits, no confusing chars)
    const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      const idx = bytes[i % bytes.length] % charset.length;
      code += charset[idx];
    }

    if (seen.has(code)) continue;
    seen.add(code);

    const hash = hashBackupCode(code);
    codes.push({ plaintext: code, hash });
  }

  return codes;
}

/**
 * Hash a backup code for storage/comparison.
 */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Verify a backup code against the stored hashed codes array.
 * Returns true if the code matches an unused backup code.
 * Caller must mark the matched code as used after successful verification.
 */
export function verifyBackupCode(
  code: string,
  storedCodes: Array<{ hash: string; used: boolean }>,
): { valid: boolean; index: number } {
  const hash = hashBackupCode(code.toUpperCase().replace(/[\s-]/g, ''));
  const idx = storedCodes.findIndex((c) => c.hash === hash && !c.used);
  return { valid: idx !== -1, index: idx };
}
