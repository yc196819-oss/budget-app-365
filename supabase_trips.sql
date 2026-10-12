-- Trips: a folder for each trip found in the card lines (or dismissed as
-- "not a trip", so it is not offered again). The household's own rows only
-- (my_households()), like the rest of the data. Applied. Safe to run again.

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  status text not null default 'saved' check (status in ('saved', 'dismissed')),
  name text not null check (char_length(name) between 1 and 80),
  country text check (char_length(country) <= 40),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  people integer not null default 2 check (people between 1 and 20),
  transaction_ids uuid[] not null default '{}',
  excluded_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists trips_household_idx on public.trips (household_id, start_date desc);
alter table public.trips enable row level security;

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (household_id in (select public.my_households()));
drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (household_id in (select public.my_households()) and created_by = auth.uid());
drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
  using (household_id in (select public.my_households()));
