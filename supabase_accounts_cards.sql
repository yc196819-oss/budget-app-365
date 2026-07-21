-- Multiple bank accounts + multiple credit cards (each with its own billing day).
-- Run in Supabase SQL Editor, after supabase_household_invites_fix.sql.
-- Safe to run multiple times (idempotent): existing tables/columns/policies are skipped.
--
-- What this adds:
--   bank_accounts   -- one household can have several
--   credit_cards    -- each belongs to one bank_account, has its own billing_day
--   transactions.account_id / transactions.card_id
--   categories.default_account_id / default_card_id  (for prefill)
--
-- Migration approach: additive only. transactions.payment_method stays as a
-- legacy/derived column, nothing is dropped. A backfill step at the bottom
-- creates one default account + card per existing household and attaches
-- every existing transaction to them, so no historical data is orphaned or
-- lost.
--
-- billing_day semantics: the day of the month the charge actually leaves the
-- bank account. A purchase on day X is billed on billing_day of the SAME
-- month if X <= billing_day, otherwise on billing_day of the NEXT month.
-- Clamped to 1-28 to avoid "day 30 doesn't exist in February" edge cases.

create extension if not exists pgcrypto;

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  name text not null,
  bank_name text,
  owner_user_id uuid,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  name text not null,
  last4 text,
  billing_day int not null default 10 check (billing_day between 1 and 28),
  owner_user_id uuid,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.transactions add column if not exists account_id uuid references public.bank_accounts(id);
alter table public.transactions add column if not exists card_id uuid references public.credit_cards(id);
alter table public.categories add column if not exists default_account_id uuid references public.bank_accounts(id);
alter table public.categories add column if not exists default_card_id uuid references public.credit_cards(id);

-- RLS: same "any member of the household can read/write" model already used
-- by the rest of this app's tables (transactions/categories/etc have no
-- owner-only restriction either).
alter table public.bank_accounts enable row level security;
alter table public.credit_cards enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='bank_accounts' and policyname='bank_accounts_household_all'
  ) then
    create policy bank_accounts_household_all on public.bank_accounts
      for all using (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      )
      with check (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='credit_cards' and policyname='credit_cards_household_all'
  ) then
    create policy credit_cards_household_all on public.credit_cards
      for all using (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      )
      with check (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      );
  end if;
end$$;

-- Backfill: every existing household gets one default account + card, and
-- every existing transaction gets attached (credit-tagged ones get the card
-- too). Idempotent — skips households that already have an account/card.
do $$
declare
  h record;
  v_acct uuid;
  v_card uuid;
begin
  for h in select id from public.households loop
    select id into v_acct from public.bank_accounts where household_id = h.id order by created_at limit 1;
    if v_acct is null then
      insert into public.bank_accounts(household_id, name, is_active)
      values (h.id, 'חשבון ראשי', true)
      returning id into v_acct;
    end if;

    select id into v_card from public.credit_cards where household_id = h.id order by created_at limit 1;
    if v_card is null then
      insert into public.credit_cards(household_id, bank_account_id, name, billing_day, is_active)
      values (h.id, v_acct, 'כרטיס ראשי', 10, true)
      returning id into v_card;
    end if;

    update public.transactions
      set account_id = v_acct
      where household_id = h.id and account_id is null;

    update public.transactions
      set card_id = v_card
      where household_id = h.id and card_id is null and payment_method = 'credit';
  end loop;
end $$;
