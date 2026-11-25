-- Baseline: the whole public schema of the production database as it was on
-- 2026-11-25, taken from the live database's catalog (tables, keys, indexes,
-- functions, triggers, row level security, policies, grants, scheduled jobs).
-- Structure only: no rows, no secrets (app_secrets values are data).
--
-- This file is ALREADY APPLIED in production. Never run it there. It exists
-- so a new, empty database can be built to match, and so every later change
-- is a numbered file after it in this folder. The old supabase_*.sql files
-- are history only: supabase/legacy/README.md.

set check_function_bodies = false;
set search_path = public, extensions;

-- Extensions (Supabase keeps most of them in the "extensions" schema).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
-- pg_cron and pg_net exist only on Supabase; the jobs at the end need them.
do $ext$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $ext$;

-- ======================================================================
-- Sequences
-- ======================================================================
create sequence if not exists public.ai_calls_id_seq;
create sequence if not exists public.app_errors_id_seq;
create sequence if not exists public.app_events_id_seq;
create sequence if not exists public.recycle_bin_id_seq;

-- ======================================================================
-- Tables
-- ======================================================================
create table if not exists public.account_cleanup (
  user_id uuid not null,
  warned_at timestamp with time zone,
  deleted_at timestamp with time zone
);

create table if not exists public.advisor_alerts (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  kind text not null,
  title text not null,
  body text,
  severity text default 'info'::text not null,
  data jsonb,
  dedupe_key text not null,
  created_at timestamp with time zone default now() not null,
  dismissed_at timestamp with time zone,
  dismissed_by uuid,
  acted_at timestamp with time zone
);

create table if not exists public.advisor_conversations (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  user_id uuid not null,
  title text default 'שיחה חדשה'::text not null,
  messages jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_private boolean default false not null
);

create table if not exists public.advisor_memories (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  text text not null,
  kind text default 'decision'::text not null,
  source_conversation_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null
);

create table if not exists public.advisor_messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  household_id uuid not null,
  author_id uuid,
  role text not null,
  text text,
  data jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.advisor_tasks (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  user_id uuid default auth.uid() not null,
  conversation_id uuid,
  title text not null,
  why text,
  steps jsonb default '[]'::jsonb not null,
  due_date date,
  remind boolean default true not null,
  link_tab text,
  target_amount numeric,
  status text default 'open'::text not null,
  last_reminded_on date,
  done_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  deliverable jsonb,
  deliverable_chat jsonb default '[]'::jsonb not null
);

create table if not exists public.agent_actions (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  user_id uuid default auth.uid() not null,
  conversation_id uuid,
  message_id uuid,
  ops jsonb not null,
  applied_at timestamp with time zone default now() not null,
  undone_at timestamp with time zone,
  undone_by uuid
);

create table if not exists public.ai_calls (
  id bigint default nextval('ai_calls_id_seq'::regclass) not null,
  user_id uuid,
  route text,
  provider text not null,
  model text,
  input_tokens integer default 0 not null,
  output_tokens integer default 0 not null,
  at timestamp with time zone default now() not null
);

create table if not exists public.ai_usage (
  household_id uuid not null,
  month text not null,
  count integer default 0 not null
);

create table if not exists public.app_errors (
  id bigint default nextval('app_errors_id_seq'::regclass) not null,
  at timestamp with time zone default now() not null,
  user_id uuid,
  source text default 'client'::text not null,
  message text not null,
  detail text,
  path text,
  agent text
);

create table if not exists public.app_events (
  id bigint default nextval('app_events_id_seq'::regclass) not null,
  at timestamp with time zone default now() not null,
  user_id uuid not null,
  household_id uuid,
  name text not null
);

