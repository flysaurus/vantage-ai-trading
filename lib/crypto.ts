import * as argon2 from 'argon2';
import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY not set in environment variables');
}

// ============================================================================
// PASSWORD HASHING (Argon2)
// ============================================================================

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
      salt: Buffer.from(salt, 'hex'),
    });

    console.log('✅ Password hashed');
    return { hash, salt };
  } catch (err) {
    console.error('❌ Hash error:', err);
    throw err;
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const match = await argon2.verify(hash, password);
    return match;
  } catch (err) {
    console.error('❌ Verify error:', err);
    return false;
  }
}

// ============================================================================
// TOKEN HASHING (for email verification, password reset)
// ============================================================================

export function generateToken(): { token: string; hash: string; salt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(token, salt, 100000, 32, 'sha256')
    .toString('hex');

  return { token, hash, salt };
}

export function verifyToken(token: string, storedHash: string, storedSalt: string): boolean {
  const hash = crypto
    .pbkdf2Sync(token, storedSalt, 100000, 32, 'sha256')
    .toString('hex');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

// ============================================================================
// PER-USER KEY DERIVATION
// ============================================================================

/**
 * Derive a per-user encryption key from userId + VAULT_ENCRYPTION_KEY.
 * Uses SHA-256 to produce a deterministic 32-byte key for AES-256-GCM.
 *
 * Each user's credentials are encrypted with a uniquely derived key.
 * Even if the global secret leaks, credentials can't be decrypted
 * without knowing the specific user ID used in derivation.
 *
 * Falls back to ENCRYPTION_KEY if VAULT_ENCRYPTION_KEY is not set.
 */
export function deriveUserKey(userId: string): Buffer {
  const masterKey = process.env.VAULT_ENCRYPTION_KEY || ENCRYPTION_KEY;
  const hash = crypto.createHash('sha256');
  hash.update(userId + masterKey);
  return hash.digest(); // 32-byte Buffer
}

// ============================================================================
// ENCRYPTION/DECRYPTION (AES-256-GCM for API credentials)
// ============================================================================

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param key - Optional 32-byte key Buffer. Defaults to global ENCRYPTION_KEY.
 * @returns Encrypted data in format: iv:authTag:ciphertext (all hex-encoded)
 */
export function encryptData(plaintext: string, key?: Buffer): string {
  try {
    const keyBuffer = key || Buffer.from(ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('❌ Encryption error:', err);
    throw err;
  }
}

/**
 * Decrypt data encrypted with AES-256-GCM.
 *
 * @param encryptedData - String in format: iv:authTag:ciphertext
 * @param key - Optional 32-byte key Buffer. Defaults to global ENCRYPTION_KEY.
 * @returns Decrypted plaintext string
 */
export function decryptData(encryptedData: string, key?: Buffer): string {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid encrypted data format');
    }

    const keyBuffer = key || Buffer.from(ENCRYPTION_KEY, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('❌ Decryption error:', err);
    throw err;
  }
}

// ============================================================================
// SESSION TOKEN (JWT-like, but simple)
// ============================================================================

const SESSION_SECRET = process.env.SESSION_SECRET || '';

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
