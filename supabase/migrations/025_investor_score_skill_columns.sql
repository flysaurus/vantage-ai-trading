-- ============================================================
-- INVESTOR SCORE SKILL-SIGNAL COLUMNS (025)
-- ============================================================
-- Run in: Supabase Dashboard → SQL Editor
-- Adds real skill-signal columns to investor_scores:
--   - risk_adherence: computed from portfolio metrics (volatility,
--     growth exposure, cash ratio, diversification), not trade count
--   - diversification_score: Herfindahl sector concentration score
--     from confidence.ts (reuse, don't duplicate)
--   - learning_count: number of Learning Moments completed
--     (feeds formula as weighted component, not flat addition)
--   - matching_trades: number of trades whose inferred style
--     matches declared investor style (for running consistency calc)
-- ============================================================

ALTER TABLE investor_scores
  ADD COLUMN IF NOT EXISTS risk_adherence INTEGER DEFAULT 70,
  ADD COLUMN IF NOT EXISTS diversification_score INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS learning_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matching_trades INTEGER DEFAULT 0;
