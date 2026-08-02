-- Fix for Naomi's account being stuck in orphaned/duplicate households
-- instead of the real shared household.

-- 1. Remove Naomi's 9 duplicate membership rows (created by a race-condition bug
--    in ensureHousehold() when her browser fired multiple concurrent "create household" calls)
delete from memberships where user_id = '4f73a3d1-7375-41c2-a5d8-6c443d12bef0';

-- 2. Add one clean membership into the real shared household
insert into memberships (household_id, user_id, display_name, role)
values ('4198b313-7ebf-413e-a0ac-a0ae65853d7c', '4f73a3d1-7375-41c2-a5d8-6c443d12bef0', 'נעמי', 'member');

-- 3. Clean up the two empty orphaned households that were created by mistake
delete from bank_accounts where household_id in ('ec9df809-5ea3-47a1-bc31-9c35d146515d','2a53b6e8-61ce-4437-a081-7333ead82fc6');
delete from credit_cards where household_id in ('ec9df809-5ea3-47a1-bc31-9c35d146515d','2a53b6e8-61ce-4437-a081-7333ead82fc6');
delete from households where id in ('ec9df809-5ea3-47a1-bc31-9c35d146515d','2a53b6e8-61ce-4437-a081-7333ead82fc6');

-- 4. Prevent this from ever happening again: a user may only belong to one household
alter table memberships add constraint memberships_user_id_key unique (user_id);
