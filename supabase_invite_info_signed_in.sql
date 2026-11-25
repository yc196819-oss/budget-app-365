-- get_invite_info: only for signed-in people.
-- The invite screen opens only after signing in, so nobody needs it before.
-- Until now anyone with an invite code could read the household's name and
-- the inviter's name without an account. A function is executable by PUBLIC
-- by default, so revoking from anon alone is not enough.
-- Tried on 2026-11-25 in a transaction that was rolled back (anon false,
-- authenticated true), then applied to the database the same night.
begin;
revoke execute on function public.get_invite_info(text) from public, anon;
grant execute on function public.get_invite_info(text) to authenticated;
commit;
