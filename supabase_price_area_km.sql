-- 2026-11-24 (price_area_km): how far a family goes to shop is now 0 to 10
-- km (0: their settlement only), 5 unless they say. Was 5 to 50, 25 by
-- default. A row saved with more than 10 km before this is brought to 10, so
-- the new check holds (the server already counts it as 10). Safe to run more
-- than once.
update public.household_area set max_km = 10 where max_km > 10;
alter table public.household_area drop constraint if exists household_area_max_km_check;
alter table public.household_area add constraint household_area_max_km_check check (max_km between 0 and 10);
alter table public.household_area alter column max_km set default 5;
