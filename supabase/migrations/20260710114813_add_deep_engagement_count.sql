-- Add deep_engagement_count column for Understanding pillar
ALTER TABLE investor_scores 
ADD COLUMN IF NOT EXISTS deep_engagement_count INTEGER DEFAULT 0;

COMMENT ON COLUMN investor_scores.deep_engagement_count IS 
  'Count of Learning Moments completed with deep engagement (isDeep=true).
   Drives the Understanding pillar (50 pts each, cap 5).';
