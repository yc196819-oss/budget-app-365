-- Replace the email-code reset flow with password re-confirmation.
-- Run in Supabase SQL Editor. Safe to run multiple times (idempotent).
--
-- Why: the email-code flow depended on a separate backend service
-- (budget-ai) reaching an SMTP/HTTP mail provider, which turned out to be
-- unreliable across Render deployments (blocked ports, duplicate services,
-- missing env vars). These RPCs need nothing but the browser session --
-- the client re-authenticates with sb.auth.signInWithPassword() right
-- before calling either function, which is at least as strong a proof of
-- intent as an emailed code, and has zero external dependencies.

create or replace function public.reset_household_full()
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.reset_household_full() to authenticated;

-- p_month is 1-12 (calendar convention), matching make_date().
create or replace function public.reset_household_month(p_year int, p_month int)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.reset_household_month(int, int) to authenticated;
