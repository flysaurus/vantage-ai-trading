-- 074_target_return_thresholds.sql
-- Per-user target-return / target-loss thresholds for the AI Noticed feed's
-- position-milestone cards. When set, a position fires a single milestone card
-- at exactly this threshold instead of the default band ladder
-- (+15/+25/+50/+100/+250 and -10/-20/-35/-50).
--
-- NULL = use the default band ladder. Stored as whole % (positive values):
--   target_return_pct  -> fire when a position returns >= this %
--   target_loss_pct    -> fire when a position drops  <= -this %

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS target_return_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS target_loss_pct NUMERIC;
