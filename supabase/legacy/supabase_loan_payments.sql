-- Loans and debts paid back month by month (applied 2026-11-15).
-- monthly_amount: each payment; first_payment: the day of the first one.
-- The app works out from them how much is left, how many payments remain,
-- and what is due each month (a debt owed to the family: expected income).
alter table public.loans add column if not exists monthly_amount numeric;
alter table public.loans add column if not exists first_payment date;
alter table public.loans drop constraint if exists loans_monthly_amount_check;
alter table public.loans add constraint loans_monthly_amount_check check (monthly_amount is null or monthly_amount > 0);
