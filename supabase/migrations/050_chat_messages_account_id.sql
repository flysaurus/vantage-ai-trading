-- ═══════════════════════════════════════════════════════════════
-- Migration: chat_messages.account_id — per-account chat isolation
-- Run in: Supabase SQL Editor (idempotent)
-- Purpose: Scope chat history to the active account so switching
--          between Demo ↔ SnapTrade broker accounts shows only that
--          account's conversations.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Add the account_id column (TEXT: 'demo' | 'snaptrade:<connection_id>')
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS account_id TEXT;

-- 2. Backfill: treat all pre-existing chats as demo (the historical default
--    account before per-account isolation existed).
UPDATE public.chat_messages SET account_id = 'demo' WHERE account_id IS NULL;

-- 3. Composite index for the hot query: "messages for a user, one account,
--    newest first".
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_account
  ON public.chat_messages(user_id, account_id, created_at DESC);

-- 4. Update insert_chat_message RPC to accept and store account_id.
CREATE OR REPLACE FUNCTION insert_chat_message(
  p_user_id UUID,
  p_role TEXT,
  p_content TEXT,
  p_message_type TEXT DEFAULT NULL,
  p_account_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Clean old messages first (user-level retention, unchanged)
  PERFORM cleanup_old_chat_messages(p_user_id);

  -- Insert new message with account scope (default to demo for safety)
  INSERT INTO chat_messages (user_id, role, content, message_type, account_id)
  VALUES (p_user_id, p_role, p_content, p_message_type, COALESCE(p_account_id, 'demo'))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMIT;
