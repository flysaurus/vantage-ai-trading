-- Bi-Weekly AI Baskets Schema
-- Migration: 007_baskets.sql

-- Baskets table
CREATE TABLE IF NOT EXISTS baskets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_of DATE NOT NULL,
  theme TEXT NOT NULL,
  emoji TEXT NOT NULL,
  name TEXT NOT NULL,
  thesis TEXT NOT NULL,
  risk_note TEXT NOT NULL,
  stocks JSONB NOT NULL DEFAULT '[]',
  performance JSONB NOT NULL DEFAULT '{}',
  changelog TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_baskets_week ON baskets(week_of DESC);
CREATE INDEX IF NOT EXISTS idx_baskets_active ON baskets(is_active);

-- Track what changed between refreshes
CREATE TABLE IF NOT EXISTS basket_changelogs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  basket_id UUID REFERENCES baskets(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  changes TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_basket_changelogs_week ON basket_changelogs(week_of DESC);
CREATE INDEX IF NOT EXISTS idx_basket_changelogs_basket ON basket_changelogs(basket_id);
