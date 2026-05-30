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

-- Row-level security — disabled (auth enforced in API routes via requireAuth)
ALTER TABLE public.strategies DISABLE ROW LEVEL SECURITY;
