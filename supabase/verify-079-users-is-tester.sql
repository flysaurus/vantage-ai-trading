-- ============================================================
-- verify-079 — read-only checks for the is_tester migration
-- Run AFTER 079_users_is_tester.sql. Changes nothing.
-- ============================================================

-- 1. Column exists, correct type, NOT NULL, defaults to false
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name = 'is_tester';
-- expect: is_tester | boolean | NO | false

-- 2. Partial index present
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'users'
  AND indexname = 'idx_users_is_tester';
-- expect: ... WHERE is_tester

-- 3. Nobody is a tester yet (default state after migrating)
SELECT COUNT(*) AS total_users,
       COUNT(*) FILTER (WHERE is_tester) AS testers
FROM public.users;
-- expect: testers = 0

-- 4. Current testers (empty right after the migration)
SELECT id, email, is_tester
FROM public.users
WHERE is_tester
ORDER BY email;
