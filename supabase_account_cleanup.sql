-- 2026-11-13 (account_cleanup): empty accounts nobody uses are told two weeks
-- before, then deleted (server: /api/cron/cleanup). One row per person: when
-- they were told, and when deleted. Only the server (service role) reads it.
-- Safe to run more than once.
create table if not exists public.account_cleanup (
  user_id uuid primary key,
  warned_at timestamptz,
  deleted_at timestamptz
);
alter table public.account_cleanup enable row level security;
revoke all on public.account_cleanup from anon, authenticated;

-- Every day at 08:10 UTC (10:10 in Israel in winter): warnings go out in the morning.
select cron.unschedule('account-cleanup') where exists (select 1 from cron.job where jobname = 'account-cleanup');
select cron.schedule('account-cleanup', '10 8 * * *', $$
  select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/cron/cleanup',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);
