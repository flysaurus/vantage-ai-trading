-- Add peak/trough tracking for Weathered a Storm milestone detection
ALTER TABLE investor_scores 
ADD COLUMN IF NOT EXISTS peak_equity NUMERIC,
ADD COLUMN IF NOT EXISTS trough_equity NUMERIC,
ADD COLUMN IF NOT EXISTS drawdown_start TIMESTAMPTZ;

COMMENT ON COLUMN investor_scores.peak_equity IS 
  'Highest portfolio equity ever observed. Updated on trade execution and daily cron.';
COMMENT ON COLUMN investor_scores.trough_equity IS 
  'Lowest portfolio equity during current drawdown episode (≥10% below peak). NULL when no active drawdown.';
COMMENT ON COLUMN investor_scores.drawdown_start IS 
  'When current drawdown episode began (equity first dropped ≥10% below peak). NULL when no active drawdown.';