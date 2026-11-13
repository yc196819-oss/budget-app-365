-- price_search, ranked: a product whose name has each typed word as a word
-- (after one Hebrew prefix letter at most: "סוכר", not "סוכריות") first,
-- then a name that starts with the first typed word, then the products most
-- chains sell, then shorter names. The 40-per-item limit comes after the
-- ranking, so plain basics are never cut. ALREADY APPLIED (2026-11-13).
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
  ), matched as (
    select qs.q, qs.w, p.*
    from qs join public.price_products p
      on cardinality(qs.w) > 0
     and lower(p.names || ' ' || p.name) like all (select '%' || x || '%' from unnest(qs.w) x)
  ), scored as (
    select m.*,
      -- every typed word stands as a word (after one Hebrew prefix letter at most): "סוכר", not "סוכריות"
      (select count(*) from unnest(m.w) x where lower(m.name) ~ ('(^|[^א-ת])[הובלמש]?' || regexp_replace(x, '([\[\]{}?^$|.*+()\\])', '\\\1', 'g') || '($|[^א-ת])')) as whole,
      -- the name starts with the first typed word: "חלב 3%" is milk, not chocolate milk
      (lower(m.name) ~ ('^[הובלמש]?' || regexp_replace(m.w[1], '([\[\]{}?^$|.*+()\\])', '\\\1', 'g'))) as starts,
      (select count(*) from public.price_offers o where o.barcode = m.barcode) as sold
    from matched m
  ), hits as (
    select s.*, row_number() over (partition by s.q order by s.whole desc, s.starts desc, s.sold desc, length(s.name)) as rn from scored s
  )
  select h.q, h.barcode, h.name, h.names, h.maker, h.qty, h.unit,
    coalesce((select jsonb_agg(jsonb_build_object('chain', o.chain, 'chain_name', o.chain_name,
        'price', coalesce((select so.price from public.price_store_offers so where so.chain = o.chain and so.store_id = m.store_id and so.barcode = o.barcode), o.price),
        'seen_at', o.seen_at, 'store', m.name, 'local', m.store_id is not null))
      from public.price_offers o left join mine m on m.chain = o.chain where o.barcode = h.barcode), '[]'::jsonb),
    jsonb_build_object(
      'owner', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.by_owner limit 1),
      'owner_cert', (select v.cert from public.kosher_votes v where v.barcode = h.barcode and v.by_owner limit 1),
      'votes', coalesce((select jsonb_object_agg(level, n) from (select v.level, count(*) n from public.kosher_votes v where v.barcode = h.barcode and not v.by_owner group by v.level) z), '{}'::jsonb),
      'certs', coalesce((select jsonb_object_agg(cert, n) from (select v.cert, count(*) n from public.kosher_votes v where v.barcode = h.barcode and not v.by_owner and v.cert is not null group by v.cert) z), '{}'::jsonb),
      'open', h.kosher_cert,
      'mine', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.household_id in (select public.my_households()) and not v.by_owner limit 1),
      'mine_cert', (select v.cert from public.kosher_votes v where v.barcode = h.barcode and v.household_id in (select public.my_households()) and not v.by_owner limit 1))
  from hits h where h.rn <= 40;
$function$;
