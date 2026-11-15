-- Shopping tab links: the owner shares the shopping tab (with the price
-- comparison and the advisor's list) with one person, by a link, without an
-- account. Only a fingerprint (SHA-256) of each link's secret is kept. Read
-- and written by the server only (no policies: nobody signed in reaches it).
-- Safe to run again.

create table if not exists public.shop_guest_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (char_length(label) between 1 and 60),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  uses integer not null default 0
);
alter table public.shop_guest_links enable row level security;
revoke all on public.shop_guest_links from anon, authenticated;
