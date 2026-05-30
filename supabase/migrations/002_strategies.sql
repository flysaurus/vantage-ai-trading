-- Strategies table for DCA, Rebalance, Tax Harvest schedules
-- Run in: Supabase Dashboard → SQL Editor

DROP TABLE IF EXISTS public.strategies CASCADE;

CREATE TABLE public.strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  symbol text,
  config jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX strategies_user_id_idx ON public.strategies(user_id);
CREATE INDEX strategies_type_idx ON public.strategies(type);

-- Row-level security
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own strategies"
  ON public.strategies FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own strategies"
  ON public.strategies FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own strategies"
  ON public.strategies FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own strategies"
  ON public.strategies FOR DELETE
  USING (user_id = auth.uid());