create table if not exists public.app_flags (
  key text not null,
  on_ boolean default false not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.app_secrets (
  key text not null,
  value text not null
);

create table if not exists public.bank_accounts (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  name text not null,
  bank_name text,
  owner_user_id uuid,
  is_active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  balance numeric,
  balance_updated_at timestamp with time zone,
  balance_updated_by uuid,
  provider text,
  salary_day smallint,
  cards_only boolean default false not null
);

create table if not exists public.card_pending (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  card_id uuid,
  amount numeric not null,
  label text,
  said_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid()
);

create table if not exists public.categories (
  id uuid default gen_random_uuid() not null,
  household_id uuid,
  name text not null,
  icon text,
  parent_id uuid,
  sort_order integer default 0,
  kind text default 'expense'::text not null,
  default_payment_method text,
  default_account_id uuid,
  default_card_id uuid
);

create table if not exists public.category_budgets (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  category_id uuid not null,
  monthly_amount numeric not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.category_rules (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  type text default 'expense'::text not null,
  match text not null,
  label text default ''::text not null,
  category_id uuid,
  subcategory_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.checkin_feelings (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  week_start date not null,
  user_id uuid default auth.uid() not null,
  feeling text not null,
  note text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.credit_cards (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  bank_account_id uuid not null,
  name text not null,
  last4 text,
  billing_day integer default 10 not null,
  owner_user_id uuid,
  is_active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  credit_limit integer,
  provider text
);

create table if not exists public.decision_messages (
  id uuid default gen_random_uuid() not null,
  decision_id uuid not null,
  household_id uuid not null,
  role text not null,
  author_id uuid default auth.uid() not null,
  text text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.decision_reads (
  decision_id uuid not null,
  household_id uuid not null,
  user_id uuid default auth.uid() not null,
  seen_at timestamp with time zone default now() not null
);

create table if not exists public.decision_votes (
  decision_id uuid not null,
  household_id uuid not null,
  user_id uuid default auth.uid() not null,
  vote text not null,
  note text,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.dupe_ok (
  household_id uuid not null,
  pair text not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null
);

create table if not exists public.feedback (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  kind text not null,
  text text not null,
  screen text,
  device text,
  status text default 'new'::text not null,
  owner_note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  pinned boolean default false not null,
  archived boolean default false not null,
  closed boolean default false not null,
  helped boolean,
  last_at timestamp with time zone default now() not null,
  last_by text default 'user'::text not null,
  owner_seen_at timestamp with time zone,
  user_seen_at timestamp with time zone
);

create table if not exists public.feedback_messages (
  id uuid default gen_random_uuid() not null,
  feedback_id uuid not null,
  author text not null,
  text text not null,
  created_at timestamp with time zone default now() not null,
  image text
);

create table if not exists public.goals (
  id uuid default gen_random_uuid() not null,
  household_id uuid,
  created_by uuid,
  icon text,
  name text not null,
  target_amount numeric not null,
  saved_amount numeric default 0,
  target_date date,
  created_at timestamp with time zone default now(),
  plan_items jsonb default '[]'::jsonb not null,
  notes text,
  trip_plan jsonb
);

create table if not exists public.household_area (
  household_id uuid not null,
  city_code text not null,
  city text not null,
  hood text,
  max_km integer default 5 not null,
  updated_at timestamp with time zone default now() not null,
  lat numeric(7,3),
  lon numeric(7,3)
);

create table if not exists public.household_reset_codes (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  user_id uuid not null,
  email text not null,
  code text not null,
  expires_at timestamp with time zone not null,
  used boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.household_stores (
  household_id uuid not null,
  chain text not null,
  store_id text not null,
  chain_name text,
  name text,
  address text,
  city text,
  km numeric,
  kind text,
  lat double precision,
  lon double precision
);

create table if not exists public.households (
  id uuid default gen_random_uuid() not null,
  name text not null,
  type text,
  created_at timestamp with time zone default now(),
  income_expectations jsonb default '[]'::jsonb not null,
  ai_monthly_limit integer default 600,
  decision_threshold integer default 500 not null,
  personal_allowance integer,
  people smallint,
  shop_area text
);

create table if not exists public.imports (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  created_by uuid,
  file_name text,
  kind text,
  rows integer default 0 not null,
  date_from date,
  date_to date,
  created_at timestamp with time zone default now() not null,
  removed_at timestamp with time zone,
  title text,
  source_kind text,
  source_id uuid
);

create table if not exists public.installments (
  id uuid default gen_random_uuid() not null,
  household_id uuid,
  created_by uuid,
  description text,
  total_amount numeric not null,
  payments_count integer not null,
  first_payment date not null,
  category_id uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.investment_snapshots (
  household_id uuid not null,
  snap_date date not null,
  total_ils numeric not null,
  detail jsonb
);

create table if not exists public.investment_trades (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  investment_id uuid not null,
  trade_date date not null,
  side text not null,
  units numeric not null,
  price numeric not null,
  fx numeric,
  fees numeric default 0 not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null
);

create table if not exists public.investments (
  id uuid default gen_random_uuid() not null,
  household_id uuid,
  created_by uuid,
  name text not null,
  asset_type text,
  cost numeric not null,
  current_value numeric,
  buy_date date,
  created_at timestamp with time zone default now(),
  symbol text,
  units numeric,
  currency text default 'ILS'::text not null,
  buy_fx numeric,
  buy_price numeric,
  value_updated_at timestamp with time zone
);

create table if not exists public.invites (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  created_by uuid,
  code text not null,
  used boolean default false,
  used_by uuid,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  revoked boolean default false not null
);

create table if not exists public.kosher_votes (
  barcode text not null,
  household_id uuid not null,
  level text not null,
  by_owner boolean default false not null,
  created_at timestamp with time zone default now() not null,
  cert text
);

create table if not exists public.loans (
  id uuid default gen_random_uuid() not null,
  household_id uuid,
  created_by uuid,
  direction text not null,
  counterparty text not null,
  amount numeric not null,
  loan_date date not null,
  note text,
  settled boolean default false,
  created_at timestamp with time zone default now(),
  is_maaser boolean default false not null,
  monthly_amount numeric,
  first_payment date
);

create table if not exists public.mail_prefs (
  user_id uuid not null,
  monthly boolean default false not null,
  updated_at timestamp with time zone default now() not null,
  news boolean default true not null
);

create table if not exists public.mail_sent (
  user_id uuid not null,
  campaign text not null,
  sent_at timestamp with time zone default now() not null,
  ok boolean default true not null
);

create table if not exists public.memberships (
  id uuid default gen_random_uuid() not null,
  household_id uuid,
  user_id uuid not null,
  display_name text,
  role text,
  created_at timestamp with time zone default now(),
  gender text
);

create table if not exists public.mfa_email (
  user_id uuid not null,
  enabled boolean default false not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.mfa_email_codes (
  user_id uuid not null,
  code_hash text not null,
  purpose text default 'login'::text not null,
  expires_at timestamp with time zone not null,
  attempts integer default 0 not null,
  sent_at timestamp with time zone default now() not null
);

create table if not exists public.mfa_email_sessions (
  session_id uuid not null,
  user_id uuid not null,
  verified_at timestamp with time zone default now() not null
);

create table if not exists public.monthly_reports (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  month text not null,
  data jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.news_digests (
  day date not null,
  digest jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.price_load_runs (
  id bigint generated always as identity not null,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  added integer,
  error text,
  chains jsonb
);

create table if not exists public.price_offers (
  barcode text not null,
  chain text not null,
  chain_name text,
  price numeric not null,
  seen_at timestamp with time zone default now() not null
);

create table if not exists public.price_prefs (
  household_id uuid not null,
  kosher text default 'any'::text not null,
  updated_at timestamp with time zone default now() not null,
  certs text[] default '{}'::text[] not null,
  clubs text[] default '{}'::text[] not null,
  chains_shown text[] default '{}'::text[] not null
);

create table if not exists public.price_products (
  barcode text not null,
  name text not null,
  names text default ''::text not null,
  maker text,
  qty numeric,
  unit text,
  seen_at timestamp with time zone default now() not null,
  image_url text,
  image_checked_at timestamp with time zone,
  kosher_cert text
);

create table if not exists public.price_promos (
  chain text not null,
  store_id text default ''::text not null,
  barcode text not null,
  promo_id text not null,
  text text,
  need integer default 1 not null,
  unit_price numeric not null,
  max_qty numeric,
  everyone boolean default true not null,
  club text,
  coupon boolean default false not null,
  min_buy numeric default 0 not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  seen_at timestamp with time zone default now() not null
);

create table if not exists public.price_store_offers (
  barcode text not null,
  chain text not null,
  store_id text not null,
  price numeric not null,
  seen_at timestamp with time zone default now() not null
);

create table if not exists public.price_stores (
  chain text not null,
  store_id text not null,
  chain_name text,
  name text,
  address text,
  city text,
  seen_at timestamp with time zone default now() not null,
  lat double precision,
  lon double precision,
  geo_q text,
  geo_at timestamp with time zone
);

create table if not exists public.price_wanted (
  query text not null,
  asked integer default 1 not null,
  first_at timestamp with time zone default now() not null,
  last_at timestamp with time zone default now() not null
);

create table if not exists public.properties (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  created_by uuid default auth.uid() not null,
  name text not null,
  city text,
  home boolean default false not null,
  rented boolean default false not null,
  value numeric,
  rent numeric,
  costs jsonb default '{}'::jsonb not null,
  mortgage jsonb,
  rent_payer text,
  account_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  household_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.recycle_bin (
  id bigint default nextval('recycle_bin_id_seq'::regclass) not null,
  household_id uuid not null,
  tbl text not null,
  row_id uuid,
  data jsonb not null,
  removed_by uuid,
  removed_at timestamp with time zone default now() not null,
  restored_at timestamp with time zone
);

create table if not exists public.reengage_sent (
  user_id uuid not null,
  sent_at timestamp with time zone default now() not null
);

create table if not exists public.referrals (
  user_id uuid not null,
  ref_code text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.shared_decisions (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  created_by uuid default auth.uid() not null,
  title text not null,
  amount numeric not null,
  category_id uuid,
  wanted_by date,
  note text,
  status text default 'open'::text not null,
  goal_id uuid,
  transaction_id uuid,
  created_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  reminded_at timestamp with time zone,
  summary text,
  concluded_by uuid
);

create table if not exists public.shop_guest_links (
  id uuid default gen_random_uuid() not null,
  token_hash text not null,
  label text not null,
  created_at timestamp with time zone default now() not null,
  revoked_at timestamp with time zone,
  last_used_at timestamp with time zone,
  uses integer default 0 not null,
  household_id uuid
);

create table if not exists public.shop_receipts (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  store text,
  bought_on date,
  total numeric(10,2),
  items jsonb default '[]'::jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  trip_id uuid
);

create table if not exists public.shop_trips (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  finished_at timestamp with time zone default now() not null,
  chain text,
  chain_name text,
  bought integer default 0 not null,
  left_over integer default 0 not null,
  receipt_id uuid,
  tx_id uuid,
  total numeric,
  created_by uuid default auth.uid()
);

create table if not exists public.shopping_items (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  name text not null,
  qty text,
  aisle text default 'other'::text not null,
  done boolean default false not null,
  added_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  done_at timestamp with time zone,
  cleared_at timestamp with time zone,
  barcode text,
  trip_id uuid,
  list_id uuid
);

create table if not exists public.shopping_lists (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  name text not null,
  kind text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  archived_at timestamp with time zone
);

create table if not exists public.transactions (
  id uuid default gen_random_uuid() not null,
  household_id uuid,
  created_by uuid,
  type text not null,
  description text,
  amount numeric not null,
  tx_date date not null,
  category_id uuid,
  subcategory_id uuid,
  nature text,
  spread text,
  source text,
  created_at timestamp with time zone default now(),
  payment_method text default 'credit'::text,
  account_id uuid,
  card_id uuid,
  import_id uuid,
  original jsonb
);

create table if not exists public.trips (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  created_by uuid default auth.uid() not null,
  status text default 'saved'::text not null,
  name text not null,
  country text,
  start_date date not null,
  end_date date not null,
  people integer default 2 not null,
  transaction_ids uuid[] default '{}'::uuid[] not null,
  excluded_ids uuid[] default '{}'::uuid[] not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.user_settings (
  user_id uuid not null,
  household_id uuid not null,
  reminders jsonb default '{}'::jsonb not null,
  integrations jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  maaser jsonb default '{"rate": 10, "enabled": false, "excludedCategoryIds": []}'::jsonb not null,
  learning jsonb
);

create table if not exists public.weekly_checkins (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  week_start date not null,
  summary jsonb default '{}'::jsonb not null,
  decisions jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

-- ======================================================================
-- Sequence owners
-- ======================================================================
alter sequence public.ai_calls_id_seq owned by public.ai_calls.id;
alter sequence public.app_errors_id_seq owned by public.app_errors.id;
alter sequence public.app_events_id_seq owned by public.app_events.id;
alter sequence public.recycle_bin_id_seq owned by public.recycle_bin.id;

-- ======================================================================
-- Primary keys, unique and check constraints
-- ======================================================================
alter table public.account_cleanup add constraint account_cleanup_pkey PRIMARY KEY (user_id);
alter table public.advisor_alerts add constraint advisor_alerts_household_id_dedupe_key_key UNIQUE (household_id, dedupe_key);
alter table public.advisor_alerts add constraint advisor_alerts_pkey PRIMARY KEY (id);
alter table public.advisor_alerts add constraint advisor_alerts_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text])));
alter table public.advisor_conversations add constraint advisor_conversations_pkey PRIMARY KEY (id);
alter table public.advisor_memories add constraint advisor_memories_pkey PRIMARY KEY (id);
alter table public.advisor_memories add constraint advisor_memories_kind_check CHECK ((kind = ANY (ARRAY['decision'::text, 'preference'::text, 'goal'::text, 'fact'::text])));
alter table public.advisor_messages add constraint advisor_messages_pkey PRIMARY KEY (id);
alter table public.advisor_messages add constraint advisor_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'ai'::text, 'advice'::text])));
alter table public.advisor_tasks add constraint advisor_tasks_pkey PRIMARY KEY (id);
alter table public.advisor_tasks add constraint advisor_tasks_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text])));
alter table public.agent_actions add constraint agent_actions_pkey PRIMARY KEY (id);
alter table public.ai_calls add constraint ai_calls_pkey PRIMARY KEY (id);
alter table public.ai_usage add constraint ai_usage_pkey PRIMARY KEY (household_id, month);
alter table public.app_errors add constraint app_errors_pkey PRIMARY KEY (id);
alter table public.app_errors add constraint app_errors_agent_check CHECK ((char_length(agent) <= 300));
alter table public.app_errors add constraint app_errors_detail_check CHECK ((char_length(detail) <= 4000));
alter table public.app_errors add constraint app_errors_message_check CHECK ((char_length(message) <= 500));
alter table public.app_errors add constraint app_errors_path_check CHECK ((char_length(path) <= 300));
alter table public.app_errors add constraint app_errors_source_check CHECK ((source = ANY (ARRAY['client'::text, 'server'::text])));
alter table public.app_events add constraint app_events_pkey PRIMARY KEY (id);
alter table public.app_events add constraint app_events_name_check CHECK ((char_length(name) <= 40));
alter table public.app_flags add constraint app_flags_pkey PRIMARY KEY (key);
alter table public.app_secrets add constraint app_secrets_pkey PRIMARY KEY (key);
alter table public.bank_accounts add constraint bank_accounts_pkey PRIMARY KEY (id);
alter table public.bank_accounts add constraint bank_accounts_provider_check CHECK (((provider IS NULL) OR (provider ~ '^[a-z]{2,20}$'::text)));
alter table public.bank_accounts add constraint bank_accounts_salary_day_check CHECK (((salary_day IS NULL) OR ((salary_day >= 1) AND (salary_day <= 31))));
alter table public.card_pending add constraint card_pending_pkey PRIMARY KEY (id);
alter table public.card_pending add constraint card_pending_amount_check CHECK ((amount > (0)::numeric));
alter table public.categories add constraint categories_pkey PRIMARY KEY (id);
alter table public.categories add constraint categories_default_payment_method_check CHECK ((default_payment_method = ANY (ARRAY['credit'::text, 'cash'::text, 'check'::text, 'standing_order'::text])));
alter table public.category_budgets add constraint category_budgets_household_id_category_id_key UNIQUE (household_id, category_id);
alter table public.category_budgets add constraint category_budgets_pkey PRIMARY KEY (id);
alter table public.category_budgets add constraint category_budgets_monthly_amount_check CHECK ((monthly_amount >= (0)::numeric));
alter table public.category_rules add constraint category_rules_household_id_type_match_key UNIQUE (household_id, type, match);
alter table public.category_rules add constraint category_rules_pkey PRIMARY KEY (id);
alter table public.category_rules add constraint category_rules_label_check CHECK ((length(label) <= 120));
alter table public.category_rules add constraint category_rules_match_check CHECK (((length(match) >= 1) AND (length(match) <= 80)));
alter table public.category_rules add constraint category_rules_type_check CHECK ((type = ANY (ARRAY['expense'::text, 'income'::text])));
alter table public.checkin_feelings add constraint checkin_feelings_household_id_week_start_user_id_key UNIQUE (household_id, week_start, user_id);
alter table public.checkin_feelings add constraint checkin_feelings_pkey PRIMARY KEY (id);
alter table public.checkin_feelings add constraint checkin_feelings_feeling_check CHECK ((feeling = ANY (ARRAY['calm'::text, 'ok'::text, 'stressed'::text])));
alter table public.credit_cards add constraint credit_cards_pkey PRIMARY KEY (id);
alter table public.credit_cards add constraint credit_cards_billing_day_check CHECK (((billing_day >= 1) AND (billing_day <= 28)));
alter table public.credit_cards add constraint credit_cards_credit_limit_check CHECK (((credit_limit IS NULL) OR (credit_limit >= 0)));
alter table public.credit_cards add constraint credit_cards_last4_check CHECK (((last4 IS NULL) OR (last4 ~ '^[0-9]{4}$'::text)));
alter table public.credit_cards add constraint credit_cards_provider_check CHECK (((provider IS NULL) OR (provider ~ '^[a-z]{2,20}$'::text)));
alter table public.decision_messages add constraint decision_messages_pkey PRIMARY KEY (id);
alter table public.decision_messages add constraint decision_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'ai'::text])));
alter table public.decision_messages add constraint decision_messages_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 4000)));
alter table public.decision_reads add constraint decision_reads_pkey PRIMARY KEY (decision_id, user_id);
alter table public.decision_votes add constraint decision_votes_pkey PRIMARY KEY (decision_id, user_id);
alter table public.decision_votes add constraint decision_votes_check CHECK (((vote = 'approve'::text) OR (char_length(COALESCE(TRIM(BOTH FROM note), ''::text)) > 0)));
alter table public.decision_votes add constraint decision_votes_note_check CHECK ((char_length(note) <= 500));
alter table public.decision_votes add constraint decision_votes_vote_check CHECK ((vote = ANY (ARRAY['approve'::text, 'not_now'::text, 'talk'::text])));
alter table public.dupe_ok add constraint dupe_ok_pkey PRIMARY KEY (household_id, pair);
alter table public.dupe_ok add constraint dupe_ok_pair_check CHECK (((char_length(pair) >= 3) AND (char_length(pair) <= 80)));
alter table public.feedback add constraint feedback_pkey PRIMARY KEY (id);
alter table public.feedback add constraint feedback_kind_check CHECK ((kind = ANY (ARRAY['bug'::text, 'idea'::text, 'other'::text])));
alter table public.feedback add constraint feedback_last_by_check CHECK ((last_by = ANY (ARRAY['user'::text, 'owner'::text])));
alter table public.feedback add constraint feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'working'::text, 'done'::text, 'wontfix'::text])));
alter table public.feedback add constraint feedback_text_check CHECK (((char_length(text) >= 3) AND (char_length(text) <= 2000)));
alter table public.feedback_messages add constraint feedback_messages_pkey PRIMARY KEY (id);
alter table public.feedback_messages add constraint feedback_messages_author_check CHECK ((author = ANY (ARRAY['user'::text, 'owner'::text, 'note'::text])));
alter table public.feedback_messages add constraint feedback_messages_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 2000)));
alter table public.goals add constraint goals_pkey PRIMARY KEY (id);
alter table public.household_area add constraint household_area_pkey PRIMARY KEY (household_id);
alter table public.household_area add constraint household_area_city_code_check CHECK ((city_code ~ '^[0-9]{1,6}$'::text));
alter table public.household_area add constraint household_area_geo_check CHECK ((((lat IS NULL) AND (lon IS NULL)) OR (((lat >= (29)::numeric) AND (lat <= (34)::numeric)) AND ((lon >= (34)::numeric) AND (lon <= (36)::numeric)) AND ((lat * (200)::numeric) = round((lat * (200)::numeric))) AND ((lon * (200)::numeric) = round((lon * (200)::numeric))))));
alter table public.household_area add constraint household_area_hood_check CHECK (((hood IS NULL) OR (length(hood) <= 60)));
alter table public.household_area add constraint household_area_max_km_check CHECK (((max_km >= 0) AND (max_km <= 10)));
alter table public.household_reset_codes add constraint household_reset_codes_pkey PRIMARY KEY (id);
alter table public.household_stores add constraint household_stores_pkey PRIMARY KEY (household_id, chain);
alter table public.households add constraint households_pkey PRIMARY KEY (id);
alter table public.households add constraint households_decision_threshold_check CHECK ((decision_threshold >= 0));
alter table public.households add constraint households_people_check CHECK (((people >= 1) AND (people <= 20)));
alter table public.households add constraint households_personal_allowance_check CHECK ((personal_allowance >= 0));
alter table public.households add constraint households_shop_area_check CHECK (((shop_area IS NULL) OR (char_length(shop_area) <= 60)));
alter table public.imports add constraint imports_pkey PRIMARY KEY (id);
alter table public.imports add constraint imports_source_kind_check CHECK (((source_kind IS NULL) OR (source_kind = ANY (ARRAY['bank'::text, 'card'::text]))));
alter table public.imports add constraint imports_title_check CHECK (((title IS NULL) OR (char_length(title) <= 80)));
alter table public.installments add constraint installments_pkey PRIMARY KEY (id);
alter table public.investment_snapshots add constraint investment_snapshots_pkey PRIMARY KEY (household_id, snap_date);
alter table public.investment_trades add constraint investment_trades_pkey PRIMARY KEY (id);
alter table public.investment_trades add constraint investment_trades_side_check CHECK ((side = ANY (ARRAY['buy'::text, 'sell'::text])));
alter table public.investments add constraint investments_pkey PRIMARY KEY (id);
alter table public.invites add constraint invites_code_key UNIQUE (code);
alter table public.invites add constraint invites_pkey PRIMARY KEY (id);
alter table public.kosher_votes add constraint kosher_votes_pkey PRIMARY KEY (barcode, household_id);
alter table public.kosher_votes add constraint kosher_votes_cert_check CHECK (((cert IS NULL) OR ((length(cert) >= 2) AND (length(cert) <= 40))));
alter table public.kosher_votes add constraint kosher_votes_level_check CHECK ((level = ANY (ARRAY['none'::text, 'regular'::text, 'mehadrin'::text])));
alter table public.loans add constraint loans_pkey PRIMARY KEY (id);
alter table public.loans add constraint loans_monthly_amount_check CHECK (((monthly_amount IS NULL) OR (monthly_amount > (0)::numeric)));
alter table public.mail_prefs add constraint mail_prefs_pkey PRIMARY KEY (user_id);
alter table public.mail_sent add constraint mail_sent_pkey PRIMARY KEY (user_id, campaign);
alter table public.mail_sent add constraint mail_sent_campaign_check CHECK (((campaign = ANY (ARRAY['start'::text, 'first'::text, 'more'::text, 'picture'::text, 'nudge'::text, 'fixed'::text])) OR (campaign ~ '^monthly-[0-9]{4}-[0-9]{2}$'::text) OR (campaign ~ '^thanks-[0-9a-f-]{36}$'::text)));
alter table public.memberships add constraint memberships_user_id_key UNIQUE (user_id);
alter table public.memberships add constraint memberships_pkey PRIMARY KEY (id);
alter table public.memberships add constraint memberships_gender_check CHECK ((gender = ANY (ARRAY['m'::text, 'f'::text])));
alter table public.mfa_email add constraint mfa_email_pkey PRIMARY KEY (user_id);
alter table public.mfa_email_codes add constraint mfa_email_codes_pkey PRIMARY KEY (user_id);
alter table public.mfa_email_codes add constraint mfa_email_codes_purpose_check CHECK ((purpose = ANY (ARRAY['login'::text, 'enable'::text])));
alter table public.mfa_email_sessions add constraint mfa_email_sessions_pkey PRIMARY KEY (session_id);
alter table public.monthly_reports add constraint monthly_reports_household_id_month_key UNIQUE (household_id, month);
alter table public.monthly_reports add constraint monthly_reports_pkey PRIMARY KEY (id);
alter table public.news_digests add constraint news_digests_pkey PRIMARY KEY (day);
alter table public.price_load_runs add constraint price_load_runs_pkey PRIMARY KEY (id);
alter table public.price_offers add constraint price_offers_pkey PRIMARY KEY (barcode, chain);
alter table public.price_offers add constraint price_offers_price_check CHECK (((price > (0)::numeric) AND (price < (100000)::numeric)));
alter table public.price_prefs add constraint price_prefs_pkey PRIMARY KEY (household_id);
alter table public.price_prefs add constraint price_prefs_certs_check CHECK ((cardinality(certs) <= 20));
alter table public.price_prefs add constraint price_prefs_chains_shape CHECK ((array_to_string(chains_shown, ','::text) ~ '^([a-z0-9-]{1,40}(,[a-z0-9-]{1,40})*)?$'::text));
alter table public.price_prefs add constraint price_prefs_chains_shown_check CHECK ((cardinality(chains_shown) <= 40));
alter table public.price_prefs add constraint price_prefs_clubs_check CHECK ((cardinality(clubs) <= 80));
alter table public.price_prefs add constraint price_prefs_clubs_shape CHECK ((array_to_string(clubs, ','::text) ~ '^([a-z0-9-]{1,40}:(club|card)(,[a-z0-9-]{1,40}:(club|card))*)?$'::text));
alter table public.price_prefs add constraint price_prefs_kosher_check CHECK ((kosher = ANY (ARRAY['any'::text, 'regular'::text, 'mehadrin'::text])));
alter table public.price_products add constraint price_products_pkey PRIMARY KEY (barcode);
alter table public.price_products add constraint price_products_barcode_check CHECK ((barcode ~ '^[0-9]{4,20}$'::text));
alter table public.price_products add constraint price_products_kosher_cert_check CHECK (((kosher_cert IS NULL) OR ((length(kosher_cert) >= 2) AND (length(kosher_cert) <= 40))));
alter table public.price_promos add constraint price_promos_pkey PRIMARY KEY (chain, store_id, barcode, promo_id);
alter table public.price_promos add constraint price_promos_club_check CHECK (((club IS NULL) OR (club = ANY (ARRAY['club'::text, 'card'::text]))));
alter table public.price_promos add constraint price_promos_need_check CHECK (((need >= 1) AND (need <= 50)));
alter table public.price_promos add constraint price_promos_unit_price_check CHECK (((unit_price >= (0)::numeric) AND (unit_price < (100000)::numeric)));
alter table public.price_store_offers add constraint price_store_offers_pkey PRIMARY KEY (chain, store_id, barcode);
alter table public.price_store_offers add constraint price_store_offers_price_check CHECK (((price > (0)::numeric) AND (price < (100000)::numeric)));
alter table public.price_stores add constraint price_stores_pkey PRIMARY KEY (chain, store_id);
alter table public.price_stores add constraint price_stores_geo_check CHECK ((((lat IS NULL) AND (lon IS NULL)) OR (((lat >= (29)::double precision) AND (lat <= (34)::double precision)) AND ((lon >= (34)::double precision) AND (lon <= (36)::double precision)))));
alter table public.price_wanted add constraint price_wanted_pkey PRIMARY KEY (query);
alter table public.properties add constraint properties_pkey PRIMARY KEY (id);
alter table public.properties add constraint properties_city_check CHECK ((char_length(city) <= 60));
alter table public.properties add constraint properties_costs_check CHECK (((jsonb_typeof(costs) = 'object'::text) AND (pg_column_size(costs) < 2000)));
alter table public.properties add constraint properties_mortgage_check CHECK (((mortgage IS NULL) OR ((jsonb_typeof(mortgage) = 'object'::text) AND (pg_column_size(mortgage) < 2000))));
alter table public.properties add constraint properties_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)));
alter table public.properties add constraint properties_rent_check CHECK (((rent >= (0)::numeric) AND (rent < (1000000000)::numeric)));
alter table public.properties add constraint properties_rent_payer_check CHECK ((char_length(rent_payer) <= 80));
alter table public.properties add constraint properties_value_check CHECK (((value >= (0)::numeric) AND (value < (1000000000)::numeric)));
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.recycle_bin add constraint recycle_bin_pkey PRIMARY KEY (id);
alter table public.reengage_sent add constraint reengage_sent_pkey PRIMARY KEY (user_id);
alter table public.referrals add constraint referrals_pkey PRIMARY KEY (user_id);
alter table public.referrals add constraint referrals_ref_code_check CHECK ((ref_code ~ '^[0-9a-f]{6}$'::text));
alter table public.shared_decisions add constraint shared_decisions_pkey PRIMARY KEY (id);
alter table public.shared_decisions add constraint shared_decisions_amount_check CHECK ((amount > (0)::numeric));
alter table public.shared_decisions add constraint shared_decisions_note_check CHECK ((char_length(note) <= 500));
alter table public.shared_decisions add constraint shared_decisions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'approved'::text, 'not_now'::text, 'talk'::text, 'planned'::text, 'bought'::text, 'withdrawn'::text, 'declined'::text])));
alter table public.shared_decisions add constraint shared_decisions_summary_check CHECK ((char_length(summary) <= 1000));
alter table public.shared_decisions add constraint shared_decisions_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80)));
alter table public.shop_guest_links add constraint shop_guest_links_token_hash_key UNIQUE (token_hash);
alter table public.shop_guest_links add constraint shop_guest_links_pkey PRIMARY KEY (id);
alter table public.shop_guest_links add constraint shop_guest_links_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 60)));
alter table public.shop_guest_links add constraint shop_guest_links_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text));
alter table public.shop_receipts add constraint shop_receipts_pkey PRIMARY KEY (id);
alter table public.shop_trips add constraint shop_trips_pkey PRIMARY KEY (id);
alter table public.shopping_items add constraint shopping_items_pkey PRIMARY KEY (id);
alter table public.shopping_items add constraint shopping_items_aisle_check CHECK ((char_length(aisle) <= 20));
alter table public.shopping_items add constraint shopping_items_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
alter table public.shopping_items add constraint shopping_items_qty_check CHECK (((qty IS NULL) OR (char_length(qty) <= 20)));
alter table public.shopping_lists add constraint shopping_lists_pkey PRIMARY KEY (id);
alter table public.shopping_lists add constraint shopping_lists_name_check CHECK (((length(name) >= 1) AND (length(name) <= 60)));
alter table public.transactions add constraint transactions_pkey PRIMARY KEY (id);
alter table public.transactions add constraint transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['credit'::text, 'cash'::text, 'check'::text, 'standing_order'::text])));
alter table public.trips add constraint trips_pkey PRIMARY KEY (id);
alter table public.trips add constraint trips_check CHECK ((end_date >= start_date));
alter table public.trips add constraint trips_country_check CHECK ((char_length(country) <= 40));
alter table public.trips add constraint trips_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
alter table public.trips add constraint trips_people_check CHECK (((people >= 1) AND (people <= 20)));
alter table public.trips add constraint trips_status_check CHECK ((status = ANY (ARRAY['saved'::text, 'dismissed'::text])));
alter table public.user_settings add constraint user_settings_pkey PRIMARY KEY (user_id);
alter table public.weekly_checkins add constraint weekly_checkins_household_id_week_start_key UNIQUE (household_id, week_start);
alter table public.weekly_checkins add constraint weekly_checkins_pkey PRIMARY KEY (id);

