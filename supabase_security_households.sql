-- 2026-11-11 (security_households): a person reads only the households they
-- belong to (it was every household: "using (true)"), and the two old
-- "reset" functions, which the app no longer uses, can no longer be called
-- from the app. Run only after the app version that makes a new household's
-- id on the device (it does not read the new household back) is live.
-- Safe to run more than once.
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (id in (select public.my_households()));

revoke execute on function public.reset_household_full() from public, anon, authenticated;
revoke execute on function public.reset_household_month(integer, integer) from public, anon, authenticated;
