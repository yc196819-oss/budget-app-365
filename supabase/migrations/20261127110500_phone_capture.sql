-- phone_capture: payment notifications sent from the household's own phone
-- (Google Wallet, forwarded by an automation app). For the server only:
-- the app reads and writes these through /api/capture/*, never directly.
--
-- capture_keys: one personal key per person and household. Only the key's
-- sha256 is stored; the key itself is shown once, when it is made.
-- captured_notifications: what arrived, word for word, what was read from
-- it, and (later) the transaction it became.

create table if not exists public.capture_keys (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index if not exists capture_keys_owner on public.capture_keys (household_id, user_id);

create table if not exists public.captured_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  key_id uuid references public.capture_keys(id) on delete set null,
  received_at timestamptz not null default now(),
  app text,
  title text,
  body text,
  fingerprint text not null,
  parsed jsonb,
  status text not null default 'logged' check (status in ('logged', 'created', 'ignored', 'failed')),
  transaction_id uuid references public.transactions(id) on delete set null,
  unique (household_id, fingerprint)
);
create index if not exists captured_notifications_recent on public.captured_notifications (household_id, received_at desc);

alter table public.capture_keys enable row level security;
alter table public.captured_notifications enable row level security;
revoke all on table public.capture_keys from public, anon, authenticated;
revoke all on table public.captured_notifications from public, anon, authenticated;
grant all on table public.capture_keys to service_role;
grant all on table public.captured_notifications to service_role;