-- ======================================================================
-- Foreign keys
-- ======================================================================
alter table public.advisor_alerts add constraint advisor_alerts_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.advisor_memories add constraint advisor_memories_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.advisor_memories add constraint advisor_memories_source_conversation_id_fkey FOREIGN KEY (source_conversation_id) REFERENCES advisor_conversations(id) ON DELETE SET NULL;
alter table public.advisor_messages add constraint advisor_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES advisor_conversations(id) ON DELETE CASCADE;
alter table public.advisor_messages add constraint advisor_messages_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.advisor_tasks add constraint advisor_tasks_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES advisor_conversations(id) ON DELETE SET NULL;
alter table public.advisor_tasks add constraint advisor_tasks_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.agent_actions add constraint agent_actions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES advisor_conversations(id) ON DELETE SET NULL;
alter table public.agent_actions add constraint agent_actions_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.agent_actions add constraint agent_actions_message_id_fkey FOREIGN KEY (message_id) REFERENCES advisor_messages(id) ON DELETE SET NULL;
alter table public.ai_usage add constraint ai_usage_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.card_pending add constraint card_pending_card_id_fkey FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE CASCADE;
alter table public.card_pending add constraint card_pending_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.categories add constraint categories_default_account_id_fkey FOREIGN KEY (default_account_id) REFERENCES bank_accounts(id);
alter table public.categories add constraint categories_default_card_id_fkey FOREIGN KEY (default_card_id) REFERENCES credit_cards(id);
alter table public.categories add constraint categories_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.categories add constraint categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.category_budgets add constraint category_budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.category_rules add constraint category_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.category_rules add constraint category_rules_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.category_rules add constraint category_rules_subcategory_id_fkey FOREIGN KEY (subcategory_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.checkin_feelings add constraint checkin_feelings_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.credit_cards add constraint credit_cards_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE;
alter table public.decision_messages add constraint decision_messages_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES shared_decisions(id) ON DELETE CASCADE;
alter table public.decision_messages add constraint decision_messages_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.decision_reads add constraint decision_reads_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES shared_decisions(id) ON DELETE CASCADE;
alter table public.decision_reads add constraint decision_reads_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.decision_votes add constraint decision_votes_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES shared_decisions(id) ON DELETE CASCADE;
alter table public.decision_votes add constraint decision_votes_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.dupe_ok add constraint dupe_ok_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.feedback_messages add constraint feedback_messages_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE;
alter table public.goals add constraint goals_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.imports add constraint imports_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON UPDATE CASCADE;
alter table public.installments add constraint installments_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.installments add constraint installments_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.investment_snapshots add constraint investment_snapshots_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.investment_trades add constraint investment_trades_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.investment_trades add constraint investment_trades_investment_id_fkey FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE CASCADE;
alter table public.investments add constraint investments_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.invites add constraint invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.invites add constraint invites_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.invites add constraint invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES auth.users(id);
alter table public.kosher_votes add constraint kosher_votes_barcode_fkey FOREIGN KEY (barcode) REFERENCES price_products(barcode) ON DELETE CASCADE;
alter table public.loans add constraint loans_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.mail_prefs add constraint mail_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.memberships add constraint memberships_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.monthly_reports add constraint monthly_reports_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.price_offers add constraint price_offers_barcode_fkey FOREIGN KEY (barcode) REFERENCES price_products(barcode) ON DELETE CASCADE;
alter table public.properties add constraint properties_account_id_fkey FOREIGN KEY (account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
alter table public.properties add constraint properties_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.referrals add constraint referrals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.shared_decisions add constraint shared_decisions_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.shared_decisions add constraint shared_decisions_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;
alter table public.shared_decisions add constraint shared_decisions_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.shared_decisions add constraint shared_decisions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
alter table public.shop_guest_links add constraint shop_guest_links_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.shop_receipts add constraint shop_receipts_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.shop_receipts add constraint shop_receipts_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES shop_trips(id) ON DELETE SET NULL;
alter table public.shop_trips add constraint shop_trips_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.shop_trips add constraint shop_trips_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES shop_receipts(id) ON DELETE SET NULL;
alter table public.shop_trips add constraint shop_trips_tx_id_fkey FOREIGN KEY (tx_id) REFERENCES transactions(id) ON DELETE SET NULL;
alter table public.shopping_items add constraint shopping_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.shopping_items add constraint shopping_items_list_id_fkey FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE SET NULL;
alter table public.shopping_items add constraint shopping_items_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES shop_trips(id) ON DELETE SET NULL;
alter table public.shopping_lists add constraint shopping_lists_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.transactions add constraint transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES bank_accounts(id);
alter table public.transactions add constraint transactions_card_id_fkey FOREIGN KEY (card_id) REFERENCES credit_cards(id);
alter table public.transactions add constraint transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.transactions add constraint transactions_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.transactions add constraint transactions_import_id_fkey FOREIGN KEY (import_id) REFERENCES imports(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.transactions add constraint transactions_subcategory_id_fkey FOREIGN KEY (subcategory_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.trips add constraint trips_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
alter table public.weekly_checkins add constraint weekly_checkins_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

-- ======================================================================
-- Indexes
-- ======================================================================
CREATE INDEX advisor_alerts_open ON public.advisor_alerts USING btree (household_id, created_at DESC) WHERE (dismissed_at IS NULL);
CREATE INDEX advisor_memories_hh ON public.advisor_memories USING btree (household_id, created_at DESC);
CREATE INDEX advisor_memories_source_conversation_id_idx ON public.advisor_memories USING btree (source_conversation_id);
CREATE INDEX advisor_messages_conv ON public.advisor_messages USING btree (conversation_id, created_at);
CREATE INDEX advisor_messages_household_id_idx ON public.advisor_messages USING btree (household_id);
CREATE INDEX advisor_tasks_conversation_id_idx ON public.advisor_tasks USING btree (conversation_id);
CREATE INDEX advisor_tasks_household_status ON public.advisor_tasks USING btree (household_id, status, due_date);
CREATE INDEX agent_actions_conv ON public.agent_actions USING btree (conversation_id);
CREATE INDEX agent_actions_household_id_idx ON public.agent_actions USING btree (household_id);
CREATE INDEX agent_actions_message_id_idx ON public.agent_actions USING btree (message_id);
CREATE INDEX ai_calls_at_idx ON public.ai_calls USING btree (at DESC);
CREATE INDEX ai_calls_user_idx ON public.ai_calls USING btree (user_id, at DESC);
CREATE INDEX app_errors_at_idx ON public.app_errors USING btree (at DESC);
CREATE INDEX app_events_at_idx ON public.app_events USING btree (at DESC);
CREATE INDEX app_events_user_idx ON public.app_events USING btree (user_id, at DESC);
CREATE INDEX card_pending_household_idx ON public.card_pending USING btree (household_id, said_at DESC);
CREATE INDEX categories_default_account_id_idx ON public.categories USING btree (default_account_id);
CREATE INDEX categories_default_card_id_idx ON public.categories USING btree (default_card_id);
CREATE INDEX categories_household_id_idx ON public.categories USING btree (household_id);
CREATE INDEX categories_parent_id_idx ON public.categories USING btree (parent_id);
CREATE INDEX category_budgets_category_id_idx ON public.category_budgets USING btree (category_id);
CREATE INDEX category_rules_household ON public.category_rules USING btree (household_id);
CREATE INDEX credit_cards_bank_account_id_idx ON public.credit_cards USING btree (bank_account_id);
CREATE INDEX decision_messages_decision_idx ON public.decision_messages USING btree (decision_id, created_at);
CREATE INDEX decision_messages_household_idx ON public.decision_messages USING btree (household_id, created_at DESC);
CREATE INDEX decision_reads_household_idx ON public.decision_reads USING btree (household_id);
CREATE INDEX decision_votes_household_idx ON public.decision_votes USING btree (household_id);
CREATE INDEX feedback_created_idx ON public.feedback USING btree (created_at DESC);
CREATE INDEX feedback_messages_feedback ON public.feedback_messages USING btree (feedback_id, created_at);
CREATE INDEX goals_household_id_idx ON public.goals USING btree (household_id);
CREATE INDEX imports_household_idx ON public.imports USING btree (household_id, created_at DESC);
CREATE INDEX imports_source ON public.imports USING btree (household_id, source_id);
CREATE INDEX installments_category_id_idx ON public.installments USING btree (category_id);
CREATE INDEX installments_household_id_idx ON public.installments USING btree (household_id);
CREATE INDEX investment_trades_household_id_idx ON public.investment_trades USING btree (household_id);
CREATE INDEX investment_trades_investment_id_idx ON public.investment_trades USING btree (investment_id);
CREATE INDEX investments_household_id_idx ON public.investments USING btree (household_id);
CREATE INDEX invites_created_by_idx ON public.invites USING btree (created_by);
CREATE INDEX invites_household_id_idx ON public.invites USING btree (household_id);
CREATE INDEX invites_used_by_idx ON public.invites USING btree (used_by);
CREATE INDEX loans_household_id_idx ON public.loans USING btree (household_id);
CREATE INDEX mail_sent_user_sent ON public.mail_sent USING btree (user_id, sent_at DESC);
CREATE INDEX memberships_household_id_idx ON public.memberships USING btree (household_id);
CREATE INDEX price_offers_barcode ON public.price_offers USING btree (barcode);
CREATE INDEX price_offers_seen ON public.price_offers USING btree (seen_at);
CREATE INDEX price_products_names_trgm ON public.price_products USING gin (lower(((names || ' '::text) || name)) gin_trgm_ops);
CREATE INDEX price_promos_barcode ON public.price_promos USING btree (barcode);
CREATE INDEX price_store_offers_barcode ON public.price_store_offers USING btree (barcode);
CREATE INDEX properties_household_idx ON public.properties USING btree (household_id, created_at);
CREATE INDEX recycle_bin_household_idx ON public.recycle_bin USING btree (household_id, removed_at DESC);
CREATE INDEX referrals_ref_code ON public.referrals USING btree (ref_code);
CREATE INDEX shared_decisions_category_id_idx ON public.shared_decisions USING btree (category_id);
CREATE INDEX shared_decisions_goal_id_idx ON public.shared_decisions USING btree (goal_id);
CREATE INDEX shared_decisions_household_idx ON public.shared_decisions USING btree (household_id, created_at DESC);
CREATE INDEX shared_decisions_transaction_id_idx ON public.shared_decisions USING btree (transaction_id);
CREATE INDEX shop_receipts_household ON public.shop_receipts USING btree (household_id, created_at DESC);
CREATE INDEX shop_trips_household ON public.shop_trips USING btree (household_id, finished_at DESC);
CREATE INDEX shopping_items_household ON public.shopping_items USING btree (household_id, cleared_at, created_at);
CREATE INDEX shopping_items_list ON public.shopping_items USING btree (list_id);
CREATE INDEX shopping_items_trip ON public.shopping_items USING btree (trip_id);
CREATE INDEX shopping_lists_household ON public.shopping_lists USING btree (household_id) WHERE (archived_at IS NULL);
CREATE INDEX transactions_account_id_idx ON public.transactions USING btree (account_id);
CREATE INDEX transactions_card_id_idx ON public.transactions USING btree (card_id);
CREATE INDEX transactions_category_id_idx ON public.transactions USING btree (category_id);
CREATE INDEX transactions_household_id_idx ON public.transactions USING btree (household_id);
CREATE INDEX transactions_import_idx ON public.transactions USING btree (import_id) WHERE (import_id IS NOT NULL);
CREATE INDEX transactions_subcategory_id_idx ON public.transactions USING btree (subcategory_id);
CREATE INDEX trips_household_idx ON public.trips USING btree (household_id, start_date DESC);

-- ======================================================================
-- Functions
-- ======================================================================
CREATE OR REPLACE FUNCTION public.accept_household_invite(p_code text)
 RETURNS TABLE(household_id uuid, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite record; v_uid uuid := auth.uid(); v_display text; v_cur uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_invite from public.invites where code = p_code for update;
  if v_invite is null then raise exception 'INVITE_INVALID'; end if;

  select m.household_id into v_cur from public.memberships m where m.user_id = v_uid limit 1;
  if v_cur = v_invite.household_id then
    return query select v_cur, (select m.role from public.memberships m where m.user_id = v_uid limit 1); return;
  end if;
  if v_invite.used then raise exception 'INVITE_USED'; end if;
  if v_invite.revoked then raise exception 'INVITE_REVOKED'; end if;
  if v_invite.expires_at < now() then raise exception 'INVITE_EXPIRED'; end if;

  if v_cur is not null then
    if exists (select 1 from public.memberships m where m.household_id = v_cur and m.user_id <> v_uid)
       or exists (select 1 from public.transactions t where t.household_id = v_cur)
       or exists (select 1 from public.loans t where t.household_id = v_cur)
       or exists (select 1 from public.installments t where t.household_id = v_cur)
       or exists (select 1 from public.investments t where t.household_id = v_cur)
       or exists (select 1 from public.goals t where t.household_id = v_cur)
       or exists (select 1 from public.advisor_tasks t where t.household_id = v_cur) then
      raise exception 'HOUSEHOLD_HAS_DATA';
    end if;
    update public.advisor_conversations a set household_id = v_invite.household_id, is_private = true
     where a.household_id = v_cur and a.user_id = v_uid;
    delete from public.category_budgets a where a.household_id = v_cur;
    update public.categories c set default_account_id = null, default_card_id = null where c.household_id = v_cur;
    delete from public.credit_cards a where a.household_id = v_cur;
    delete from public.categories a where a.household_id = v_cur;
    delete from public.bank_accounts a where a.household_id = v_cur;
    delete from public.household_reset_codes a where a.household_id = v_cur;
    delete from public.invites a where a.household_id = v_cur;
    delete from public.memberships a where a.user_id = v_uid;
    delete from public.households h where h.id = v_cur;
  end if;

  select coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)) into v_display
  from auth.users u where u.id = v_uid;
  insert into public.memberships(household_id, user_id, display_name, role)
  values (v_invite.household_id, v_uid, coalesce(v_display, 'משתמש'), 'member');
  update public.user_settings s set household_id = v_invite.household_id where s.user_id = v_uid;
  update public.push_subscriptions s set household_id = v_invite.household_id where s.user_id = v_uid;
  update public.invites set used = true, used_by = v_uid where id = v_invite.id;
  return query select v_invite.household_id, 'member'::text;
end $function$
;
CREATE OR REPLACE FUNCTION public.bump_ai_usage(p_household uuid, p_month text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.ai_usage(household_id, month, count) values (p_household, p_month, 1)
  on conflict (household_id, month) do update set count = public.ai_usage.count + 1
  returning count;
$function$
;
CREATE OR REPLACE FUNCTION public.can_see_conversation(p_conv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.advisor_conversations c
    where c.id = p_conv
      and c.household_id in (select public.my_households())
      and (c.user_id = auth.uid() or not c.is_private)
  )
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_household_reset(p_household_id uuid, p_code text, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rec record;
begin
  select * into v_rec
  from public.household_reset_codes
  where household_id = p_household_id
    and user_id = p_user_id
    and code = p_code
    and used = false
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_rec is null then
    raise exception 'Invalid or expired reset code';
  end if;

  update public.household_reset_codes set used = true where id = v_rec.id;

  delete from public.transactions where household_id = p_household_id;
  delete from public.installments where household_id = p_household_id;
  delete from public.loans where household_id = p_household_id;
  delete from public.investments where household_id = p_household_id;
  delete from public.goals where household_id = p_household_id;
  delete from public.categories where household_id = p_household_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.find_duplicates_batch(p_household uuid, p_items jsonb)
 RETURNS TABLE(idx integer, id uuid, tx_date date, amount numeric, description text, source text, category_name text, card_name text, score integer, reasons text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (i->>'idx')::int, d.*
  from jsonb_array_elements(p_items) i
  cross join lateral public.find_possible_duplicates(
    p_household, (i->>'amount')::numeric, (i->>'date')::date, coalesce(i->>'type','expense'),
    i->>'description', nullif(i->>'card_id','')::uuid, null, 3) d;
$function$
;
CREATE OR REPLACE FUNCTION public.find_possible_duplicates(p_household uuid, p_amount numeric, p_date date, p_type text, p_description text DEFAULT NULL::text, p_card_id uuid DEFAULT NULL::uuid, p_exclude_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 3)
 RETURNS TABLE(id uuid, tx_date date, amount numeric, description text, source text, category_name text, card_name text, score integer, reasons text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cand as (
    select t.*, abs(t.tx_date - p_date) as ddiff,
      split_part(regexp_replace(coalesce(t.description,''), '["''().\-]', ' ', 'g'), ' ', 1) as w1,
      split_part(regexp_replace(coalesce(p_description,''), '["''().\-]', ' ', 'g'), ' ', 1) as w2
    from transactions t
    where t.household_id = p_household
      and t.household_id in (select my_households())
      and t.type = p_type
      and abs(t.amount - p_amount) < 0.01
      and abs(t.tx_date - p_date) <= p_days
      and (p_exclude_id is null or t.id <> p_exclude_id)
  )
  select c.id, c.tx_date, c.amount, c.description, c.source, cat.name, cc.name,
         (50
          + case when c.ddiff = 0 then 25 when c.ddiff = 1 then 15 else 5 end
          + case when p_card_id is not null and c.card_id = p_card_id then 15 else 0 end
          + case when length(c.w1) > 1 and c.w1 = c.w2 then 10 else 0 end)::int,
         array_remove(array[
           'אותו סכום',
           case c.ddiff when 0 then 'אותו תאריך' when 1 then 'הפרש של יום' when 2 then 'הפרש של יומיים'
                else 'הפרש של ' || c.ddiff || ' ימים' end,
           case when p_card_id is not null and c.card_id = p_card_id then 'אותו כרטיס' end,
           case when length(c.w1) > 1 and c.w1 = c.w2 then 'תיאור דומה' end
         ], null)
  from cand c
  left join categories cat on cat.id = c.category_id
  left join credit_cards cc on cc.id = c.card_id
  order by 8 desc, c.tx_date desc
  limit 5;
$function$
;
CREATE OR REPLACE FUNCTION public.get_invite_info(p_code text)
 RETURNS TABLE(valid boolean, reason text, household_name text, inviter_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v record; v_uid uuid := auth.uid();
begin
  select i.*, h.name as hname,
         coalesce((select m.display_name from public.memberships m where m.user_id = i.created_by and m.household_id = i.household_id), 'בן/בת הזוג') as iname
    into v
  from public.invites i join public.households h on h.id = i.household_id
  where i.code = p_code;
  if v is null then return query select false, 'invalid', null::text, null::text; return; end if;
  if v_uid is not null and exists (select 1 from public.memberships where user_id = v_uid and household_id = v.household_id) then
    return query select false, 'already_member', v.hname, v.iname; return; end if;
  if v.used then return query select false, 'used', v.hname, v.iname; return; end if;
  if v.revoked then return query select false, 'revoked', v.hname, v.iname; return; end if;
  if v.expires_at < now() then return query select false, 'expired', v.hname, v.iname; return; end if;
  return query select true, 'ok', v.hname, v.iname;
end $function$
;
CREATE OR REPLACE FUNCTION public.household_member_count(p_hid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.memberships where household_id = p_hid and p_hid in (select public.my_households())
$function$
;
CREATE OR REPLACE FUNCTION public.keep_in_bin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.mfa_ok()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select auth.uid() is null or coalesce((public.my_mfa_state() ->> 'ok')::boolean, true)
$function$
;
CREATE OR REPLACE FUNCTION public.mfa_state_for(p_user uuid, p_aal text, p_session uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  with f as (
    select exists (select 1 from auth.mfa_factors m where m.user_id = p_user and m.status = 'verified' and m.factor_type = 'totp') as totp,
           coalesce((select e.enabled from public.mfa_email e where e.user_id = p_user), false) as chosen,
           coalesce((select a.on_ from public.app_flags a where a.key = 'email_code_for_all'), false)
             and exists (select 1 from auth.identities i where i.user_id = p_user and i.provider = 'email') as mandatory
  ), g as (
    select f.*, f.chosen or (f.mandatory and not f.totp) as email,
           -- only the required-for-all code is satisfied by an emailed link or Google
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
$function$
;
CREATE OR REPLACE FUNCTION public.my_households()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select household_id from memberships where user_id = auth.uid()
$function$
;
CREATE OR REPLACE FUNCTION public.my_mfa_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select public.mfa_state_for(auth.uid(), auth.jwt() ->> 'aal', nullif(auth.jwt() ->> 'session_id', '')::uuid)
$function$
;
CREATE OR REPLACE FUNCTION public.my_sessions()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, last_seen timestamp with time zone, user_agent text, ip text, current boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select s.id, s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at), s.user_agent, host(s.ip)::text,
         s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  from auth.sessions s
  where s.user_id = auth.uid() and (s.not_after is null or s.not_after > now())
  order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc
  limit 20
$function$
;
CREATE OR REPLACE FUNCTION public.ops_funnel(p_since timestamp with time zone, p_exclude uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with u as (
    select id, created_at from auth.users where created_at >= p_since and not (id = any(coalesce(p_exclude, '{}')))
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
$function$
;
CREATE OR REPLACE FUNCTION public.ops_tx_span()
 RETURNS TABLE(household_id uuid, n bigint, months bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.household_id, count(*), count(distinct date_trunc('month', t.tx_date))
  from public.transactions t group by t.household_id
$function$
;
CREATE OR REPLACE FUNCTION public.price_by_barcodes(p_barcodes text[])
 RETURNS TABLE(barcode text, name text, names text, maker text, qty numeric, unit text, offers jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with codes as (
    select distinct b from unnest(p_barcodes[1:200]) b where b ~ '^\d{4,14}$'
  ), mine as (
    select s.* from public.household_stores s where s.household_id = (select h from public.my_households() h limit 1)
  )
  select p.barcode, p.name, p.names, p.maker, p.qty, p.unit,
    coalesce((select jsonb_agg(jsonb_build_object('chain', o.chain, 'chain_name', o.chain_name,
        'price', coalesce((select so.price from public.price_store_offers so where so.chain = o.chain and so.store_id = m.store_id and so.barcode = o.barcode), o.price),
        'seen_at', o.seen_at, 'store', m.name, 'local', m.store_id is not null,
        'promos', coalesce((select jsonb_agg(jsonb_build_object('text', pr.text, 'need', pr.need, 'unit_price', pr.unit_price, 'max_qty', pr.max_qty,
              'everyone', pr.everyone, 'club', pr.club, 'coupon', pr.coupon, 'min_buy', pr.min_buy, 'starts_at', pr.starts_at, 'ends_at', pr.ends_at) order by pr.unit_price)
            from (select * from public.price_promos pr
                  where pr.chain = o.chain and pr.barcode = o.barcode and (pr.ends_at is null or pr.ends_at > now())
                    and pr.store_id = (case when m.store_id is not null and exists (select 1 from public.price_promos x where x.chain = o.chain and x.store_id = m.store_id limit 1) then m.store_id else '' end)
                  order by pr.unit_price limit 4) pr), '[]'::jsonb)))
      from public.price_offers o left join mine m on m.chain = o.chain where o.barcode = p.barcode), '[]'::jsonb)
  from codes c join public.price_products p on p.barcode = c.b;
$function$
;
CREATE OR REPLACE FUNCTION public.price_search(p_queries text[])
 RETURNS TABLE(q integer, barcode text, name text, names text, maker text, qty numeric, unit text, offers jsonb, kosher jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with qs as (
    select i::int as q, array_remove(regexp_split_to_array(lower(regexp_replace(t, '[״"׳''`,.()\-+/\\*]', ' ', 'g')), '\s+'), '') as w
    from unnest(p_queries[1:300]) with ordinality as x(t, i)
  ), mine as (
    select s.* from public.household_stores s where s.household_id = (select h from public.my_households() h limit 1)
  ), keyed as (
    select qs.*, (select x from unnest(qs.w) x order by length(x) desc limit 1) as k from qs where cardinality(qs.w) > 0
  ), matched as (
    select kq.q, kq.w, p.*
    from keyed kq cross join lateral (
      select * from public.price_products p
      where lower(p.names || ' ' || p.name) like '%' || kq.k || '%'
        and lower(p.names || ' ' || p.name) like all (select '%' || x || '%' from unnest(kq.w) x)
    ) p
  ), scored as (
    select m.*,
      (select count(*) from unnest(m.w) x where lower(m.name) ~ ('(^|[^א-ת])[הובלמש]?' || regexp_replace(x, '([\[\]{}?^$|.*+()\\])', '\\\1', 'g') || '($|[^א-ת])')) as whole,
      (lower(m.name) ~ ('^[הובלמש]?' || regexp_replace(m.w[1], '([\[\]{}?^$|.*+()\\])', '\\\1', 'g'))) as starts,
      (select count(*) from public.price_offers o where o.barcode = m.barcode) as sold
    from matched m
  ), hits as (
    select s.*, row_number() over (partition by s.q order by s.whole desc, s.starts desc, s.sold desc, length(s.name)) as rn from scored s
  )
  select h.q, h.barcode, h.name, h.names, h.maker, h.qty, h.unit,
    coalesce((select jsonb_agg(jsonb_build_object('chain', o.chain, 'chain_name', o.chain_name,
        'price', coalesce((select so.price from public.price_store_offers so where so.chain = o.chain and so.store_id = m.store_id and so.barcode = o.barcode), o.price),
        'seen_at', o.seen_at, 'store', m.name, 'local', m.store_id is not null,
        'promos', coalesce((select jsonb_agg(jsonb_build_object('text', pr.text, 'need', pr.need, 'unit_price', pr.unit_price, 'max_qty', pr.max_qty,
              'everyone', pr.everyone, 'club', pr.club, 'coupon', pr.coupon, 'min_buy', pr.min_buy, 'starts_at', pr.starts_at, 'ends_at', pr.ends_at) order by pr.unit_price)
            from (select * from public.price_promos pr
                  where pr.chain = o.chain and pr.barcode = o.barcode and (pr.ends_at is null or pr.ends_at > now())
                    and pr.store_id = (case when m.store_id is not null and exists (select 1 from public.price_promos x where x.chain = o.chain and x.store_id = m.store_id limit 1) then m.store_id else '' end)
                  order by pr.unit_price limit 4) pr), '[]'::jsonb)))
      from public.price_offers o left join mine m on m.chain = o.chain where o.barcode = h.barcode), '[]'::jsonb),
    jsonb_build_object(
      'owner', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.by_owner limit 1),
      'owner_cert', (select v.cert from public.kosher_votes v where v.barcode = h.barcode and v.by_owner limit 1),
      'votes', coalesce((select jsonb_object_agg(level, n) from (select v.level, count(*) n from public.kosher_votes v where v.barcode = h.barcode and not v.by_owner group by v.level) z), '{}'::jsonb),
      'certs', coalesce((select jsonb_object_agg(cert, n) from (select v.cert, count(*) n from public.kosher_votes v where v.barcode = h.barcode and not v.by_owner and v.cert is not null group by v.cert) z), '{}'::jsonb),
      'open', h.kosher_cert,
      'mine', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.household_id in (select public.my_households()) and not v.by_owner limit 1),
      'mine_cert', (select v.cert from public.kosher_votes v where v.barcode = h.barcode and v.household_id in (select public.my_households()) and not v.by_owner limit 1))
  from hits h where h.rn <= 40;
$function$
;
CREATE OR REPLACE FUNCTION public.remove_household_member(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_caller_household uuid;
  v_caller_role text;
  v_target_household uuid;
begin
  select household_id, role into v_caller_household, v_caller_role
  from public.memberships where user_id = v_uid;

  if v_caller_role is distinct from 'owner' then
    raise exception 'Only an owner can remove members';
  end if;

  if p_user_id = v_uid then
    raise exception 'Use a dedicated "leave household" flow instead';
  end if;

  select household_id into v_target_household
  from public.memberships where user_id = p_user_id;

  if v_target_household is null or v_target_household <> v_caller_household then
    raise exception 'That user is not in your household';
  end if;

  delete from public.memberships
  where user_id = p_user_id and household_id = v_caller_household;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.request_household_reset_code(p_household_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
begin
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into public.household_reset_codes(household_id, user_id, email, code, expires_at)
  values (p_household_id, auth.uid(), p_email, v_code, now() + interval '15 minutes');

  -- TODO: send v_code to p_email via Edge Function / SMTP provider.
  -- Example flow: invoke HTTPS endpoint from your backend with (email, code).
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reset_household_full()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_household uuid;
begin
  select household_id into v_household from public.memberships where user_id = auth.uid();
  if v_household is null then
    raise exception 'Not a member of any household';
  end if;

  delete from public.transactions where household_id = v_household;
  delete from public.installments where household_id = v_household;
  delete from public.loans where household_id = v_household;
  delete from public.investments where household_id = v_household;
  delete from public.goals where household_id = v_household;
  delete from public.categories where household_id = v_household;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reset_household_month(p_year integer, p_month integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_household uuid;
  v_start date;
  v_end date;
begin
  select household_id into v_household from public.memberships where user_id = auth.uid();
  if v_household is null then
    raise exception 'Not a member of any household';
  end if;
  if p_month < 1 or p_month > 12 then
    raise exception 'p_month must be 1-12';
  end if;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month')::date;

  delete from public.transactions
  where household_id = v_household
    and tx_date >= v_start and tx_date < v_end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.restore_from_bin(p_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.recycle_bin;
begin
  select * into b from public.recycle_bin where id = p_id and restored_at is null;
  if b.id is null or b.household_id not in (select public.my_households()) then raise exception 'not found'; end if;
  if b.tbl not in ('transactions', 'goals', 'installments', 'categories', 'loans', 'investments', 'bank_accounts', 'credit_cards', 'trips') then raise exception 'not restorable'; end if;
  execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict do nothing', b.tbl, b.tbl) using b.data;
  update public.recycle_bin set restored_at = now() where id = b.id;
  return b.tbl;
end $function$
;
CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.invites
  set revoked = true
  where id = p_invite_id
    and created_by = auth.uid()
    and used = false;

  if not found then
    raise exception 'Invite not found, already used, or not yours to revoke';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.advisor_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.unbump_ai_usage(p_household uuid, p_month text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.ai_usage set count = greatest(count - 1, 0) where household_id = p_household and month = p_month returning count;
$function$
;

-- ======================================================================
-- Triggers
-- ======================================================================
CREATE TRIGGER advisor_messages_touch AFTER INSERT ON public.advisor_messages FOR EACH ROW EXECUTE FUNCTION touch_conversation();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.categories FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.credit_cards FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.goals FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.installments FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.investments FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION keep_in_bin();
CREATE TRIGGER keep_in_bin BEFORE DELETE ON public.trips FOR EACH ROW EXECUTE FUNCTION keep_in_bin();

-- ======================================================================
-- Row level security
-- ======================================================================
alter table public.account_cleanup enable row level security;
alter table public.advisor_alerts enable row level security;
alter table public.advisor_conversations enable row level security;
alter table public.advisor_memories enable row level security;
alter table public.advisor_messages enable row level security;
alter table public.advisor_tasks enable row level security;
alter table public.agent_actions enable row level security;
alter table public.ai_calls enable row level security;
alter table public.ai_usage enable row level security;
alter table public.app_errors enable row level security;
alter table public.app_events enable row level security;
alter table public.app_flags enable row level security;
alter table public.app_secrets enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.card_pending enable row level security;
alter table public.categories enable row level security;
alter table public.category_budgets enable row level security;
alter table public.category_rules enable row level security;
alter table public.checkin_feelings enable row level security;
alter table public.credit_cards enable row level security;
alter table public.decision_messages enable row level security;
alter table public.decision_reads enable row level security;
alter table public.decision_votes enable row level security;
alter table public.dupe_ok enable row level security;
alter table public.feedback enable row level security;
alter table public.feedback_messages enable row level security;
alter table public.goals enable row level security;
alter table public.household_area enable row level security;
alter table public.household_reset_codes enable row level security;
alter table public.household_stores enable row level security;
alter table public.households enable row level security;
alter table public.imports enable row level security;
alter table public.installments enable row level security;
alter table public.investment_snapshots enable row level security;
alter table public.investment_trades enable row level security;
alter table public.investments enable row level security;
alter table public.invites enable row level security;
alter table public.kosher_votes enable row level security;
alter table public.loans enable row level security;
alter table public.mail_prefs enable row level security;
alter table public.mail_sent enable row level security;
alter table public.memberships enable row level security;
alter table public.mfa_email enable row level security;
alter table public.mfa_email_codes enable row level security;
alter table public.mfa_email_sessions enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.news_digests enable row level security;
alter table public.price_load_runs enable row level security;
alter table public.price_offers enable row level security;
alter table public.price_prefs enable row level security;
alter table public.price_products enable row level security;
alter table public.price_promos enable row level security;
alter table public.price_store_offers enable row level security;
alter table public.price_stores enable row level security;
alter table public.price_wanted enable row level security;
alter table public.properties enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.recycle_bin enable row level security;
alter table public.reengage_sent enable row level security;
alter table public.referrals enable row level security;
alter table public.shared_decisions enable row level security;
alter table public.shop_guest_links enable row level security;
alter table public.shop_receipts enable row level security;
alter table public.shop_trips enable row level security;
alter table public.shopping_items enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.transactions enable row level security;
alter table public.trips enable row level security;
alter table public.user_settings enable row level security;
alter table public.weekly_checkins enable row level security;

-- ======================================================================
-- Policies
-- ======================================================================
create policy advisor_alerts_household on public.advisor_alerts as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.advisor_alerts as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy adv_delete_own on public.advisor_conversations as permissive for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy adv_insert_own on public.advisor_conversations as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (household_id IN ( SELECT my_households() AS my_households))));
create policy adv_select on public.advisor_conversations as permissive for select to authenticated
  using (((household_id IN ( SELECT my_households() AS my_households)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (NOT is_private))));
create policy adv_update_own on public.advisor_conversations as permissive for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (household_id IN ( SELECT my_households() AS my_households))));
create policy two_step_required on public.advisor_conversations as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy advisor_memories_household on public.advisor_memories as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.advisor_memories as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy advmsg_insert on public.advisor_messages as permissive for insert to authenticated
  with check (((author_id = ( SELECT auth.uid() AS uid)) AND can_see_conversation(conversation_id) AND (household_id IN ( SELECT my_households() AS my_households))));
create policy advmsg_select on public.advisor_messages as permissive for select to authenticated
  using (can_see_conversation(conversation_id));
create policy two_step_required on public.advisor_messages as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy advisor_tasks_household on public.advisor_tasks as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.advisor_tasks as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy agent_actions_household on public.agent_actions as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.agent_actions as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy ai_usage_read on public.ai_usage as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.ai_usage as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy bank_accounts_household_all on public.bank_accounts as permissive for all to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.bank_accounts as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy card_pending_household_all on public.card_pending as permissive for all to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = auth.uid()))))
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = auth.uid()))));
create policy "household members can delete categories" on public.categories as permissive for delete to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy "household members can insert categories" on public.categories as permissive for insert to public
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy "household members can select categories" on public.categories as permissive for select to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy "household members can update categories" on public.categories as permissive for update to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.categories as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy category_budgets_household_all on public.category_budgets as permissive for all to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.category_budgets as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy category_rules_household on public.category_rules as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.category_rules as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy checkin_feelings_read on public.checkin_feelings as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy checkin_feelings_write on public.checkin_feelings as permissive for all to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (household_id IN ( SELECT my_households() AS my_households))))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (household_id IN ( SELECT my_households() AS my_households))));
create policy two_step_required on public.checkin_feelings as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy credit_cards_household_all on public.credit_cards as permissive for all to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.credit_cards as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy decision_messages_delete on public.decision_messages as permissive for delete to authenticated
  using (((household_id IN ( SELECT my_households() AS my_households)) AND (author_id = ( SELECT auth.uid() AS uid)) AND (role = 'user'::text)));
create policy decision_messages_insert on public.decision_messages as permissive for insert to authenticated
  with check (((household_id IN ( SELECT my_households() AS my_households)) AND (author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM shared_decisions d
  WHERE ((d.id = decision_messages.decision_id) AND (d.household_id = decision_messages.household_id))))));
create policy decision_messages_select on public.decision_messages as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.decision_messages as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy decision_reads_select on public.decision_reads as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy decision_reads_write on public.decision_reads as permissive for all to authenticated
  using (((household_id IN ( SELECT my_households() AS my_households)) AND (user_id = ( SELECT auth.uid() AS uid))))
  with check (((household_id IN ( SELECT my_households() AS my_households)) AND (user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM shared_decisions d
  WHERE ((d.id = decision_reads.decision_id) AND (d.household_id = decision_reads.household_id))))));
