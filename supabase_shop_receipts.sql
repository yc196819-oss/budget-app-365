-- ALREADY APPLIED (2026-11-13).
-- Receipts a household photographed in the shopping tab: the store, the date
-- and what was bought (name, how many, the price paid). Used to learn what
-- this household buys and what it paid, so the list and the price comparison
-- fit it. The photo itself is never kept: only the lines read from it.
create table if not exists public.shop_receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  store text,
  bought_on date,
  total numeric(10,2),
  items jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists shop_receipts_household on public.shop_receipts (household_id, created_at desc);
alter table public.shop_receipts enable row level security;
drop policy if exists shop_receipts_household_all on public.shop_receipts;
create policy shop_receipts_household_all on public.shop_receipts for all
  using (household_id in (select m.household_id from public.memberships m where m.user_id = (select auth.uid())))
  with check (household_id in (select m.household_id from public.memberships m where m.user_id = (select auth.uid())));
drop policy if exists two_step_required on public.shop_receipts;
create policy two_step_required on public.shop_receipts as restrictive for all
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
grant select, insert, update, delete on public.shop_receipts to authenticated;
