-- Monthly spending caps per category — the "actual budget" feature that was
-- missing (the app was called "ניהול תקציב" but had no way to set a spending
-- limit per category and see progress against it). One amount per category,
-- applies every month until changed.

create table if not exists public.category_budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  monthly_amount numeric not null check (monthly_amount >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(household_id, category_id)
);

alter table public.category_budgets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='category_budgets' and policyname='category_budgets_household_all'
  ) then
    create policy category_budgets_household_all on public.category_budgets
      for all using (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      )
      with check (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      );
  end if;
end$$;