create policy two_step_required on public.decision_reads as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy decision_votes_select on public.decision_votes as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy decision_votes_write on public.decision_votes as permissive for all to authenticated
  using (((household_id IN ( SELECT my_households() AS my_households)) AND (user_id = ( SELECT auth.uid() AS uid))))
  with check (((household_id IN ( SELECT my_households() AS my_households)) AND (user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM shared_decisions d
  WHERE ((d.id = decision_votes.decision_id) AND (d.household_id = decision_votes.household_id))))));
create policy two_step_required on public.decision_votes as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy dupe_ok_household_all on public.dupe_ok as permissive for all to authenticated
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.dupe_ok as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy feedback_insert_own on public.feedback as permissive for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy feedback_read_own on public.feedback as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy two_step_required on public.feedback as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy feedback_messages_read_own on public.feedback_messages as permissive for select to authenticated
  using (((author <> 'note'::text) AND (feedback_id IN ( SELECT feedback.id
   FROM feedback
  WHERE (feedback.user_id = ( SELECT auth.uid() AS uid))))));
create policy two_step_required on public.feedback_messages as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy goals_household on public.goals as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.goals as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy household_area_own on public.household_area as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy reset_codes_owner_only on public.household_reset_codes as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy two_step_required on public.household_reset_codes as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy household_stores_own on public.household_stores as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy households_delete_members on public.households as permissive for delete to authenticated
  using ((id IN ( SELECT my_households() AS my_households)));
