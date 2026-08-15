-- 047_order_notifications_enabled.sql
-- Per-user preference for order-lifecycle IN-APP bell notifications.
-- Mirrors 044_order_emails.sql (order_emails_enabled), but:
--   * DEFAULT true (bell ON by default) — Em's Option B decision.
--   * Unlike email (always-on, no opt-out), the bell is user-mutable.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS order_notifications_enabled BOOLEAN DEFAULT true;
