-- Applied 2026-10-01 (already run on the project; kept here as a record).

-- 1. Security: these two functions are not used by the app.
-- request_household_reset_code accepted any household id without checking
-- membership, and the caller can read the code it creates (RLS on
-- household_reset_codes is "own rows"), so confirm_household_reset could
-- wipe another household's data. Blocked from the API; reversible with GRANT.
revoke execute on function public.request_household_reset_code(uuid, text) from public, anon, authenticated;
revoke execute on function public.confirm_household_reset(uuid, text, uuid) from public, anon, authenticated;

-- 2. Learning corner progress per user (lessons done, quiz answers, streak).
-- Additive only; the existing own-row RLS policies on user_settings apply.
alter table public.user_settings add column if not exists learning jsonb;
