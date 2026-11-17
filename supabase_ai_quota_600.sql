-- The monthly AI quota: 600 a household (was 150 by the column's default,
-- so the 600 in the server never applied), and a failed action given back.
alter table public.households alter column ai_monthly_limit set default 600;
update public.households set ai_monthly_limit = 600 where ai_monthly_limit = 150;

create or replace function public.unbump_ai_usage(p_household uuid, p_month text)
returns integer language sql security definer set search_path = public as $$
  update public.ai_usage set count = greatest(count - 1, 0) where household_id = p_household and month = p_month returning count;
$$;
revoke all on function public.unbump_ai_usage(uuid, text) from public, anon, authenticated;
