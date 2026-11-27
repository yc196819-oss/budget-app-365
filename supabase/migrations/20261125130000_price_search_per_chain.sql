-- price_search: besides the 40 best matches for each query, the best 2 at
-- every chain that sells a match. Before, a chain whose products were not
-- among the 40 best overall showed as "missing" the product, though it sells
-- one (on 2026-11-25 most chains sold 465-500 of the 500 most common products).
-- Same signature, columns and grants as before.
CREATE OR REPLACE FUNCTION public.price_search(p_queries text[])
 RETURNS TABLE(q integer, barcode text, name text, names text, maker text, qty numeric, unit text, offers jsonb, kosher jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with qs as (
    select i::int as q, array_remove(regexp_split_to_array(lower(regexp_replace(t, '[״"׳''`,.()\-+/\\*]', ' ', 'g')), '\s+'), '') as w
    from unnest(p_queries[1:300]) with ordinality as x(t, i)
  ), mine as (
    select s.* from public.household_stores s where s.household_id = (select h from public.my_households() h limit 1)
  ), keyed as (
    select qs.*, (select x from unnest(qs.w) x order by length(x) desc limit 1) as k from qs where cardinality(qs.w) > 0
  ), matched as (
    select kq.q, kq.w, p.*
    from keyed kq cross join lateral (
      select * from public.price_products p
      where lower(p.names || ' ' || p.name) like '%' || kq.k || '%'
        and lower(p.names || ' ' || p.name) like all (select '%' || x || '%' from unnest(kq.w) x)
    ) p
  ), scored as (
    select m.*,
      (select count(*) from unnest(m.w) x where lower(m.name) ~ ('(^|[^א-ת])[הובלמש]?' || regexp_replace(x, '([\[\]{}?^$|.*+()\\])', '\\\1', 'g') || '($|[^א-ת])')) as whole,
      (lower(m.name) ~ ('^[הובלמש]?' || regexp_replace(m.w[1], '([\[\]{}?^$|.*+()\\])', '\\\1', 'g'))) as starts,
      (select count(*) from public.price_offers o where o.barcode = m.barcode) as sold
    from matched m
  ), hits as (
    select s.*, row_number() over (partition by s.q order by s.whole desc, s.starts desc, s.sold desc, length(s.name)) as rn from scored s
  ), top_chains as (
    -- The chains that sell one of the 40 best matches.
    select distinct h.q, o.chain from hits h join public.price_offers o on o.barcode = h.barcode where h.rn <= 40
  ), per_chain as (
    -- For every other chain, its best 2 matches (of the best 400), so a chain
    -- whose own products are not among the 40 best is still compared.
    select z.q, z.barcode from (
      select h.q, h.barcode, row_number() over (partition by h.q, o.chain order by h.rn) as rc
      from hits h join public.price_offers o on o.barcode = h.barcode
      where h.rn > 40 and h.rn <= 400 and not exists (select 1 from top_chains t where t.q = h.q and t.chain = o.chain)
    ) z where z.rc <= 2
  )
  select h.q, h.barcode, h.name, h.names, h.maker, h.qty, h.unit,
    coalesce((select jsonb_agg(jsonb_build_object('chain', o.chain, 'chain_name', o.chain_name,
        'price', coalesce((select so.price from public.price_store_offers so where so.chain = o.chain and so.store_id = m.store_id and so.barcode = o.barcode), o.price),
        'seen_at', o.seen_at, 'store', m.name, 'local', m.store_id is not null,
        'promos', coalesce((select jsonb_agg(jsonb_build_object('text', pr.text, 'need', pr.need, 'unit_price', pr.unit_price, 'max_qty', pr.max_qty,
              'everyone', pr.everyone, 'club', pr.club, 'coupon', pr.coupon, 'min_buy', pr.min_buy, 'starts_at', pr.starts_at, 'ends_at', pr.ends_at) order by pr.unit_price)
            from (select * from public.price_promos pr
                  where pr.chain = o.chain and pr.barcode = o.barcode and (pr.ends_at is null or pr.ends_at > now())
                    and pr.store_id = (case when m.store_id is not null and exists (select 1 from public.price_promos x where x.chain = o.chain and x.store_id = m.store_id limit 1) then m.store_id else '' end)
                  order by pr.unit_price limit 4) pr), '[]'::jsonb)))
      from public.price_offers o left join mine m on m.chain = o.chain where o.barcode = h.barcode), '[]'::jsonb),
    jsonb_build_object(
      'owner', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.by_owner limit 1),
      'owner_cert', (select v.cert from public.kosher_votes v where v.barcode = h.barcode and v.by_owner limit 1),
      'votes', coalesce((select jsonb_object_agg(level, n) from (select v.level, count(*) n from public.kosher_votes v where v.barcode = h.barcode and not v.by_owner group by v.level) z), '{}'::jsonb),
      'certs', coalesce((select jsonb_object_agg(cert, n) from (select v.cert, count(*) n from public.kosher_votes v where v.barcode = h.barcode and not v.by_owner and v.cert is not null group by v.cert) z), '{}'::jsonb),
      'open', h.kosher_cert,
      'mine', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.household_id in (select public.my_households()) and not v.by_owner limit 1),
      'mine_cert', (select v.cert from public.kosher_votes v where v.barcode = h.barcode and v.household_id in (select public.my_households()) and not v.by_owner limit 1))
  from hits h where h.rn <= 40 or exists (select 1 from per_chain pc where pc.q = h.q and pc.barcode = h.barcode);
$function$
;

revoke all on function public.price_search(p_queries text[]) from public, anon, authenticated;
grant execute on function public.price_search(p_queries text[]) to authenticated;
