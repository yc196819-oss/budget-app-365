-- price_kashrut_todo: the most common products (sold by the most chains)
-- whose kashrut is not known yet and that were not looked up in Open Food
-- Facts yet, for the owner's one-time kashrut lookup. Read-only; for the
-- server only.
create or replace function public.price_kashrut_todo(p_limit integer default 600)
 returns table(barcode text, name text, chains integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with top as (
    select o.barcode, count(*)::int as chains
    from public.price_offers o
    group by o.barcode
    order by count(*) desc, o.barcode
    limit 20000
  )
  select p.barcode, p.name, t.chains
  from top t
  join public.price_products p on p.barcode = t.barcode
  where p.kosher_cert is null
    and p.image_checked_at is null
    and not exists (select 1 from public.kosher_votes v where v.barcode = p.barcode and v.by_owner)
  order by t.chains desc, p.barcode
  limit greatest(1, least(p_limit, 2000));
$function$;

revoke all on function public.price_kashrut_todo(integer) from public, anon, authenticated;
grant execute on function public.price_kashrut_todo(integer) to service_role;
