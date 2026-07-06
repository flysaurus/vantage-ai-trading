-- 019_ai_generation_log.sql
-- Per-generation read/write audit log for AI Facts observability.
-- Records what facts were available, what was injected into prompts,
-- and what facts were written back after generation.
-- 
-- Used by: /api/admin/facts + /api/admin/generation-log admin views.

CREATE TABLE IF NOT EXISTS ai_generation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  surface         TEXT NOT NULL,          -- 'weekly_snapshot', 'greeting', 'daily_brief', 'chat', 'noticed'
  facts_read      JSONB DEFAULT '[]',     -- raw AiFact[] returned by getActiveFacts()
  prompt_context  TEXT DEFAULT '',        -- formatted string from formatFactsForPrompt()
  facts_written   JSONB DEFAULT '[]',     -- WriteFactResult[] written back post-generation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for per-user timeline queries
CREATE INDEX IF NOT EXISTS idx_ai_gen_log_user_surface
  ON ai_generation_log(user_id, surface, created_at DESC);

-- Index for debugging by surface
CREATE INDEX IF NOT EXISTS idx_ai_gen_log_surface
  ON ai_generation_log(surface, created_at DESC);

-- RLS: users can read their own (this is admin data, but let's keep it)
ALTER TABLE ai_generation_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users own generation logs" ON ai_generation_log;
END $$;

CREATE POLICY "Users own generation logs" ON ai_generation_log
  FOR ALL
  USING (user_id = (SELECT id FROM users WHERE id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM users WHERE id = auth.uid()));
