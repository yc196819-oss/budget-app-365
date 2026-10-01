-- "מחליטים ביחד": purchases above an agreed amount are decided together.
-- One card per purchase (shared_decisions), one answer per partner
-- (decision_votes). Every row belongs to a household and is visible only to
-- its members (my_households()); an answer can only be written by the person
-- giving it, and must carry a reason unless it approves.

alter table public.households
  add column if not exists decision_threshold integer not null default 500 check (decision_threshold >= 0),
  add column if not exists personal_allowance integer check (personal_allowance >= 0);

create table if not exists public.shared_decisions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  title text not null check (char_length(title) between 1 and 80),
  amount numeric not null check (amount > 0),
  category_id uuid references public.categories(id) on delete set null,
  wanted_by date,
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'approved', 'not_now', 'talk', 'bought', 'withdrawn')),
  goal_id uuid references public.goals(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  reminded_at timestamptz
);
create index if not exists shared_decisions_household_idx on public.shared_decisions (household_id, created_at desc);

create table if not exists public.decision_votes (
  decision_id uuid not null references public.shared_decisions(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  vote text not null check (vote in ('approve', 'not_now', 'talk')),
  note text check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (decision_id, user_id),
  check (vote = 'approve' or char_length(coalesce(trim(note), '')) > 0)
);
create index if not exists decision_votes_household_idx on public.decision_votes (household_id);

alter table public.shared_decisions enable row level security;
alter table public.decision_votes enable row level security;

create policy shared_decisions_select on public.shared_decisions for select to authenticated
  using (household_id in (select public.my_households()));
create policy shared_decisions_insert on public.shared_decisions for insert to authenticated
  with check (household_id in (select public.my_households()) and created_by = auth.uid());
create policy shared_decisions_update on public.shared_decisions for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
create policy shared_decisions_delete on public.shared_decisions for delete to authenticated
  using (household_id in (select public.my_households()) and created_by = auth.uid());

create policy decision_votes_select on public.decision_votes for select to authenticated
  using (household_id in (select public.my_households()));
create policy decision_votes_write on public.decision_votes for all to authenticated
  using (household_id in (select public.my_households()) and user_id = auth.uid())
  with check (
    household_id in (select public.my_households()) and user_id = auth.uid()
    and exists (select 1 from public.shared_decisions d where d.id = decision_id and d.household_id = decision_votes.household_id)
  );
