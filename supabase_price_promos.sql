-- Deals at the supermarket (the chains' official "PromoFull" files): one row
-- per product and deal at a chain's branch. store_id '' is the branch whose
-- prices are the chain's general prices; a family's nearby branch has its
-- own number. Filled by the server every night; read only through
-- price_search (security definer), so the table has no policies.
-- NOT APPLIED YET. Safe to run again.

create table if not exists public.price_promos (
  chain text not null,
  store_id text not null default '',
  barcode text not null,
  promo_id text not null,
  text text,
  need integer not null default 1 check (need between 1 and 50),
  unit_price numeric not null check (unit_price >= 0 and unit_price < 100000),
  max_qty numeric,
  everyone boolean not null default true,
  club text check (club is null or club in ('club', 'card')),   -- not for everyone: the chain's customers club, or its credit card
  coupon boolean not null default false,
  min_buy numeric not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  seen_at timestamptz not null default now(),
  primary key (chain, store_id, barcode, promo_id)
);
create index if not exists price_promos_barcode on public.price_promos (barcode);
-- The chains whose club (or credit card) the family has: 'rami-levy:club', 'shufersal:card'.
alter table public.price_prefs add column if not exists clubs text[] not null default '{}' check (cardinality(clubs) <= 80);
alter table public.price_promos enable row level security;

-- price_search: as before, and each chain's offer carries its deals
-- (at the family's nearby branch when it has its own, else the chain's).
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
      (select count(*) from unnest(m.w) x where lower(m.name) ~ ('(^|[^א-ת])[הובלמש]?' || regexp_replace(x, '([\[\]{}?^$|.*+()\\])', '\\\1', 'g') || '($|[^א-ת])')) as whole,
      (lower(m.name) ~ ('^[הובלמש]?' || regexp_replace(m.w[1], '([\[\]{}?^$|.*+()\\])', '\\\1', 'g'))) as starts,
      (select count(*) from public.price_offers o where o.barcode = m.barcode) as sold
    from matched m
  ), hits as (
    select s.*, row_number() over (partition by s.q order by s.whole desc, s.starts desc, s.sold desc, length(s.name)) as rn from scored s
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
  from hits h where h.rn <= 40;
$function$;
revoke all on function public.price_search(text[]) from public, anon;
grant execute on function public.price_search(text[]) to authenticated;
