-- Just enough of Supabase (roles, a few auth tables, auth.uid() and
-- auth.jwt()) for the migrations to load into a plain Postgres in CI.
do $r$ begin if not exists (select 1 from pg_roles where rolname=$$anon$$) then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $r$;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now(), last_sign_in_at timestamptz);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text, factor_type text);
create table auth.mfa_amr_claims (id uuid primary key default gen_random_uuid(), session_id uuid, authentication_method text);
create table auth.sessions (id uuid primary key, user_id uuid, created_at timestamptz, updated_at timestamptz, refreshed_at timestamp, user_agent text, ip inet, not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
