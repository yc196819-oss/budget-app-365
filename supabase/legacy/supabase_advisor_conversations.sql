-- Saved AI-advisor conversations, scoped per user (not shared across the
-- household) so each person's chat history stays personal.
create table if not exists public.advisor_conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null,
  title text not null default 'שיחה חדשה',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advisor_conversations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='advisor_conversations' and policyname='advisor_conversations_own_rows'
  ) then
    create policy advisor_conversations_own_rows on public.advisor_conversations
      for all using (
        user_id = auth.uid()
        and household_id in (select household_id from public.memberships where user_id = auth.uid())
      )
      with check (
        user_id = auth.uid()
        and household_id in (select household_id from public.memberships where user_id = auth.uid())
      );
  end if;
end$$;