create policy households_insert on public.households as permissive for insert to authenticated
  with check (true);
create policy households_select on public.households as permissive for select to authenticated
  using ((id IN ( SELECT my_households() AS my_households)));
create policy households_update_members on public.households as permissive for update to authenticated
  using ((id IN ( SELECT my_households() AS my_households)))
  with check ((id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.households as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy imports_household on public.imports as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.imports as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy "household members can delete installments" on public.installments as permissive for delete to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy "household members can insert installments" on public.installments as permissive for insert to public
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy "household members can select installments" on public.installments as permissive for select to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy "household members can update installments" on public.installments as permissive for update to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.installments as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy investment_snapshots_household on public.investment_snapshots as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.investment_snapshots as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy investment_trades_household on public.investment_trades as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.investment_trades as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy investments_household on public.investments as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.investments as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy invites_all on public.invites as permissive for all to public
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy invites_select_own_household on public.invites as permissive for select to public
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.invites as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy kosher_votes_own on public.kosher_votes as permissive for all to authenticated
  using (((household_id IN ( SELECT my_households() AS my_households)) AND (NOT by_owner)))
  with check (((household_id IN ( SELECT my_households() AS my_households)) AND (NOT by_owner)));
create policy loans_household on public.loans as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.loans as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy mail_prefs_own on public.mail_prefs as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy two_step_required on public.mail_prefs as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy memberships_insert_founder on public.memberships as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND (household_member_count(household_id) = 0)));
create policy memberships_select_household on public.memberships as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (household_id IN ( SELECT my_households() AS my_households))));
create policy memberships_update_self on public.memberships as permissive for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy two_step_required on public.memberships as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy mfa_email_read_own on public.mfa_email as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy monthly_reports_household on public.monthly_reports as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.monthly_reports as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy news_digests_read on public.news_digests as permissive for select to authenticated
  using (true);
