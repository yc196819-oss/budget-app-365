-- Credit cards: an optional credit limit, and only ever the last 4 digits.
-- The cards table (supabase_accounts_cards.sql) already has last4,
-- owner_user_id and is_active. Applied. Safe to run again.
--
-- Never stored: the full card number, expiry, CVV or PIN.

alter table public.credit_cards add column if not exists credit_limit integer check (credit_limit is null or credit_limit >= 0);
alter table public.credit_cards drop constraint if exists credit_cards_last4_check;
alter table public.credit_cards add constraint credit_cards_last4_check check (last4 is null or last4 ~ '^[0-9]{4}$');
