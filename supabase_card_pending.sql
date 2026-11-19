-- Card charges the household told the advisor about, before the card's
-- statement is uploaded ("the current charge on Max is 2,470").
-- card_id null: they did not say which card; the app asks them to attach it
-- to a card, or to open a new one. The app counts, for each card, the bigger
-- of what its transactions show and the latest amount said in the current
-- billing cycle; an amount said before the cycle's billing day is not
-- counted after it.
create table if not exists public.card_pending (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  card_id uuid references public.credit_cards(id) on delete cascade,
  amount numeric not null check (amount > 0),
  label text,
  said_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists card_pending_household_idx on public.card_pending (household_id, said_at desc);

alter table public.card_pending enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='card_pending' and policyname='card_pending_household_all'
  ) then
    create policy card_pending_household_all on public.card_pending
      for all using (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      )
      with check (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      );
  end if;
end $$;
