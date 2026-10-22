-- Operations: failures the app reports, simple usage events (to know who
-- comes back), and a recycle bin that keeps what was removed for 30 days.
-- The server writes the first two (service role); the bin is filled by a
-- trigger and read by the household. Applied. Safe to run again.

create table if not exists public.app_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  source text not null default 'client' check (source in ('client', 'server')),
  message text not null check (char_length(message) <= 500),
  detail text check (char_length(detail) <= 4000),
  path text check (char_length(path) <= 300),
  agent text check (char_length(agent) <= 300)
);
create index if not exists app_errors_at_idx on public.app_errors (at desc);
alter table public.app_errors enable row level security;

create table if not exists public.app_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid not null,
  household_id uuid,
  name text not null check (char_length(name) <= 40)
);
create index if not exists app_events_at_idx on public.app_events (at desc);
create index if not exists app_events_user_idx on public.app_events (user_id, at desc);
alter table public.app_events enable row level security;

-- The recycle bin: a copy of every removed row of the main tables.
create table if not exists public.recycle_bin (
  id bigserial primary key,
  household_id uuid not null,
  tbl text not null,
  row_id uuid,
  data jsonb not null,
  removed_by uuid,
  removed_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists recycle_bin_household_idx on public.recycle_bin (household_id, removed_at desc);
alter table public.recycle_bin enable row level security;
create policy recycle_bin_read on public.recycle_bin for select to authenticated
  using (household_id in (select public.my_households()));

create or replace function public.keep_in_bin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A row without a household (old data) is not kept; removing it never fails here.
  if old.household_id is not null then
    begin
      insert into public.recycle_bin (household_id, tbl, row_id, data, removed_by)
      values (old.household_id, tg_table_name, old.id, to_jsonb(old), auth.uid());
    exception when others then
      raise warning 'recycle bin: %', sqlerrm;
    end;
  end if;
  return old;
end $$;
revoke execute on function public.keep_in_bin() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['transactions', 'goals', 'installments', 'categories', 'loans', 'investments', 'bank_accounts', 'credit_cards', 'trips'] loop
    if not exists (select 1 from pg_trigger where tgname = 'keep_in_bin' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger keep_in_bin before delete on public.%I for each row execute function public.keep_in_bin()', t);
    end if;
  end loop;
end $$;

-- Putting a removed row back, for a member of its household.
create or replace function public.restore_from_bin(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare b public.recycle_bin;
begin
  select * into b from public.recycle_bin where id = p_id and restored_at is null;
  if b.id is null or b.household_id not in (select public.my_households()) then raise exception 'not found'; end if;
  if b.tbl not in ('transactions', 'goals', 'installments', 'categories', 'loans', 'investments', 'bank_accounts', 'credit_cards', 'trips') then raise exception 'not restorable'; end if;
  execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict do nothing', b.tbl, b.tbl) using b.data;
  update public.recycle_bin set restored_at = now() where id = b.id;
  return b.tbl;
end $$;
revoke execute on function public.restore_from_bin(bigint) from public, anon;
grant execute on function public.restore_from_bin(bigint) to authenticated;
