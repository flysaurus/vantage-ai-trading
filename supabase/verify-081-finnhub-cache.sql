-- ─── verify-081-finnhub-cache.sql — READ-ONLY ───────────────────────────────
-- Confirms 081 applied: the table, its check constraint, the index, and RLS.
-- Safe to run any time; performs no writes.

-- 1. Table exists with the expected columns.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'finnhub_cache'
order by ordinal_position;

-- 2. Status check constraint present.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.finnhub_cache'::regclass and contype = 'c';

-- 3. Index present.
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'finnhub_cache';

-- 4. RLS enabled (and, by design, zero policies).
select relname, relrowsecurity as rls_enabled
from pg_class where oid = 'public.finnhub_cache'::regclass;

select count(*) as policy_count
from pg_policies where schemaname = 'public' and tablename = 'finnhub_cache';

-- 5. Row-count / status mix (empty until the gateway first runs).
select status, count(*) as rows, max(fetched_at) as newest
from public.finnhub_cache
group by status order by status;
