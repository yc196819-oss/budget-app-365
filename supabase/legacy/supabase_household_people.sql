-- Applied 2026-11-08 (household_people): how many people live at home, for
-- "per person" amounts in the goals tab. Optional; members may update it.
alter table public.households add column if not exists people smallint check (people between 1 and 20);
