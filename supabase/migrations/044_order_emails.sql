-- 044_order_emails.sql
-- Order lifecycle email preferences.
--
-- Adds a per-user opt-out flag for transactional order emails
-- (placed / filled / cancelled). Mirrors agent_digest.sql's
-- `agent_emails_enabled` column; the unsubscribe route
-- (/api/order-emails/unsubscribe) flips this to false.
--
-- Default true: order emails are ON unless the user opts out.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS order_emails_enabled BOOLEAN DEFAULT true;
