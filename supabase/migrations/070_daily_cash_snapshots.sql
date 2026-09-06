-- 070: Daily cash snapshots for the idle-cash Noticed trigger.
--
-- One row per user per trading day recording available cash (settled cash −
-- open reservations). Used to detect "cash idle for 3+ consecutive trading
-- days" so the idle-cash trigger can fire on a dollar threshold + streak
-- instead of the old percentage-based heuristic.

CREATE TABLE IF NOT EXISTS public.daily_cash_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  available_cash numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.daily_cash_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own cash snapshots" ON public.daily_cash_snapshots;
CREATE POLICY "Users own cash snapshots"
  ON public.daily_cash_snapshots FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS daily_cash_snapshots_user_date_idx
  ON public.daily_cash_snapshots(user_id, date DESC);
