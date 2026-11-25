-- price_coverage: how many of the most common products (sold by the most
-- chains) each chain sells. Read once after the night's price load, so a
-- chain whose file loaded but is suddenly missing many products shows on the
-- owner's catalog card. Read-only; for the server only.
create or replace function public.price_coverage(p_top integer default 500)
 returns table(chain text, has integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- (A product has one price per chain, so count(*) counts chains: much
  -- faster than count(distinct) over the whole table.)
  with top as (
    select o.barcode from public.price_offers o group by o.barcode order by count(*) desc, o.barcode limit greatest(1, least(p_top, 2000))
  )
  select o.chain, count(*)::int as has
  from public.price_offers o join top t on t.barcode = o.barcode
  group by o.chain;
$function$;

revoke all on function public.price_coverage(integer) from public, anon, authenticated;
grant execute on function public.price_coverage(integer) to service_role;
