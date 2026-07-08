-- 022: Fix insert_chat_message RPC — add public to search_path
-- Run this in Supabase SQL Editor.
-- The RPC had SET search_path = '' which prevents finding
-- the chat_messages table when called from the client.

CREATE OR REPLACE FUNCTION insert_chat_message(
  p_user_id UUID,
  p_role TEXT,
  p_content TEXT,
  p_message_type TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Clean old messages first
  PERFORM cleanup_old_chat_messages(p_user_id);

  -- Insert new message
  INSERT INTO chat_messages (user_id, role, content, message_type)
  VALUES (p_user_id, p_role, p_content, p_message_type)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
