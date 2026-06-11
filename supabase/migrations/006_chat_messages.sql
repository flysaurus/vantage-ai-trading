-- ═══════════════════════════════════════════════════════════════
-- Chat Messages — 7-day rolling chat history
-- ═══════════════════════════════════════════════════════════════

-- 1. Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created
  ON chat_messages(user_id, created_at DESC);

-- 2. Cleanup function — delete messages older than 7 days
CREATE OR REPLACE FUNCTION cleanup_old_chat_messages(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM chat_messages
  WHERE user_id = p_user_id
    AND created_at < now() - INTERVAL '7 days';
END;
$$;

-- 3. Insert message helper — auto-cleans old messages
CREATE OR REPLACE FUNCTION insert_chat_message(
  p_user_id UUID,
  p_role TEXT,
  p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Clean old messages first
  PERFORM cleanup_old_chat_messages(p_user_id);

  -- Insert new message
  INSERT INTO chat_messages (user_id, role, content)
  VALUES (p_user_id, p_role, p_content)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4. Get today's message count for a user
CREATE OR REPLACE FUNCTION get_todays_message_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT message_count INTO v_count
  FROM ai_usage
  WHERE user_id = p_user_id
    AND date = CURRENT_DATE;

  RETURN COALESCE(v_count, 0);
END;
$$;
