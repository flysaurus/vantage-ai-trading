-- 021: RLS policies for chat_messages
-- Enables CRUD for authenticated users on their own messages.
-- Required because RLS is enabled on chat_messages but no
-- policies existed — all reads/writes were silently blocked.
-- Run this in Supabase SQL Editor (idempotent).

-- Enable RLS (safe if already enabled)
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (for idempotency)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can read own chat messages" ON public.chat_messages;
  DROP POLICY IF EXISTS "Users can insert own chat messages" ON public.chat_messages;
  DROP POLICY IF EXISTS "Users can delete own chat messages" ON public.chat_messages;
  DROP POLICY IF EXISTS "Service role can manage chat_messages" ON public.chat_messages;
END
$$;

-- Policy: Users can read their own messages
CREATE POLICY "Users can read own chat messages" ON public.chat_messages
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert messages (must set their own user_id)
CREATE POLICY "Users can insert own chat messages" ON public.chat_messages
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own messages
CREATE POLICY "Users can delete own chat messages" ON public.chat_messages
  FOR DELETE
  USING (auth.uid() = user_id);

-- Policy: Service role bypasses RLS for all operations
CREATE POLICY "Service role can manage chat_messages" ON public.chat_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);
