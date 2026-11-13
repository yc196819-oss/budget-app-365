-- 2026-11-13 (price_load_runs): each price load, how every chain did (its
-- count, or why it did not load). Written by the server only. Safe to run
-- more than once.
create table if not exists public.price_load_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz, ended_at timestamptz, added int, error text, chains jsonb
);
alter table public.price_load_runs enable row level security;
revoke all on public.price_load_runs from anon, authenticated;
