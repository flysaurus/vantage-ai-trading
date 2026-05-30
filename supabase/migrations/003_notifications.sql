-- 003_notifications.sql
-- Notifications table for in-app alerts (drift detection, rebalancing, etc.)

DROP TABLE IF EXISTS public.recent_notifications CASCADE;

CREATE TABLE public.recent_notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  action_url text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_notifications_user ON public.recent_notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON public.recent_notifications (user_id, is_read) WHERE is_read = false;
