-- Supabase upgrade for budget app advanced features
-- Run in SQL Editor (Project -> SQL Editor)

create extension if not exists pgcrypto;

create table if not exists public.user_settings (
  user_id uuid primary key,
  household_id uuid not null,
  reminders jsonb not null default '{}'::jsonb,
  integrations jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_settings' and policyname='user_settings_select_own'
  ) then
    create policy user_settings_select_own on public.user_settings
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_settings' and policyname='user_settings_upsert_own'
  ) then
    create policy user_settings_upsert_own on public.user_settings
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end$$;

create table if not exists public.household_reset_codes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null,
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.household_reset_codes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='household_reset_codes' and policyname='reset_codes_owner_only'
  ) then
    create policy reset_codes_owner_only on public.household_reset_codes
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end$$;

create or replace function public.request_household_reset_code(p_household_id uuid, p_email text)
returns void
language plpgsql
security definer
as $$
declare
  v_code text;
begin
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into public.household_reset_codes(household_id, user_id, email, code, expires_at)
  values (p_household_id, auth.uid(), p_email, v_code, now() + interval '15 minutes');

  -- TODO: send v_code to p_email via Edge Function / SMTP provider.
  -- Example flow: invoke HTTPS endpoint from your backend with (email, code).
end;
$$;

grant execute on function public.request_household_reset_code(uuid, text) to authenticated;

create or replace function public.confirm_household_reset(
  p_household_id uuid,
  p_code text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
as $$
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
$$;

grant execute on function public.confirm_household_reset(uuid, text, uuid) to authenticated;
