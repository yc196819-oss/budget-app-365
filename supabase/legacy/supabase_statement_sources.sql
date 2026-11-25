-- "Complete the picture": which bank or card company each account and card
-- is with, the day the salary comes in, and which account or card each
-- uploaded file belongs to. Applied. Safe to run again.
alter table public.bank_accounts add column if not exists provider text check (provider is null or provider ~ '^[a-z]{2,20}$');
alter table public.bank_accounts add column if not exists salary_day smallint check (salary_day is null or salary_day between 1 and 31);
alter table public.credit_cards add column if not exists provider text check (provider is null or provider ~ '^[a-z]{2,20}$');
alter table public.imports add column if not exists source_kind text check (source_kind is null or source_kind in ('bank', 'card'));
alter table public.imports add column if not exists source_id uuid;
create index if not exists imports_source on public.imports (household_id, source_id);
