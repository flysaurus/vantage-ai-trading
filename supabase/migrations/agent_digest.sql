-- agent_digest.sql
-- Portfolio Agent daily email digest — opt-in + last-sent tracking

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS agent_emails_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ DEFAULT NULL;
