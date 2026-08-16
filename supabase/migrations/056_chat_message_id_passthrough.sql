-- ─────────────────────────────────────────────────────────────────────────
-- 056: Chat message id passthrough
-- ─────────────────────────────────────────────────────────────────────────
-- Problem: the AI chat client generates its own message id
-- (`crypto.randomUUID()`) and uses it as the `messageId` passed to
-- execute-trade (idempotency key, trade-gate lookup, marker-executions).
-- But `insert_chat_message` always minted a FRESH id server-side, so
-- `chat_messages.id` never matched `messageId`.
--
-- Consequences this fixes:
--   1. trade-gate's company-name cross-check silently failed open for every
--      AI order (it looked up chat_messages.id = messageId → not found).
--   2. marker_executions could never link a marker back to its chat message.
--
-- Fix: let the caller pass an explicit id; fall back to gen_random_uuid()
-- when none is provided (backward-compatible — every existing call site
-- passes no id and keeps its current behavior).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION insert_chat_message(
  p_user_id UUID,
  p_role TEXT,
  p_content TEXT,
  p_message_type TEXT DEFAULT NULL,
  p_account_id TEXT DEFAULT NULL,
  p_id UUID DEFAULT NULL
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

  IF p_id IS NOT NULL THEN
    -- Caller-supplied id — preserves the client's message id so downstream
    -- lookups (trade-gate, idempotency, marker-executions) resolve correctly.
    INSERT INTO chat_messages (id, user_id, role, content, message_type, account_id)
    VALUES (p_id, p_user_id, p_role, p_content, p_message_type, COALESCE(p_account_id, 'demo'))
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_id;

    -- id collision (shouldn't happen with UUIDs, but be safe): mint a fresh id
    -- so the save never fails and the message is never lost.
    IF v_id IS NULL THEN
      INSERT INTO chat_messages (user_id, role, content, message_type, account_id)
      VALUES (p_user_id, p_role, p_content, p_message_type, COALESCE(p_account_id, 'demo'))
      RETURNING id INTO v_id;
    END IF;
  ELSE
    -- No id supplied — original behavior (server-generated uuid)
    INSERT INTO chat_messages (user_id, role, content, message_type, account_id)
    VALUES (p_user_id, p_role, p_content, p_message_type, COALESCE(p_account_id, 'demo'))
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMIT;
