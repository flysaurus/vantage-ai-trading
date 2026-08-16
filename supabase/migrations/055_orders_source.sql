-- ═══════════════════════════════════════════════════════════════
-- Migration: orders.source — track order origin (manual vs AI advisor)
-- Run in: Supabase SQL Editor (idempotent)
-- Purpose: the Order Timeline Stepper UI wants to label where an order
--          came from ("Manual buy" vs "via AI Advisor"). The only signal
--          available at creation time is the chat messageId passed by the
--          AI Advisor buy path; execute-trade persists it as `source`.
--          Existing rows are null → UI treats null as "Manual buy".
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.orders.source IS
  'Order origin: ''ai_advisor'' (placed via AI Advisor chat) or ''manual'' (trade ticket / sell). Null = legacy/manual.';
