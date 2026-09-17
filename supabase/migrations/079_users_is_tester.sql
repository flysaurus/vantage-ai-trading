-- ============================================================
-- Migration 079: is_tester flag (BugPin bug-report widget)
-- ============================================================
-- Adds a boolean flag on public.users used to gate the BugPin
-- bug-report widget in the Vantage client.
--
--   is_tester = true  → the BugPin embed script is injected on
--                       any page this user loads (client-side only).
--   is_tester = false → nothing BugPin-related is rendered at all.
--
-- Defaults to FALSE, so every existing user is unaffected and the
-- widget is strictly opt-in per tester. Flip it from /admin → Users
-- (the "Tester" toggle) — no DB console needed.
--
-- Idempotent: safe to run repeatedly. No backfill (default covers
-- existing rows).
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_tester BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_tester IS
  'Designated tester: renders the BugPin bug-report widget in the app (client-side only). Managed from /admin → Users.';

-- Partial index: the tester set is tiny, but this keeps the rare
-- "list testers" lookup cheap without bloating the table index.
CREATE INDEX IF NOT EXISTS idx_users_is_tester
  ON public.users (is_tester)
  WHERE is_tester;

-- ── Verify (read-only) ──────────────────────────────────────
-- SELECT id, email, is_tester FROM public.users WHERE is_tester ORDER BY email;
