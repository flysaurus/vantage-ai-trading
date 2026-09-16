-- 076_test_runner.sql
-- Manual + automated QA "Test Runner".
--
-- Lets the team capture test cases (bug-tracker style TC-### numbers), group
-- them into test cycles (e.g. "Pre-release smoke"), and record pass/fail runs
-- against a cycle from a public, no-auth mobile page. Failing runs are
-- reported to GitHub Issues by the application layer (see lib/qa/github.ts).
--
-- Security model:
--   All four tables are RLS-enabled with NO permissive policies. Every read
--   and write happens server-side through the service-role client
--   (createServerClient() in lib/supabase.ts), which bypasses RLS. The
--   public test-runner pages never touch these tables directly — they go
--   through the API routes under app/api/test-runner/**.
--
-- Idempotent guards mirror supabase/migrations/075_investment_experience.sql.

-- ── test_cases ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_number       TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  steps           TEXT,
  expected_result TEXT,
  area            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── test_cycles ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_cycles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  active     BOOLEAN DEFAULT true
);

-- ── test_runs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id  UUID REFERENCES test_cases(id) ON DELETE CASCADE,
  cycle_id      UUID REFERENCES test_cycles(id) ON DELETE CASCADE,
  tester_name   TEXT,
  result        TEXT CHECK (result IN ('pass', 'fail')),
  notes         TEXT,
  screenshot_url TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── test_cycle_cases (cycle ↔ case assignment) ────────────────
CREATE TABLE IF NOT EXISTS test_cycle_cases (
  cycle_id     UUID REFERENCES test_cycles(id) ON DELETE CASCADE,
  test_case_id UUID REFERENCES test_cases(id) ON DELETE CASCADE,
  PRIMARY KEY (cycle_id, test_case_id)
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_test_runs_cycle
  ON test_runs (cycle_id);

CREATE INDEX IF NOT EXISTS idx_test_runs_case_created
  ON test_runs (test_case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_cycle_cases_cycle
  ON test_cycle_cases (cycle_id);

-- ── Row Level Security ────────────────────────────────────────
-- RLS on, no policies: the anon/authenticated keys can do nothing here.
-- Service-role (server-side only) bypasses RLS. See header note.
ALTER TABLE test_cases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cycles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cycle_cases ENABLE ROW LEVEL SECURITY;

-- ── Screenshot storage ────────────────────────────────────────
-- Public bucket so <img src> works from the test-runner feedback screens.
INSERT INTO storage.buckets (id, name, public)
VALUES ('test-screenshots', 'test-screenshots', true)
ON CONFLICT (id) DO NOTHING;
