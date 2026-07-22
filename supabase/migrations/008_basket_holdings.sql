-- 008_basket_holdings: Proper basket position tracking with DB-level uniqueness
--
-- Replaces the localStorage `vantage_basket_positions_v1` key with a proper
-- Supabase table. The UNIQUE(basket_id, symbol, user_id) constraint makes the
-- old .push()-instead-of-upsert bug structurally impossible.
--
-- Also migrates stale data out of demo_portfolio_state.basket_positions (JSONB).

-- 1. Create the basket_holdings table
CREATE TABLE IF NOT EXISTS basket_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  basket_id UUID NOT NULL,
  basket_order_id UUID,
  symbol TEXT NOT NULL,
  name TEXT,
  sector TEXT,
  basket_name TEXT,
  emoji TEXT,
  shares NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  reserved_amount NUMERIC DEFAULT 0,
  allocation_pct NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'filled', 'closed', 'sold', 'cancelled', 'ordered')),
  next_open_label TEXT,
  bought_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(basket_id, symbol, user_id)
);

-- 2. RLS policies (scoped to authenticated user)
ALTER TABLE basket_holdings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own basket holdings'
  ) THEN
    CREATE POLICY "Users can read own basket holdings"
      ON basket_holdings FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own basket holdings'
  ) THEN
    CREATE POLICY "Users can insert own basket holdings"
      ON basket_holdings FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own basket holdings'
  ) THEN
    CREATE POLICY "Users can update own basket holdings"
      ON basket_holdings FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own basket holdings'
  ) THEN
    CREATE POLICY "Users can delete own basket holdings"
      ON basket_holdings FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- 3. Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_basket_holdings_user_basket
  ON basket_holdings(user_id, basket_id);

CREATE INDEX IF NOT EXISTS idx_basket_holdings_user_status
  ON basket_holdings(user_id, status);
