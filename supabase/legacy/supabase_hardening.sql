-- Hardening before more users (from Supabase's security and performance
-- advisors). Changes nothing a user can see. Applied, except the owner-only
-- reset below (run it in the SQL editor: the tool asks to confirm statements
-- with DELETE in them). Safe to run again.

-- 1. Functions: a fixed search_path; the destructive ones are not callable
--    without signing in; wiping the whole household is for its owner only.
alter function public.my_households() set search_path = public;
alter function public.request_household_reset_code(uuid, text) set search_path = public;
alter function public.confirm_household_reset(uuid, text, uuid) set search_path = public;
revoke execute on function public.revoke_invite(uuid), public.remove_household_member(uuid),
  public.reset_household_full(), public.reset_household_month(integer, integer), public.touch_conversation() from public, anon;
grant execute on function public.revoke_invite(uuid), public.remove_household_member(uuid),
  public.reset_household_full(), public.reset_household_month(integer, integer) to authenticated, service_role;

create or replace function public.reset_household_full()
returns void language plpgsql security definer set search_path = public as $$
declare v_household uuid; v_role text;
begin
  select household_id, role into v_household, v_role from public.memberships where user_id = auth.uid();
  if v_household is null then raise exception 'Not a member of any household'; end if;
  if v_role is distinct from 'owner' then raise exception 'Only the household owner can delete all data'; end if;
  delete from public.transactions where household_id = v_household;
  delete from public.installments where household_id = v_household;
  delete from public.loans where household_id = v_household;
  delete from public.investments where household_id = v_household;
  delete from public.goals where household_id = v_household;
  delete from public.categories where household_id = v_household;
end $$;

-- 2. An index for every foreign key (household_id first: every query filters on it).
create index if not exists memberships_household_id_idx on memberships (household_id);
create index if not exists categories_household_id_idx on categories (household_id);
create index if not exists categories_parent_id_idx on categories (parent_id);
create index if not exists transactions_household_id_idx on transactions (household_id);
create index if not exists transactions_category_id_idx on transactions (category_id);
create index if not exists transactions_subcategory_id_idx on transactions (subcategory_id);
create index if not exists transactions_account_id_idx on transactions (account_id);
create index if not exists transactions_card_id_idx on transactions (card_id);
create index if not exists loans_household_id_idx on loans (household_id);
create index if not exists installments_household_id_idx on installments (household_id);
create index if not exists installments_category_id_idx on installments (category_id);
create index if not exists investments_household_id_idx on investments (household_id);
create index if not exists goals_household_id_idx on goals (household_id);
create index if not exists invites_household_id_idx on invites (household_id);
create index if not exists invites_created_by_idx on invites (created_by);
create index if not exists invites_used_by_idx on invites (used_by);
create index if not exists credit_cards_bank_account_id_idx on credit_cards (bank_account_id);
create index if not exists categories_default_account_id_idx on categories (default_account_id);
create index if not exists categories_default_card_id_idx on categories (default_card_id);
create index if not exists category_budgets_category_id_idx on category_budgets (category_id);
create index if not exists shared_decisions_category_id_idx on shared_decisions (category_id);
create index if not exists shared_decisions_goal_id_idx on shared_decisions (goal_id);
create index if not exists shared_decisions_transaction_id_idx on shared_decisions (transaction_id);
create index if not exists advisor_tasks_conversation_id_idx on advisor_tasks (conversation_id);
create index if not exists advisor_messages_household_id_idx on advisor_messages (household_id);
create index if not exists agent_actions_household_id_idx on agent_actions (household_id);
create index if not exists agent_actions_message_id_idx on agent_actions (message_id);
create index if not exists investment_trades_household_id_idx on investment_trades (household_id);
create index if not exists investment_trades_investment_id_idx on investment_trades (investment_id);
create index if not exists advisor_memories_source_conversation_id_idx on advisor_memories (source_conversation_id);

-- 3. Row policies: auth.uid() once per query, not once per row (same rules,
--    faster at scale). Applied with ALTER POLICY on the 32 policies the
--    advisor listed, replacing auth.uid() with (select auth.uid()); e.g.:
--    alter policy push_subscriptions_owner_all on public.push_subscriptions
--      using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
