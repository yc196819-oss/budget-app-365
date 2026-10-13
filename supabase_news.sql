-- Morning news: one digest a day for everyone (written by the server, read by
-- any signed-in user). It holds headlines with links and the advisor's own
-- summaries, never anyone's data. Applied. Safe to run again.
create table if not exists public.news_digests (
  day date primary key,
  digest jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.news_digests enable row level security;
drop policy if exists news_digests_read on public.news_digests;
create policy news_digests_read on public.news_digests for select to authenticated using (true);
-- No insert/update/delete policy: only the server (service role) writes.
