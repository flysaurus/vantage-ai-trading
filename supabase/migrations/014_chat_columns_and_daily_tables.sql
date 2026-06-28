-- 014: Add missing chat_messages columns + create daily/weekly tables
-- Run this in Supabase SQL Editor (idempotent — all IF NOT EXISTS / IF EXISTS)

-- ─── Part 1: Add missing columns to chat_messages ───
ALTER TABLE IF EXISTS public.chat_messages
  ADD COLUMN IF NOT EXISTS message_type text,
  ADD COLUMN IF NOT EXISTS investor_style text,
  ADD COLUMN IF NOT EXISTS related_stocks jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- ─── Part 2: Daily briefs + weekly snapshots ───
CREATE TABLE IF NOT EXISTS public.daily_briefs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  content text NOT NULL,
  market_summary jsonb,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS public.weekly_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  health_score numeric,
  risk_level text,
  opportunities_count integer,
  content text NOT NULL,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, week_start)
);

ALTER TABLE public.daily_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist (from previous manual runs), then re-create
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users own daily briefs" ON public.daily_briefs;
  DROP POLICY IF EXISTS "Users own weekly snapshots" ON public.weekly_snapshots;
END $$;

CREATE POLICY "Users own daily briefs"
  ON public.daily_briefs FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users own weekly snapshots"
  ON public.weekly_snapshots FOR ALL
  USING (auth.uid() = user_id);
