-- Web Push subscriptions — lets the server send real push notifications
-- (budget overrun alerts, reminders) to a user's installed PWA, per device
-- (a user can have multiple subscriptions if they installed the app on more
-- than one device/browser).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  household_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='push_subscriptions' and policyname='push_subscriptions_owner_all'
  ) then
    create policy push_subscriptions_owner_all on public.push_subscriptions
      for all using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end$$;
