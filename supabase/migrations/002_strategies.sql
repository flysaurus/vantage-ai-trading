-- Strategies table for DCA, Rebalance, Tax Harvest schedules
CREATE TABLE IF NOT EXISTS public.strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL, -- 'dca', 'rebalance', 'tax_harvest'
  symbol text,
  config jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategies_user_id_idx ON public.strategies(user_id);
CREATE INDEX IF NOT EXISTS strategies_type_idx ON public.strategies(type);
