-- 2026-11-24 (price_geo): real distances. Each branch gets its point on the
-- map, from its street address (OpenStreetMap, done by the server, one
-- address a second; only branch addresses are sent, nothing of a family's).
-- A family may give its location from the phone: it is kept only rounded to
-- 0.005 degrees (about 500 m), never the exact spot. Safe to run more than once.
alter table public.price_stores add column if not exists lat double precision;
alter table public.price_stores add column if not exists lon double precision;
-- The address the point was found for (a new address is looked up again),
-- and when we last tried (a branch not found is tried again after 30 days).
alter table public.price_stores add column if not exists geo_q text;
alter table public.price_stores add column if not exists geo_at timestamptz;
alter table public.price_stores drop constraint if exists price_stores_geo_check;
alter table public.price_stores add constraint price_stores_geo_check check (
  (lat is null and lon is null) or (lat between 29 and 34 and lon between 34 and 36)
);

-- The branch kept for a family carries its point too (for Waze).
alter table public.household_stores add column if not exists lat double precision;
alter table public.household_stores add column if not exists lon double precision;

alter table public.household_area add column if not exists lat numeric(7,3);
alter table public.household_area add column if not exists lon numeric(7,3);
alter table public.household_area drop constraint if exists household_area_geo_check;
alter table public.household_area add constraint household_area_geo_check check (
  (lat is null and lon is null)
  or (lat between 29 and 34 and lon between 34 and 36
      and lat * 200 = round(lat * 200) and lon * 200 = round(lon * 200))
);
