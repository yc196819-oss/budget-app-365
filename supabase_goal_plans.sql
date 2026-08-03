-- Adds structured planning fields to goals: a list of budget line items
-- (e.g. "כרטיסי טיסה: 5000") and a free-text notes field.
alter table goals add column if not exists plan_items jsonb not null default '[]'::jsonb;
alter table goals add column if not exists notes text;
