-- Ma'aser (tithe) tracking: per-user settings (enabled + rate + which
-- income categories are excluded from the calculation) plus a flag on
-- loans so ma'aser obligations show up distinctly from regular debts
-- instead of being mixed in with everything else.

alter table public.user_settings
  add column if not exists maaser jsonb not null default '{"enabled":false,"rate":10,"excludedCategoryIds":[]}'::jsonb;

alter table public.loans
  add column if not exists is_maaser boolean not null default false;
