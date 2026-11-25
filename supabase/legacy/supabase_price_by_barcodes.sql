-- Prices by barcode, for checking a receipt: the products whose barcodes
-- were printed on it, with every chain's price and the deals on now (as in
-- price_search: the family's own branch when it chose one). Read only.
create or replace function public.price_by_barcodes(p_barcodes text[])
returns table(barcode text, name text, names text, maker text, qty numeric, unit text, offers jsonb)
language sql stable security definer set search_path = public as $$
  with codes as (
    select distinct b from unnest(p_barcodes[1:200]) b where b ~ '^\d{4,14}$'
  ), mine as (
    select s.* from public.household_stores s where s.household_id = (select h from public.my_households() h limit 1)
  )
  select p.barcode, p.name, p.names, p.maker, p.qty, p.unit,
    coalesce((select jsonb_agg(jsonb_build_object('chain', o.chain, 'chain_name', o.chain_name,
        'price', coalesce((select so.price from public.price_store_offers so where so.chain = o.chain and so.store_id = m.store_id and so.barcode = o.barcode), o.price),
        'seen_at', o.seen_at, 'store', m.name, 'local', m.store_id is not null,
        'promos', coalesce((select jsonb_agg(jsonb_build_object('text', pr.text, 'need', pr.need, 'unit_price', pr.unit_price, 'max_qty', pr.max_qty,
              'everyone', pr.everyone, 'club', pr.club, 'coupon', pr.coupon, 'min_buy', pr.min_buy, 'starts_at', pr.starts_at, 'ends_at', pr.ends_at) order by pr.unit_price)
            from (select * from public.price_promos pr
                  where pr.chain = o.chain and pr.barcode = o.barcode and (pr.ends_at is null or pr.ends_at > now())
                    and pr.store_id = (case when m.store_id is not null and exists (select 1 from public.price_promos x where x.chain = o.chain and x.store_id = m.store_id limit 1) then m.store_id else '' end)
                  order by pr.unit_price limit 4) pr), '[]'::jsonb)))
      from public.price_offers o left join mine m on m.chain = o.chain where o.barcode = p.barcode), '[]'::jsonb)
  from codes c join public.price_products p on p.barcode = c.b;
$$;
revoke all on function public.price_by_barcodes(text[]) from public, anon;
grant execute on function public.price_by_barcodes(text[]) to authenticated;
