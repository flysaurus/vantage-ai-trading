-- 018_ai_facts.sql
-- Shared AI facts memory table — ground generations in previously concluded facts.
-- Wired into Daily Brief, Weekly Snapshot, greeting, chat, and Noticed engine
-- in follow-up changesets after this foundation is confirmed working.

-- ── Custom ENUMs ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE fact_type AS ENUM (
    'observation',   -- stated fact about current state (e.g. "financials concentration is 59%")
    'question',      -- acknowledged unknown/gap that hasn't been resolved (e.g. "cause of AXP drawdown not yet investigated")
    'recommendation',-- suggested action — MUST reference ≥1 observation in based_on; MUST NOT be confident/directive if chain contains unconfirmed
    'user_action'    -- something the user did or told the AI — resolves/supersedes related question + recommendation facts
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE fact_confidence AS ENUM (
    'confirmed',
    'tentative',
    'unconfirmed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE fact_status AS ENUM (
    'active',
    'superseded',
    'resolved',
    'stale'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,          -- e.g. 'AXP', 'portfolio_concentration_financials', 'user_cash_deployment'
  fact_type       fact_type NOT NULL,
  claim           TEXT NOT NULL,          -- short content, e.g. "Drawdown cause unconfirmed as of Jul 6"
  confidence      fact_confidence NOT NULL DEFAULT 'unconfirmed',
  based_on        UUID[] DEFAULT NULL,    -- fact ids this recommendation is grounded in; NULL for observations/questions
  source          TEXT NOT NULL,          -- 'greeting' | 'daily_brief' | 'weekly_snapshot' | 'chat' | 'noticed_engine'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ DEFAULT NULL, -- volatile facts auto-expire; NULL = slow-changing/structural fact
  status          fact_status NOT NULL DEFAULT 'active',
  superseded_by   UUID DEFAULT NULL       -- REFERENCES ai_facts(id) — self-ref for soft-links when replaced
);

-- ── Indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ai_facts_user_active
  ON ai_facts(user_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ai_facts_user_subject
  ON ai_facts(user_id, subject);

CREATE INDEX IF NOT EXISTS idx_ai_facts_expires
  ON ai_facts(user_id, expires_at)
  WHERE expires_at IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────

ALTER TABLE ai_facts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users own ai facts" ON ai_facts;
END $$;

CREATE POLICY "Users own ai facts" ON ai_facts
  FOR ALL
  USING (user_id = (SELECT id FROM users WHERE id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM users WHERE id = auth.uid()));
