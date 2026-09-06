-- 072_concentration_thresholds.sql
-- Per-user position-concentration alert thresholds for the AI Noticed feed.
-- NULL = use investor-style suggestion (or global default). Stored as whole % (0-100).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS conc_single_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS conc_top3_pct NUMERIC;
