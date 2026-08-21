-- 057_orders_cancel_reason.sql
-- Persist WHY a cancelled order was cancelled, so the in-app order card can
-- show the same honest reason the email templates already surface (instead of
-- a generic "cancelled"). Values mirror lib/order-emails.ts cancelReasonLine:
--   user_cancelled  — user tapped Cancel in Vantage
--   already_filled  — cancel raced with a fill (broker already filled it)
--   external        — cancelled outside Vantage (dashboard / order expired)
--   stale_guard     — auto-cancelled after 2 days of unconfirmable status
-- (Broker-rejection is represented by status='rejected', not a cancel_reason.)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason text;
