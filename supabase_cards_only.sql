-- 2026-11-12 (cards_only): a bank account whose current-account statement
-- the household does not upload (only its cards'): "complete the picture"
-- neither asks for it nor counts it as missing. Safe to run more than once.
alter table public.bank_accounts add column if not exists cards_only boolean not null default false;
