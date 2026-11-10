-- Supermarket prices: our own catalog of products (by barcode) and their
-- prices at each chain, filled by the server from the price service, so a
-- search is matched here at once instead of asking the service every time.
-- Kashrut levels come from families who confirmed a product (one vote per
-- household) and from the owner. Applied. Safe to run again.

create table if not exists public.price_products (
  barcode text primary key check (barcode ~ '^[0-9]{4,20}$'),
  name text not null,
  names text not null default '',          -- every name seen at any chain, for search
  maker text,
  qty numeric,
  unit text,
  seen_at timestamptz not null default now()
);
create table if not exists public.price_offers (
  barcode text not null references public.price_products(barcode) on delete cascade,
  chain text not null,
  chain_name text,
  price numeric not null check (price > 0 and price < 100000),
  seen_at timestamptz not null default now(),
  primary key (barcode, chain)
);
create table if not exists public.kosher_votes (
  barcode text not null references public.price_products(barcode) on delete cascade,
  household_id uuid not null,
  level text not null check (level in ('none', 'regular', 'mehadrin')),
  by_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (barcode, household_id)
);
create table if not exists public.price_prefs (
  household_id uuid primary key,
  kosher text not null default 'any' check (kosher in ('any', 'regular', 'mehadrin')),
  updated_at timestamptz not null default now()
);
-- Which product a household picked for a line on its list.
alter table public.shopping_items add column if not exists barcode text;

alter table public.price_products enable row level security;
alter table public.price_offers enable row level security;
alter table public.kosher_votes enable row level security;
alter table public.price_prefs enable row level security;

-- The catalog and prices are public information: anyone signed in reads
-- them; only the server writes them.
drop policy if exists price_products_read on public.price_products;
create policy price_products_read on public.price_products for select to authenticated using (true);
drop policy if exists price_offers_read on public.price_offers;
create policy price_offers_read on public.price_offers for select to authenticated using (true);

-- A household's own vote and preference: theirs to read and change. Other
-- households' votes are seen only as totals (price_search below).
drop policy if exists kosher_votes_own on public.kosher_votes;
create policy kosher_votes_own on public.kosher_votes for all to authenticated
  using (household_id in (select public.my_households()) and not by_owner)
  with check (household_id in (select public.my_households()) and not by_owner);
drop policy if exists price_prefs_own on public.price_prefs;
create policy price_prefs_own on public.price_prefs for all to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));

create index if not exists price_offers_seen on public.price_offers (seen_at);

-- For each typed item, the products whose names hold every typed word, with
-- their prices and the kashrut totals. Up to 40 per item, 300 items a call.
create or replace function public.price_search(p_queries text[])
returns table (q int, barcode text, name text, names text, maker text, qty numeric, unit text, offers jsonb, kosher jsonb)
language sql stable security definer set search_path = public as $$
  with qs as (
    select i::int as q, array_remove(regexp_split_to_array(lower(regexp_replace(t, '[״"׳''`,.()\-+/\\*]', ' ', 'g')), '\s+'), '') as w
    from unnest(p_queries[1:300]) with ordinality as x(t, i)
  ), hits as (
    select qs.q, p.*, row_number() over (partition by qs.q order by length(p.name)) as rn
    from qs join public.price_products p
      on cardinality(qs.w) > 0
     and lower(p.names || ' ' || p.name) like all (select '%' || x || '%' from unnest(qs.w) x)
  )
  select h.q, h.barcode, h.name, h.names, h.maker, h.qty, h.unit,
    coalesce((select jsonb_agg(jsonb_build_object('chain', o.chain, 'chain_name', o.chain_name, 'price', o.price, 'seen_at', o.seen_at)) from public.price_offers o where o.barcode = h.barcode), '[]'::jsonb),
    jsonb_build_object(
      'owner', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.by_owner limit 1),
      'votes', coalesce((select jsonb_object_agg(level, n) from (select v.level, count(*) n from public.kosher_votes v where v.barcode = h.barcode and not v.by_owner group by v.level) z), '{}'::jsonb),
      'mine', (select v.level from public.kosher_votes v where v.barcode = h.barcode and v.household_id in (select public.my_households()) and not v.by_owner limit 1))
  from hits h where h.rn <= 40;
$$;
revoke all on function public.price_search(text[]) from public, anon;
grant execute on function public.price_search(text[]) to authenticated;

-- What families looked for and our catalog did not have yet: the owner's
-- next load picks these up (families never wait for the price service).
create table if not exists public.price_wanted (
  query text primary key,
  asked integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
alter table public.price_wanted enable row level security;
-- No policies: only the server (service role) reads and writes it.
