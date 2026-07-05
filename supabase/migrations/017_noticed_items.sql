-- 017_noticed_items.sql
-- AI Noticed proactive feed — persisted trigger state with LLM-generated copy

CREATE TABLE IF NOT EXISTS noticed_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_type    TEXT NOT NULL,   -- 'idle_cash' | 'position_milestone' | 'earnings_proximity'
  trigger_key     TEXT NOT NULL,   -- stable dedup key, e.g. 'idle_cash' | 'MILESTONE_AAPL_+15' | 'EARNINGS_MSFT_2026-08-15'
  title           TEXT,
  body            TEXT NOT NULL,   -- Haiku-generated 1-2 sentence observation
  follow_up       TEXT,            -- pre-fill chat question, e.g. "What should I do with my idle cash?"
  variant         TEXT NOT NULL DEFAULT 'accent',  -- 'accent' | 'warn' | 'gain'
  icon            TEXT DEFAULT '📊',
  meta            JSONB DEFAULT '{}',  -- { cashPct, daysIdle, symbol, threshold, earningsDate, ... }
  resolved        BOOLEAN NOT NULL DEFAULT false,
  dismissed_until TIMESTAMPTZ,     -- NULL = visible, future = hidden, '1970-01-01' = permanent dismiss
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_count INT DEFAULT 0,  -- how many times re-triggered after resolution
  UNIQUE(user_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS idx_noticed_user_visible
  ON noticed_items(user_id, resolved, dismissed_until)
  WHERE resolved = false;
