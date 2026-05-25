-- ─── Migration: Add notification_channels to alerts ─────────────
-- Run this in Supabase SQL Editor
-- https://ixjnuoslbzytubpplkot.supabase.co

-- Add notification_channels column (array of strings)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS notification_channels TEXT[] DEFAULT ARRAY['in_app']::TEXT[];

-- Backfill existing alerts to have 'in_app' if currently null
UPDATE alerts SET notification_channels = ARRAY['in_app']::TEXT[] WHERE notification_channels IS NULL;

-- Verify
SELECT id, symbol, alert_type, notification_channels FROM alerts LIMIT 10;