create policy two_step_required on public.news_digests as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy price_offers_read on public.price_offers as permissive for select to authenticated
  using (true);
create policy price_prefs_own on public.price_prefs as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy price_products_read on public.price_products as permissive for select to authenticated
  using (true);
create policy price_store_offers_read on public.price_store_offers as permissive for select to authenticated
  using (true);
create policy price_stores_read on public.price_stores as permissive for select to authenticated
  using (true);
create policy properties_delete on public.properties as permissive for delete to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy properties_insert on public.properties as permissive for insert to authenticated
  with check (((household_id IN ( SELECT my_households() AS my_households)) AND (created_by = auth.uid())));
create policy properties_select on public.properties as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy properties_update on public.properties as permissive for update to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.properties as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy push_subscriptions_owner_all on public.push_subscriptions as permissive for all to public
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy two_step_required on public.push_subscriptions as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy recycle_bin_read on public.recycle_bin as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.recycle_bin as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy shared_decisions_delete on public.shared_decisions as permissive for delete to authenticated
  using (((household_id IN ( SELECT my_households() AS my_households)) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy shared_decisions_insert on public.shared_decisions as permissive for insert to authenticated
  with check (((household_id IN ( SELECT my_households() AS my_households)) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy shared_decisions_select on public.shared_decisions as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy shared_decisions_update on public.shared_decisions as permissive for update to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.shared_decisions as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy shop_receipts_household_all on public.shop_receipts as permissive for all to public
  using ((household_id IN ( SELECT m.household_id
   FROM memberships m
  WHERE (m.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT m.household_id
   FROM memberships m
  WHERE (m.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.shop_receipts as restrictive for all to public
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy shop_trips_household_all on public.shop_trips as permissive for all to public
  using ((household_id IN ( SELECT m.household_id
   FROM memberships m
  WHERE (m.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT m.household_id
   FROM memberships m
  WHERE (m.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.shop_trips as restrictive for all to public
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy shopping_items_household_all on public.shopping_items as permissive for all to authenticated
  using ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT memberships.household_id
   FROM memberships
  WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.shopping_items as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy shopping_lists_household_all on public.shopping_lists as permissive for all to public
  using ((household_id IN ( SELECT m.household_id
   FROM memberships m
  WHERE (m.user_id = ( SELECT auth.uid() AS uid)))))
  with check ((household_id IN ( SELECT m.household_id
   FROM memberships m
  WHERE (m.user_id = ( SELECT auth.uid() AS uid)))));
create policy two_step_required on public.shopping_lists as restrictive for all to public
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy two_step_required on public.transactions as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy tx_delete_household on public.transactions as permissive for delete to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy tx_insert_household on public.transactions as permissive for insert to authenticated
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy tx_select_household on public.transactions as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy tx_update_household on public.transactions as permissive for update to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy trips_delete on public.trips as permissive for delete to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy trips_insert on public.trips as permissive for insert to authenticated
  with check (((household_id IN ( SELECT my_households() AS my_households)) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy trips_select on public.trips as permissive for select to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)));
create policy trips_update on public.trips as permissive for update to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));
create policy two_step_required on public.trips as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy two_step_required on public.user_settings as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy user_settings_select_own on public.user_settings as permissive for select to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy user_settings_upsert_own on public.user_settings as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy two_step_required on public.weekly_checkins as restrictive for all to authenticated
  using (( SELECT mfa_ok() AS mfa_ok))
  with check (( SELECT mfa_ok() AS mfa_ok));
create policy weekly_checkins_household on public.weekly_checkins as permissive for all to authenticated
  using ((household_id IN ( SELECT my_households() AS my_households)))
  with check ((household_id IN ( SELECT my_households() AS my_households)));

-- ======================================================================
-- Table grants (only anon, authenticated and public; Supabase gives service_role everything)
-- ======================================================================
revoke all on table public.account_cleanup from public, anon, authenticated;
revoke all on table public.advisor_alerts from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_alerts to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_alerts to authenticated;
revoke all on table public.advisor_conversations from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_conversations to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_conversations to authenticated;
revoke all on table public.advisor_memories from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_memories to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_memories to anon;
revoke all on table public.advisor_messages from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_messages to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_messages to anon;
revoke all on table public.advisor_tasks from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_tasks to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.advisor_tasks to authenticated;
revoke all on table public.agent_actions from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.agent_actions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.agent_actions to authenticated;
revoke all on table public.ai_calls from public, anon, authenticated;
revoke all on table public.ai_usage from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_usage to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_usage to authenticated;
revoke all on table public.app_errors from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_errors to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_errors to anon;
revoke all on table public.app_events from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_events to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_events to authenticated;
revoke all on table public.app_flags from public, anon, authenticated;
revoke all on table public.app_secrets from public, anon, authenticated;
revoke all on table public.bank_accounts from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_accounts to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_accounts to authenticated;
revoke all on table public.card_pending from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.card_pending to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.card_pending to anon;
revoke all on table public.categories from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.categories to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.categories to anon;
revoke all on table public.category_budgets from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.category_budgets to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.category_budgets to authenticated;
revoke all on table public.category_rules from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.category_rules to authenticated;
revoke all on table public.checkin_feelings from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.checkin_feelings to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.checkin_feelings to authenticated;
revoke all on table public.credit_cards from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.credit_cards to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.credit_cards to anon;
revoke all on table public.decision_messages from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.decision_messages to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.decision_messages to authenticated;
revoke all on table public.decision_reads from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.decision_reads to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.decision_reads to anon;
revoke all on table public.decision_votes from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.decision_votes to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.decision_votes to authenticated;
revoke all on table public.dupe_ok from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.dupe_ok to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.dupe_ok to authenticated;
revoke all on table public.feedback from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.feedback to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.feedback to authenticated;
revoke all on table public.feedback_messages from public, anon, authenticated;
grant maintain, references, select, trigger, truncate on table public.feedback_messages to anon;
grant maintain, references, select, trigger, truncate on table public.feedback_messages to authenticated;
revoke all on table public.goals from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.goals to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.goals to authenticated;
revoke all on table public.household_area from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.household_area to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.household_area to anon;
revoke all on table public.household_reset_codes from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.household_reset_codes to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.household_reset_codes to authenticated;
revoke all on table public.household_stores from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.household_stores to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.household_stores to anon;
revoke all on table public.households from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.households to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.households to anon;
revoke all on table public.imports from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.imports to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.imports to anon;
revoke all on table public.installments from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.installments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.installments to authenticated;
revoke all on table public.investment_snapshots from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.investment_snapshots to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.investment_snapshots to authenticated;
revoke all on table public.investment_trades from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.investment_trades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.investment_trades to anon;
revoke all on table public.investments from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.investments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.investments to authenticated;
revoke all on table public.invites from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invites to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invites to authenticated;
revoke all on table public.kosher_votes from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.kosher_votes to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.kosher_votes to authenticated;
revoke all on table public.loans from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.loans to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.loans to authenticated;
revoke all on table public.mail_prefs from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mail_prefs to authenticated;
revoke all on table public.mail_sent from public, anon, authenticated;
revoke all on table public.memberships from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.memberships to anon;
grant insert, maintain, references, select, trigger, truncate on table public.memberships to authenticated;
revoke all on table public.mfa_email from public, anon, authenticated;
grant delete, maintain, references, select, trigger, truncate on table public.mfa_email to anon;
grant delete, maintain, references, select, trigger, truncate on table public.mfa_email to authenticated;
revoke all on table public.mfa_email_codes from public, anon, authenticated;
revoke all on table public.mfa_email_sessions from public, anon, authenticated;
revoke all on table public.monthly_reports from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.monthly_reports to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.monthly_reports to anon;
revoke all on table public.news_digests from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.news_digests to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.news_digests to authenticated;
revoke all on table public.price_load_runs from public, anon, authenticated;
revoke all on table public.price_offers from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_offers to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_offers to anon;
revoke all on table public.price_prefs from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_prefs to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_prefs to authenticated;
revoke all on table public.price_products from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_products to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_products to anon;
revoke all on table public.price_promos from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_promos to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_promos to anon;
revoke all on table public.price_store_offers from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_store_offers to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_store_offers to anon;
revoke all on table public.price_stores from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_stores to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_stores to anon;
revoke all on table public.price_wanted from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_wanted to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.price_wanted to anon;
revoke all on table public.properties from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.properties to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.properties to anon;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_subscriptions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_subscriptions to authenticated;
revoke all on table public.recycle_bin from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recycle_bin to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recycle_bin to anon;
revoke all on table public.reengage_sent from public, anon, authenticated;
revoke all on table public.referrals from public, anon, authenticated;
revoke all on table public.shared_decisions from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shared_decisions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shared_decisions to authenticated;
revoke all on table public.shop_guest_links from public, anon, authenticated;
revoke all on table public.shop_receipts from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shop_receipts to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shop_receipts to anon;
revoke all on table public.shop_trips from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shop_trips to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shop_trips to anon;
revoke all on table public.shopping_items from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shopping_items to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shopping_items to anon;
revoke all on table public.shopping_lists from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shopping_lists to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.shopping_lists to anon;
revoke all on table public.transactions from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.transactions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.transactions to anon;
revoke all on table public.trips from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.trips to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.trips to anon;
revoke all on table public.user_settings from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_settings to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_settings to authenticated;
revoke all on table public.weekly_checkins from public, anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.weekly_checkins to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.weekly_checkins to authenticated;

-- ======================================================================
-- Function grants
-- ======================================================================
revoke all on function public.accept_household_invite(p_code text) from public, anon, authenticated;
grant execute on function public.accept_household_invite(p_code text) to authenticated;
revoke all on function public.bump_ai_usage(p_household uuid, p_month text) from public, anon, authenticated;
revoke all on function public.can_see_conversation(p_conv uuid) from public, anon, authenticated;
grant execute on function public.can_see_conversation(p_conv uuid) to authenticated;
revoke all on function public.confirm_household_reset(p_household_id uuid, p_code text, p_user_id uuid) from public, anon, authenticated;
revoke all on function public.find_duplicates_batch(p_household uuid, p_items jsonb) from public, anon, authenticated;
grant execute on function public.find_duplicates_batch(p_household uuid, p_items jsonb) to authenticated;
revoke all on function public.find_possible_duplicates(p_household uuid, p_amount numeric, p_date date, p_type text, p_description text, p_card_id uuid, p_exclude_id uuid, p_days integer) from public, anon, authenticated;
grant execute on function public.find_possible_duplicates(p_household uuid, p_amount numeric, p_date date, p_type text, p_description text, p_card_id uuid, p_exclude_id uuid, p_days integer) to authenticated;
revoke all on function public.get_invite_info(p_code text) from public, anon, authenticated;
grant execute on function public.get_invite_info(p_code text) to authenticated;
revoke all on function public.household_member_count(p_hid uuid) from public, anon, authenticated;
grant execute on function public.household_member_count(p_hid uuid) to authenticated;
revoke all on function public.keep_in_bin() from public, anon, authenticated;
revoke all on function public.mfa_ok() from public, anon, authenticated;
grant execute on function public.mfa_ok() to authenticated;
revoke all on function public.mfa_state_for(p_user uuid, p_aal text, p_session uuid) from public, anon, authenticated;
revoke all on function public.my_households() from public, anon, authenticated;
grant execute on function public.my_households() to public;
grant execute on function public.my_households() to authenticated;
revoke all on function public.my_mfa_state() from public, anon, authenticated;
grant execute on function public.my_mfa_state() to authenticated;
revoke all on function public.my_sessions() from public, anon, authenticated;
grant execute on function public.my_sessions() to authenticated;
revoke all on function public.ops_funnel(p_since timestamp with time zone, p_exclude uuid[]) from public, anon, authenticated;
revoke all on function public.ops_tx_span() from public, anon, authenticated;
revoke all on function public.price_by_barcodes(p_barcodes text[]) from public, anon, authenticated;
grant execute on function public.price_by_barcodes(p_barcodes text[]) to authenticated;
revoke all on function public.price_search(p_queries text[]) from public, anon, authenticated;
grant execute on function public.price_search(p_queries text[]) to authenticated;
revoke all on function public.remove_household_member(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.remove_household_member(p_user_id uuid) to authenticated;
revoke all on function public.request_household_reset_code(p_household_id uuid, p_email text) from public, anon, authenticated;
revoke all on function public.reset_household_full() from public, anon, authenticated;
revoke all on function public.reset_household_month(p_year integer, p_month integer) from public, anon, authenticated;
revoke all on function public.restore_from_bin(p_id bigint) from public, anon, authenticated;
grant execute on function public.restore_from_bin(p_id bigint) to authenticated;
revoke all on function public.revoke_invite(p_invite_id uuid) from public, anon, authenticated;
grant execute on function public.revoke_invite(p_invite_id uuid) to authenticated;
revoke all on function public.touch_conversation() from public, anon, authenticated;
revoke all on function public.unbump_ai_usage(p_household uuid, p_month text) from public, anon, authenticated;

-- ======================================================================
-- Scheduled jobs (pg_cron). The secret is read from app_secrets when a job runs.
-- ======================================================================
do $jobs$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.schedule('account-cleanup', '10 8 * * *', $cron$
    select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/cron/cleanup',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  $cron$);
  perform cron.schedule('advisor-nightly-alerts', '0 18 * * *', $cron$
    select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/alerts/run',
      headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 90000);
  $cron$);
  perform cron.schedule('advisor-task-reminders', '0 6 * * *', $cron$
    select net.http_post(
      url := 'https://budget-web-u0iy.onrender.com/api/tasks/remind-due',
      headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 90000
    );
  $cron$);
  perform cron.schedule('keep-server-warm', '*/10 * * * *', $cron$select net.http_get(url := 'https://budget-web-u0iy.onrender.com/api/health', timeout_milliseconds := 60000);$cron$);
  perform cron.schedule('monthly-report', '0 6 1 * *', $cron$
    select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/reports/run',
      headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  $cron$);
  perform cron.schedule('owner-daily-digest', '45 20,21 * * *', $cron$
    select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/admin/daily/run',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  $cron$);
  perform cron.schedule('prices-morning', '20 5 * * *', $cron$
    select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/cron/prices-morning',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  $cron$);
  perform cron.schedule('prices-nightly', '30 1 * * *', $cron$
    select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/cron/prices',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  $cron$);
  perform cron.schedule('weekly-couple-checkin', '0 17 * * 0', $cron$
    select net.http_post(url := 'https://budget-web-u0iy.onrender.com/api/checkin/run',
      headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',(select value from public.app_secrets where key='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 90000);
  $cron$);
end $jobs$;
