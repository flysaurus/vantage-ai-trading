CREATE TABLE IF NOT EXISTS public.daily_briefs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id),
  date date NOT NULL,
  content text NOT NULL,
  market_summary jsonb,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS public.weekly_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id),
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

CREATE POLICY "Users own daily briefs"
  ON public.daily_briefs FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users own weekly snapshots"
  ON public.weekly_snapshots FOR ALL
  USING (auth.uid() = user_id);
