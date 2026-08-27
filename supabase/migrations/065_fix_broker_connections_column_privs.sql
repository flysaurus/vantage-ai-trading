-- ═══════════════════════════════════════════════════════════
-- Migration: 065_fix_broker_connections_column_privs.sql
-- Purpose: Actually restrict client-side (anon/authenticated) SELECT on the
--          broker secret columns. Migration 064's `REVOKE SELECT (col)` was a
--          NO-OP: Supabase grants TABLE-LEVEL SELECT to anon/authenticated by
--          default, and in Postgres a column-level REVOKE does NOT remove a
--          column that is still covered by a table-level GRANT.
--
--          Fix: (1) drop the table-level SELECT from client roles, then
--          (2) re-grant column-level SELECT on the NON-secret columns only.
--          All app code reads broker_connections via service_role (server
--          routes), so nothing breaks. anon gets nothing (RLS already yields
--          0 rows for anon anyway).
--
-- Date: 2026-08-27
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- 1. Remove the table-level SELECT that made 064's column REVOKE ineffective.
REVOKE SELECT ON public.broker_connections FROM anon, authenticated;

-- 2. Re-grant column-level SELECT to `authenticated` on NON-secret columns only.
--    Secret columns (snaptrade_user_secret_encrypted, snaptrade_user_secret) and
--    legacy broker-key columns (encrypted_api_key, encrypted_secret) are excluded.
GRANT SELECT (
  id,
  user_id,
  connection_type,
  status,
  sync_started_at,
  sync_completed_at,
  error_message,
  created_at,
  updated_at,
  trading_enabled,
  snaptrade_broker_id,
  snaptrade_user_id,
  brokerage_slug,
  snaptrade_connection_id,
  snaptrade_accounts
) ON public.broker_connections TO authenticated;

-- 3. Belt-and-suspenders: re-assert column-level revoke (now meaningful, since
--    the table-level grant is gone). Explicitly excludes the secret columns and
--    the legacy broker-key columns from any client read path.
REVOKE SELECT (
  snaptrade_user_secret_encrypted,
  snaptrade_user_secret,
  encrypted_api_key,
  encrypted_secret
) ON public.broker_connections FROM anon, authenticated;

COMMIT;
