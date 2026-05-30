-- 004_rebalance_sessions.sql
-- Temporary storage for AI-generated rebalance plans
-- Sessions expire after 1 hour
CREATE TABLE IF NOT EXISTS public.rebalance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  trades jsonb NOT NULL,
  summary text,
  source text DEFAULT 'ai_chat',
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT now() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_rebalance_sessions_user_id ON rebalance_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_rebalance_sessions_expires_at ON rebalance_sessions(expires_at);
