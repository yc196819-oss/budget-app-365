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

-- Applied 2026-11-02 (ops_ai_calls): every AI call, numbers only.
create table if not exists public.ai_calls (
  id bigserial primary key,
  user_id uuid,
  route text,
  provider text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  at timestamptz not null default now()
);
create index if not exists ai_calls_at_idx on public.ai_calls (at desc);
create index if not exists ai_calls_user_idx on public.ai_calls (user_id, at desc);
alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;

-- Applied 2026-11-02 (ops_funnel): sign-up to real use, counts only; the
-- service role (owner dashboard) is the only caller.
create or replace function public.ops_funnel(p_since timestamptz)
returns jsonb language sql security definer set search_path = public as $$
  with u as (
    select id, created_at from auth.users where created_at >= p_since
  ), m as (
    select distinct on (user_id) user_id, household_id from public.memberships order by user_id, created_at
  ), x as (
    select u.id, u.created_at, m.household_id,
      exists (select 1 from public.transactions t where t.household_id = m.household_id) as has_tx,
      exists (select 1 from public.transactions t where t.household_id = m.household_id and t.source is distinct from 'manual') as has_import,
      exists (select 1 from public.app_events e where e.user_id = u.id and e.at > u.created_at + interval '7 days') as came_back
    from u left join m on m.user_id = u.id
  )
  select jsonb_build_object(
    'signups', count(*),
    'household', count(household_id),
    'tx', count(*) filter (where has_tx),
    'import', count(*) filter (where has_import),
    'cameBack', count(*) filter (where came_back),
    'oldEnough', count(*) filter (where created_at < now() - interval '7 days'),
    'byDay', coalesce((select jsonb_object_agg(d, n) from (select to_char(created_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD') d, count(*) n from u group by 1) s), '{}'::jsonb)
  ) from x;
$$;
revoke execute on function public.ops_funnel(timestamptz) from public, anon, authenticated;

-- Applied 2026-11-02 (imports_and_feedback, imports_removed_at): each
-- uploaded file, so a wrong one can be removed whole; requests to the owner.
-- (Earlier statements were grouped into imports by household, source and
-- moment of saving.) See the migration in the project for the full text.
create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on update cascade,
  created_by uuid, file_name text, kind text, rows integer not null default 0,
  date_from date, date_to date, created_at timestamptz not null default now(), removed_at timestamptz
);
alter table public.imports enable row level security;
create policy imports_household on public.imports for all to authenticated
  using (household_id in (select public.my_households())) with check (household_id in (select public.my_households()));
alter table public.transactions add column if not exists import_id uuid references public.imports(id) on update cascade on delete set null;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  kind text not null check (kind in ('bug', 'idea', 'other')),
  text text not null check (char_length(text) between 3 and 2000),
  screen text, device text,
  status text not null default 'new' check (status in ('new', 'working', 'done', 'wontfix')),
  owner_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
create policy feedback_insert_own on public.feedback for insert to authenticated with check (user_id = (select auth.uid()));
create policy feedback_read_own on public.feedback for select to authenticated using (user_id = (select auth.uid()));

-- Applied 2026-11-02 (reengage_sent): who already got the one invitation back.
create table if not exists public.reengage_sent (user_id uuid primary key, sent_at timestamptz not null default now());
alter table public.reengage_sent enable row level security;
revoke all on public.reengage_sent from anon, authenticated;
