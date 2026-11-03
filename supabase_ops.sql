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
-- Applied 2026-11-02 (imports_title): a name of the person's own for a file.
alter table public.imports add column if not exists title text check (title is null or char_length(title) <= 80);
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

-- Applied 2026-11-02 (mail_campaigns): the one-time emails from the dashboard,
-- one per step of getting started (start / first / more); each person gets
-- each one once. ops_tx_span: lines and months per household, for the server only.
create table if not exists public.mail_sent (
  user_id uuid not null,
  campaign text not null check (campaign in ('start', 'first', 'more')),
  sent_at timestamptz not null default now(),
  primary key (user_id, campaign)
);
alter table public.mail_sent enable row level security;
revoke all on public.mail_sent from anon, authenticated;
create or replace function public.ops_tx_span()
returns table (household_id uuid, n bigint, months bigint)
language sql stable security definer set search_path = public as $$
  select t.household_id, count(*), count(distinct date_trunc('month', t.tx_date))
  from public.transactions t group by t.household_id
$$;
revoke execute on function public.ops_tx_span() from public, anon, authenticated;
grant execute on function public.ops_tx_span() to service_role;

-- Applied 2026-11-02 (member_count_own_households): the member count only for
-- the caller's own households, and nothing of it for someone not signed in.
create or replace function public.household_member_count(p_hid uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from public.memberships where household_id = p_hid and p_hid in (select public.my_households())
$$;
revoke execute on function public.household_member_count(uuid) from anon;
revoke execute on function public.my_households() from anon;

-- Applied 2026-11-03 (two_step_login): a code from an authenticator app
-- (Supabase MFA, aal2) or a code sent by email (our own, per session).
-- Whoever turned either on sees no data until the current session passed it.
create table if not exists public.mfa_email (
  user_id uuid primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.mfa_email_codes (
  user_id uuid primary key,
  code_hash text not null,
  purpose text not null default 'login' check (purpose in ('login', 'enable')),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now()
);
create table if not exists public.mfa_email_sessions (
  session_id uuid primary key,
  user_id uuid not null,
  verified_at timestamptz not null default now()
);
alter table public.mfa_email enable row level security;
alter table public.mfa_email_codes enable row level security;
alter table public.mfa_email_sessions enable row level security;
revoke all on public.mfa_email_codes from anon, authenticated;
revoke all on public.mfa_email_sessions from anon, authenticated;
revoke insert, update on public.mfa_email from anon, authenticated;
create policy mfa_email_read_own on public.mfa_email for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.mfa_state_for(p_user uuid, p_aal text, p_session uuid)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  with f as (
    select exists (select 1 from auth.mfa_factors m where m.user_id = p_user and m.status = 'verified' and m.factor_type = 'totp') as totp,
           exists (select 1 from public.mfa_email e where e.user_id = p_user and e.enabled) as email
  )
  select jsonb_build_object(
    'totp', f.totp, 'email', f.email, 'required', f.totp or f.email,
    'ok', not (f.totp or f.email) or p_aal = 'aal2'
          or (p_session is not null and exists (select 1 from public.mfa_email_sessions s where s.session_id = p_session and s.user_id = p_user))
  ) from f
$$;
revoke execute on function public.mfa_state_for(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mfa_state_for(uuid, text, uuid) to service_role;

create or replace function public.my_mfa_state()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select public.mfa_state_for(auth.uid(), auth.jwt() ->> 'aal', nullif(auth.jwt() ->> 'session_id', '')::uuid)
$$;
revoke execute on function public.my_mfa_state() from public, anon;
grant execute on function public.my_mfa_state() to authenticated;

create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is null or coalesce((public.my_mfa_state() ->> 'ok')::boolean, true)
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, last_seen timestamptz, user_agent text, ip text, current boolean)
language sql stable security definer set search_path = public, auth as $$
  select s.id, s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at), s.user_agent, host(s.ip)::text,
         s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  from auth.sessions s
  where s.user_id = auth.uid() and (s.not_after is null or s.not_after > now())
  order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc
  limit 20
$$;
revoke execute on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['advisor_alerts','advisor_conversations','advisor_memories','advisor_messages','advisor_tasks','agent_actions','ai_usage','bank_accounts','categories','category_budgets','checkin_feelings','credit_cards','decision_messages','decision_reads','decision_votes','feedback','goals','household_reset_codes','households','imports','installments','investment_snapshots','investment_trades','investments','invites','loans','memberships','monthly_reports','news_digests','push_subscriptions','recycle_bin','shared_decisions','transactions','trips','user_settings','weekly_checkins']
  loop
    execute format('create policy two_step_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
  end loop;
end $$;

-- Applied 2026-11-03 (email_code_for_all): the email code for everyone who
-- signs in with a password, behind one switch (app_flags.email_code_for_all,
-- off until sending email is confirmed to work). A sign-in that already proved
-- the inbox (a link from an email) or came through Google passes it.
create table if not exists public.app_flags (
  key text primary key,
  on_ boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;
insert into public.app_flags (key, on_) values ('email_code_for_all', false) on conflict (key) do nothing;

create or replace function public.mfa_state_for(p_user uuid, p_aal text, p_session uuid)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  with f as (
    select exists (select 1 from auth.mfa_factors m where m.user_id = p_user and m.status = 'verified' and m.factor_type = 'totp') as totp,
           coalesce((select e.enabled from public.mfa_email e where e.user_id = p_user), false) as chosen,
           coalesce((select a.on_ from public.app_flags a where a.key = 'email_code_for_all'), false)
             and exists (select 1 from auth.identities i where i.user_id = p_user and i.provider = 'email') as mandatory
  ), g as (
    select f.*, f.chosen or (f.mandatory and not f.totp) as email,
           (f.mandatory and not f.totp and not f.chosen and p_session is not null and exists (
              select 1 from auth.mfa_amr_claims c where c.session_id = p_session
                and c.authentication_method in ('oauth', 'otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change'))) as link_ok
    from f
  )
  select jsonb_build_object(
    'totp', g.totp, 'email', g.email, 'mandatory', g.mandatory, 'required', g.totp or g.email,
    'ok', not (g.totp or g.email) or p_aal = 'aal2' or g.link_ok
          or (p_session is not null and exists (select 1 from public.mfa_email_sessions s where s.session_id = p_session and s.user_id = p_user))
  ) from g
$$;
revoke execute on function public.mfa_state_for(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mfa_state_for(uuid, text, uuid) to service_role;

-- Turned on 2026-11-03 after a test email arrived. To turn it on, keeping everyone already
-- signed in signed in:
--   insert into public.mfa_email_sessions (session_id, user_id)
--     select s.id, s.user_id from auth.sessions s
--     where exists (select 1 from auth.identities i where i.user_id = s.user_id and i.provider = 'email')
--     on conflict (session_id) do nothing;
--   update public.app_flags set on_ = true, updated_at = now() where key = 'email_code_for_all';

-- Applied 2026-11-03 (monthly_mail, monthly_mail_opt_in): the monthly summary
-- by email, only for whoever said yes in the app; it can be turned off in the
-- app or with one click from the email.
create table if not exists public.mail_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.mail_prefs enable row level security;
revoke all on public.mail_prefs from anon;
create policy mail_prefs_own on public.mail_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy two_step_required on public.mail_prefs as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
alter table public.mail_sent drop constraint if exists mail_sent_campaign_check;
alter table public.mail_sent add constraint mail_sent_campaign_check
  check (campaign in ('start', 'first', 'more') or campaign ~ '^monthly-[0-9]{4}-[0-9]{2}$');

-- Applied 2026-11-03 (member_gender): how to address each person ("אתה" or
-- "את"), chosen once by the person, seen by the household like the name.
alter table public.memberships add column if not exists gender text check (gender in ('m', 'f'));

-- Applied 2026-11-03 (category_rules): "always file X as Y", chosen by the
-- household after a correction; applied first when a statement is read.
create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null default 'expense' check (type in ('expense', 'income')),
  match text not null check (length(match) between 1 and 80),
  label text not null default '' check (length(label) <= 120),
  category_id uuid references public.categories(id) on delete cascade,
  subcategory_id uuid references public.categories(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, type, match)
);
alter table public.category_rules enable row level security;
revoke all on public.category_rules from anon;
create policy category_rules_household on public.category_rules for all to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
create policy two_step_required on public.category_rules as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create index if not exists category_rules_household on public.category_rules (household_id);
