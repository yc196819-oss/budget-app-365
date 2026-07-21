-- Fix household invite flow: atomic accept, revoke, remove-member.
-- Run in Supabase SQL Editor. Safe to run multiple times (idempotent).
--
-- Bugs this fixes:
-- 1. Client marked an invite "used" with an unchecked update() call — if RLS
--    blocked a non-owner from updating another household's invite row, the
--    invite silently stayed reusable forever.
-- 2. Every membership row was inserted with role='owner', even for people
--    joining someone else's household via an invite link.
-- 3. No way to revoke a pending invite or remove a member.
--
-- All three RPCs below are SECURITY DEFINER, so they enforce their own
-- checks server-side instead of depending on invites/memberships RLS.

alter table public.invites
  add column if not exists revoked boolean not null default false;

-- Atomically validate + consume an invite and create the membership.
create or replace function public.accept_household_invite(p_code text)
returns table(household_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_uid uuid := auth.uid();
  v_display_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.memberships where user_id = v_uid) then
    raise exception 'User already belongs to a household';
  end if;

  -- Lock the row so two concurrent accepts on the same code can't both succeed.
  select * into v_invite
  from public.invites
  where code = p_code
  for update;

  if v_invite is null then
    raise exception 'Invalid invite code';
  end if;
  if v_invite.used then
    raise exception 'Invite already used';
  end if;
  if v_invite.revoked then
    raise exception 'Invite was revoked';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Invite expired';
  end if;

  select coalesce(raw_user_meta_data->>'display_name', split_part(email, '@', 1))
    into v_display_name
  from auth.users
  where id = v_uid;

  insert into public.memberships(household_id, user_id, display_name, role)
  values (v_invite.household_id, v_uid, coalesce(v_display_name, 'משתמש'), 'member');

  update public.invites
  set used = true, used_by = v_uid
  where id = v_invite.id;

  return query select v_invite.household_id, 'member'::text;
end;
$$;

grant execute on function public.accept_household_invite(text) to authenticated;

-- Revoke a pending invite. Only the invite's creator can revoke it, and only
-- while it's still unused.
create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.revoke_invite(uuid) to authenticated;

-- Remove a member from the caller's household. Only an 'owner' can do this,
-- and only within their own household.
create or replace function public.remove_household_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.remove_household_member(uuid) to authenticated;

-- The invite-accept flow no longer needs the client to SELECT invites
-- directly (accept_household_invite looks the code up itself, as
-- SECURITY DEFINER). So it's now safe to scope invites SELECT to just the
-- caller's own household, which is what the "pending invites" list in the
-- sharing tab needs. If a broader/different invites SELECT policy already
-- exists from earlier setup, drop or narrow it manually — this only adds
-- one, it doesn't remove others.
alter table public.invites enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='invites' and policyname='invites_select_own_household'
  ) then
    create policy invites_select_own_household on public.invites
      for select using (
        household_id in (select household_id from public.memberships where user_id = auth.uid())
      );
  end if;
end$$;
