-- Apartments and their mortgages: an apartment the family owns besides its
-- home (or its home too), what it brings in and costs, and the mortgage on
-- it. The household's own rows only (my_households()), like the rest of the
-- data. Safe to run again.

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  name text not null check (char_length(name) between 1 and 60),
  city text check (char_length(city) <= 60),
  home boolean not null default false,
  rented boolean not null default false,
  value numeric check (value >= 0 and value < 1000000000),
  rent numeric check (rent >= 0 and rent < 1000000000),
  -- Monthly costs by kind: {"arnona": 380, "vaad": 150, ...}
  costs jsonb not null default '{}'::jsonb check (jsonb_typeof(costs) = 'object' and pg_column_size(costs) < 2000),
  -- {"balance": 820000, "rate": 4.6, "payment": 4700, "months": null}, or null
  mortgage jsonb check (mortgage is null or (jsonb_typeof(mortgage) = 'object' and pg_column_size(mortgage) < 2000)),
  -- The name the rent comes in under in the account, when the family chose one.
  rent_payer text check (char_length(rent_payer) <= 80),
  -- The bank account the apartment is run through (rent in, costs out), when it has its own.
  account_id uuid references public.bank_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.properties add column if not exists account_id uuid references public.bank_accounts(id) on delete set null;
create index if not exists properties_household_idx on public.properties (household_id, created_at);
alter table public.properties enable row level security;

drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select to authenticated
  using (household_id in (select public.my_households()));
drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert to authenticated
  with check (household_id in (select public.my_households()) and created_by = auth.uid());
drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties for delete to authenticated
  using (household_id in (select public.my_households()));
-- Like every data table: only after the second step, for those who turned it on.
drop policy if exists two_step_required on public.properties;
create policy two_step_required on public.properties as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
