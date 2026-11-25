-- "ביחד" as a real conversation: a card stays open until the couple decides
-- (into the plan, or not to buy), with what they agreed; read receipts per
-- partner; and live updates (realtime) for the messages, the answers and the
-- cards. Applied. Safe to run again.

-- 'planned': agreed and in the plan (stays on the screen until bought).
-- 'declined': decided together not to buy (history).
alter table public.shared_decisions drop constraint if exists shared_decisions_status_check;
alter table public.shared_decisions add constraint shared_decisions_status_check
  check (status in ('open', 'approved', 'not_now', 'talk', 'planned', 'bought', 'withdrawn', 'declined'));
alter table public.shared_decisions add column if not exists summary text check (char_length(summary) <= 1000);
alter table public.shared_decisions add column if not exists concluded_by uuid;

-- When each partner last read each card's conversation (the ✓✓).
create table if not exists public.decision_reads (
  decision_id uuid not null references public.shared_decisions(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  seen_at timestamptz not null default now(),
  primary key (decision_id, user_id)
);
create index if not exists decision_reads_household_idx on public.decision_reads (household_id);
alter table public.decision_reads enable row level security;
drop policy if exists decision_reads_select on public.decision_reads;
create policy decision_reads_select on public.decision_reads for select to authenticated
  using (household_id in (select public.my_households()));
drop policy if exists decision_reads_write on public.decision_reads;
create policy decision_reads_write on public.decision_reads for all to authenticated
  using (household_id in (select public.my_households()) and user_id = auth.uid())
  with check (
    household_id in (select public.my_households()) and user_id = auth.uid()
    and exists (select 1 from public.shared_decisions d where d.id = decision_id and d.household_id = decision_reads.household_id)
  );

-- Live updates: the rows reach the other phone as they are written (RLS applies).
do $$
declare t text;
begin
  foreach t in array array['decision_messages', 'decision_reads', 'shared_decisions', 'decision_votes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
