-- ═══════════════════════════════════════════════════════════════
-- Migration 064: MFA TOTP secret encryption + broker secret lockdown
--
-- 1. Widen users.totp_secret to TEXT — the encrypted payload is a JSON
--    blob (~122 chars), so VARCHAR(128) was tight and misleading for an
--    encrypted value.
-- 2. Correct the column comment to reflect AES-256-GCM encryption (the old
--    comment claimed "encrypted at rest" while the value was plaintext).
-- 3. Revoke client-side (anon/authenticated) SELECT on
--    broker_connections.snaptrade_user_secret_encrypted so the ciphertext is
--    never readable by the browser. Server routes use service_role (unaffected
--    by this revoke). RLS is row-level; this is the correct column-level control.
--
-- NOTE: the actual crypto migration (encrypting existing plaintext totp_secret
-- rows and re-encrypting the pre-HKDF snaptrade_user_secret_encrypted row) is
-- done by a Node script (crypto is app-side, per-user keys), NOT by this file.
-- ═══════════════════════════════════════════════════════════════

-- 1. Widen for the encrypted payload
ALTER TABLE public.users
  ALTER COLUMN totp_secret TYPE TEXT;

-- 2. Correct the misleading comment
COMMENT ON COLUMN public.users.totp_secret IS
  'AES-256-GCM encrypted TOTP secret (JSON {encrypted,iv,authTag}, per-user HKDF-derived key). See lib/vault.ts encryptForUser.';

-- 3. Revoke client-side SELECT on the encrypted broker secret column(s)
REVOKE SELECT (snaptrade_user_secret_encrypted) ON public.broker_connections FROM anon, authenticated;
REVOKE SELECT (snaptrade_user_secret) ON public.broker_connections FROM anon, authenticated;
