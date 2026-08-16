-- Migration: marker_executions
-- Links specific [RECOMMEND:...] marker instances to order_history records.
-- Persists buy/sell execution state per (message_id, symbol) pair so buttons
-- show "✓ Bought" permanently across page reloads and chat history loads.
CREATE TABLE IF NOT EXISTS marker_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  executed_shares NUMERIC NOT NULL,
  executed_amount NUMERIC NOT NULL,
  order_id UUID,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_marker_executions_user ON marker_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_marker_executions_message ON marker_executions(message_id);

-- Enable RLS
ALTER TABLE marker_executions ENABLE ROW LEVEL SECURITY;

-- Users can read their own executions
CREATE POLICY "Users can read own marker executions"
  ON marker_executions FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own executions
CREATE POLICY "Users can insert own marker executions"
  ON marker_executions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admin bypass (uses the users.is_admin column — migration 029;
-- there is no is_admin() function in this schema)
CREATE POLICY "Admins can manage all marker executions"
  ON marker_executions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true
  ));
