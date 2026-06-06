-- Migration: Portfolio Mode — demo/live switching
-- Run in: Supabase SQL Editor
--
-- Purpose: Adds portfolio_mode to users, is_demo to positions/orders,
-- and performance indexes. Enables seamless switching between
-- demo portfolios (seeded) and live broker data.

BEGIN;

-- ─── Users: mode + demo_style ────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS portfolio_mode text DEFAULT 'demo' CHECK (portfolio_mode IN ('demo', 'live'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS demo_style text DEFAULT 'lynch';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS broker_connected boolean DEFAULT false;

-- ─── Positions table (create if missing) ─────────────────────
CREATE TABLE IF NOT EXISTS public.positions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  avg_cost numeric,
  current_price numeric,
  market_value numeric,
  unrealized_pnl numeric,
  unrealized_pnl_pct numeric,
  sector text,
  industry text,
  name text,
  is_demo boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ─── Orders table (create if missing) ────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  filled_qty numeric,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type text DEFAULT 'market',
  status text DEFAULT 'filled',
  filled_price numeric,
  filled_at timestamptz DEFAULT now(),
  time_in_force text DEFAULT 'day',
  is_demo boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Add columns if tables already existed (idempotent)
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS is_demo boolean DEFAULT false;
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_demo boolean DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS filled_at timestamptz DEFAULT now();
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS time_in_force text DEFAULT 'day';

-- ─── Performance indexes ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS positions_user_idx ON public.positions(user_id);
CREATE INDEX IF NOT EXISTS positions_user_symbol_idx ON public.positions(user_id, symbol);
CREATE INDEX IF NOT EXISTS orders_user_idx ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON public.orders(user_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "positions_read_own" ON public.positions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "positions_insert_own" ON public.positions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "positions_update_own" ON public.positions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "positions_delete_own" ON public.positions
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "orders_read_own" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "orders_insert_own" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "orders_update_own" ON public.orders
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "orders_delete_own" ON public.orders
  FOR DELETE USING (auth.uid() = user_id);

COMMIT;
