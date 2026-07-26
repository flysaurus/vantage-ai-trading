-- ─── validation_failures — Log AI recommendation validation failures ───
-- Records every time validateRecommendations() rejects an AI response,
-- including the raw markers, failure reasons, and retry outcomes.
-- This is operational signal: if certain failures recur, the AI prompt
-- itself needs tuning.

CREATE TABLE IF NOT EXISTS validation_failures (
  id            bigserial PRIMARY KEY,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  attempt       smallint NOT NULL DEFAULT 1,  -- 1 = first attempt, 2 = retry
  session_id    text,                          -- chat session UUID for correlation
  prompt        text,                          -- the user's original message
  raw_response  text,                          -- the AI's raw response (truncated to 5000 chars)
  raw_markers   text[],                        -- all [RECOMMEND:...] tags found in response
  failures      jsonb NOT NULL DEFAULT '[]',   -- array of ValidationFailure objects
  budget        numeric,                       -- requested budget (if detected)
  allocation    numeric,                       -- actual total from markers (if parsed)
  resolved      boolean NOT NULL DEFAULT false, -- whether a retry eventually passed
  retry_failures jsonb,                        -- failures from retry attempt (if retry also failed)
  created_retry  timestamptz                   -- when retry was triggered (null if no retry)
);

-- Index for reviewing recent failures
CREATE INDEX IF NOT EXISTS idx_validation_failures_created
  ON validation_failures (created_at DESC);

-- Index for finding per-user failure patterns
CREATE INDEX IF NOT EXISTS idx_validation_failures_user
  ON validation_failures (user_id, created_at DESC);

-- Index for tracking unresolved failures
CREATE INDEX IF NOT EXISTS idx_validation_failures_unresolved
  ON validation_failures (resolved, created_at DESC)
  WHERE resolved = false;

-- Comment
COMMENT ON TABLE validation_failures IS 'AI recommendation validation failures for prompt tuning and monitoring';
