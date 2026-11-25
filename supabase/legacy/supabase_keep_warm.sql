-- Keeps the Render server awake (the free plan sleeps after ~15 idle minutes
-- and a cold start takes 30-50 s, which delayed the advisor and the API).
-- A light GET to /api/health every 10 minutes; it touches no data.
-- Applied 2026-10-03. To remove: select cron.unschedule('keep-server-warm');
select cron.schedule('keep-server-warm', '*/10 * * * *', $$
  select net.http_get(url := 'https://budget-web-u0iy.onrender.com/api/health', timeout_milliseconds := 60000);
$$);
