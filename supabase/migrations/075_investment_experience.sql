-- 075_investment_experience.sql
-- Single self-reported familiarity answer captured once during onboarding,
-- immediately after the investor-style archetype reveal screen.
--
-- Plain stored value only — no scoring, no numeric assessment, no quiz logic.
-- Allowed values (validated at the API layer, not enforced here):
--   'new'         -> "New to investing"
--   'some'        -> "Some experience"
--   'experienced' -> "Experienced"
--
-- NULL = question skipped (or answered before this column existed).
-- Used solely to surface the Learning Library "start with the basics" entry
-- point to genuinely new investors.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS investment_experience TEXT;
