-- Starting over: the household's owner empties its money records in one
-- step, and can bring all of them back from the recycle bin for 30 days.
--
-- 1. The emailed code gets a third purpose, 'reset'.
-- 2. recycle_bin.batch groups the rows one "start over" removed.
-- 3. keep_in_bin() stores the batch set by start_over(); four more tables
--    keep their removed rows (uploaded files, budgets, category rules,
--    investment trades), so a batch comes back whole.
-- 4. start_over(): only the server (service_role) runs it, after it checked
--    the code and that the caller opened the household. Once a day.
-- 5. restore_batch() and bin_batches(): for the household's members.
-- Nothing here changes or removes existing rows.

alter table public.mfa_email_codes drop constraint if exists mfa_email_codes_purpose_check;
alter table public.mfa_email_codes add constraint mfa_email_codes_purpose_check
  check (purpose = any (array['login'::text, 'enable'::text, 'reset'::text]));

alter table public.recycle_bin add column if not exists batch uuid;
create index if not exists recycle_bin_batch_idx on public.recycle_bin (household_id, batch) where batch is not null;

create or replace function public.keep_in_bin()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- A row without a household (old data) is not kept; removing it never fails here.
  if old.household_id is not null then
    begin
      insert into public.recycle_bin (household_id, tbl, row_id, data, removed_by, batch)
      values (old.household_id, tg_table_name, old.id, to_jsonb(old), auth.uid(),
              nullif(current_setting('app.bin_batch', true), '')::uuid);
    exception when others then
      raise warning 'recycle bin: %', sqlerrm;
    end;
  end if;
  return old;
end $function$;

drop trigger if exists keep_in_bin on public.imports;
create trigger keep_in_bin before delete on public.imports for each row execute function keep_in_bin();
drop trigger if exists keep_in_bin on public.category_budgets;
create trigger keep_in_bin before delete on public.category_budgets for each row execute function keep_in_bin();
drop trigger if exists keep_in_bin on public.category_rules;
create trigger keep_in_bin before delete on public.category_rules for each row execute function keep_in_bin();
drop trigger if exists keep_in_bin on public.investment_trades;
create trigger keep_in_bin before delete on public.investment_trades for each row execute function keep_in_bin();

-- The order matters: rows that point at others go first.
create or replace function public.start_over(p_household uuid, p_batch uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  if p_household is null or p_batch is null then raise exception 'START_OVER_ARGS'; end if;
  if exists (select 1 from public.recycle_bin b where b.household_id = p_household and b.batch is not null
             and b.removed_at > now() - interval '1 day') then
    raise exception 'START_OVER_ONCE_A_DAY';
  end if;
  perform set_config('app.bin_batch', p_batch::text, true);
  delete from public.transactions where household_id = p_household;
  delete from public.card_pending where household_id = p_household;
  delete from public.category_budgets where household_id = p_household;
  delete from public.category_rules where household_id = p_household;
  delete from public.investment_trades where household_id = p_household;
  delete from public.investments where household_id = p_household;
  delete from public.installments where household_id = p_household;
  delete from public.loans where household_id = p_household;
  delete from public.goals where household_id = p_household;
  delete from public.trips where household_id = p_household;
  delete from public.imports where household_id = p_household;
  delete from public.categories where household_id = p_household and parent_id is not null;
  delete from public.categories where household_id = p_household;
  delete from public.credit_cards where household_id = p_household;
  delete from public.bank_accounts where household_id = p_household;
  perform set_config('app.bin_batch', '', true);
  select count(*) into n from public.recycle_bin where household_id = p_household and batch = p_batch;
  return n;
end $function$;

-- Back in the order they depend on each other; a row that is already there stays.
create or replace function public.restore_batch(p_batch uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare h uuid; t text; n integer := 0; k integer;
begin
  select household_id into h from public.recycle_bin where batch = p_batch limit 1;
  if h is null or h not in (select public.my_households()) then raise exception 'not found'; end if;
  foreach t in array array['bank_accounts', 'credit_cards', 'categories', 'imports', 'goals', 'loans', 'installments',
                           'investments', 'investment_trades', 'trips', 'category_budgets', 'category_rules', 'transactions'] loop
    execute format(
      'with r as (select b.id, b.data from public.recycle_bin b where b.batch = $1 and b.tbl = %L and b.restored_at is null
                  order by (b.data->>''parent_id'') is not null),
            ins as (insert into public.%I select (jsonb_populate_record(null::public.%I, r.data)).* from r on conflict do nothing returning 1)
       select count(*) from ins', t, t, t) using p_batch into k;
    n := n + k;
  end loop;
  update public.recycle_bin set restored_at = now() where batch = p_batch and restored_at is null;
  return n;
end $function$;

create or replace function public.bin_batches(p_household uuid)
 returns table(batch uuid, n bigint, removed_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select b.batch, count(*), min(b.removed_at)
  from public.recycle_bin b
  where b.household_id = p_household and p_household in (select public.my_households())
    and b.batch is not null and b.restored_at is null and b.removed_at > now() - interval '30 days'
  group by b.batch order by 3 desc
$function$;

revoke all on function public.start_over(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_batch(uuid) from public, anon, authenticated;
grant execute on function public.restore_batch(uuid) to authenticated;
revoke all on function public.bin_batches(uuid) from public, anon, authenticated;
grant execute on function public.bin_batches(uuid) to authenticated;
