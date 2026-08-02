-- Full fix for the duplicate-household race-condition bug.
-- Fixes Naomi's account + 3 other real accounts that hit the same bug,
-- then locks the door so it can never happen again.

-- ===== Naomi =====
delete from memberships where user_id = '4f73a3d1-7375-41c2-a5d8-6c443d12bef0';
insert into memberships (household_id, user_id, display_name, role)
values ('4198b313-7ebf-413e-a0ac-a0ae65853d7c', '4f73a3d1-7375-41c2-a5d8-6c443d12bef0', 'נעמי', 'member');
delete from bank_accounts where household_id in ('ec9df809-5ea3-47a1-bc31-9c35d146515d','2a53b6e8-61ce-4437-a081-7333ead82fc6');
delete from credit_cards where household_id in ('ec9df809-5ea3-47a1-bc31-9c35d146515d','2a53b6e8-61ce-4437-a081-7333ead82fc6');
delete from households where id in ('ec9df809-5ea3-47a1-bc31-9c35d146515d','2a53b6e8-61ce-4437-a081-7333ead82fc6');

-- ===== shmuelwal@gmail.com ("דן") — all households empty, keep the oldest =====
delete from memberships where user_id = 'f9ee8fac-102f-49df-8ff8-7bd8cf45d847'
  and household_id <> 'c535f974-893d-4466-b960-8570247baa0c';
delete from bank_accounts where household_id in ('81ff03dc-9508-4a8c-ba45-8ecde977d027','f62e837d-a64a-4771-b701-7655d5103e9f','5fd737bc-3294-4598-b887-6ed23f062dd6','3d762ce6-06c5-40fc-b903-84b0a465830a','a1774e7c-0957-4fc1-a047-8e5b17800f80','416aa38a-65cc-4737-8438-4f3d7936aa77','a729d42c-ab80-49c1-9bb5-0611926d934f','75954681-1327-4c50-94a4-0089e67654c9');
delete from credit_cards where household_id in ('81ff03dc-9508-4a8c-ba45-8ecde977d027','f62e837d-a64a-4771-b701-7655d5103e9f','5fd737bc-3294-4598-b887-6ed23f062dd6','3d762ce6-06c5-40fc-b903-84b0a465830a','a1774e7c-0957-4fc1-a047-8e5b17800f80','416aa38a-65cc-4737-8438-4f3d7936aa77','a729d42c-ab80-49c1-9bb5-0611926d934f','75954681-1327-4c50-94a4-0089e67654c9');
delete from categories where household_id in ('81ff03dc-9508-4a8c-ba45-8ecde977d027','f62e837d-a64a-4771-b701-7655d5103e9f','5fd737bc-3294-4598-b887-6ed23f062dd6','3d762ce6-06c5-40fc-b903-84b0a465830a','a1774e7c-0957-4fc1-a047-8e5b17800f80','416aa38a-65cc-4737-8438-4f3d7936aa77','a729d42c-ab80-49c1-9bb5-0611926d934f','75954681-1327-4c50-94a4-0089e67654c9');
delete from households where id in ('81ff03dc-9508-4a8c-ba45-8ecde977d027','f62e837d-a64a-4771-b701-7655d5103e9f','5fd737bc-3294-4598-b887-6ed23f062dd6','3d762ce6-06c5-40fc-b903-84b0a465830a','a1774e7c-0957-4fc1-a047-8e5b17800f80','416aa38a-65cc-4737-8438-4f3d7936aa77','a729d42c-ab80-49c1-9bb5-0611926d934f','75954681-1327-4c50-94a4-0089e67654c9');

-- ===== sx3231351@gmail.com — all households empty, keep the oldest =====
delete from memberships where user_id = 'b35252a0-c5f3-4d77-acef-6781f85a85ba'
  and household_id <> 'd18e4dec-42b7-444c-b2a2-026038e7c073';
delete from bank_accounts where household_id in ('2e0ad47b-4905-470b-9a31-084972732897','936491c3-19b1-4acb-96e5-11973dd4d307','f25c61df-5aa4-480c-b94d-dee0946f107c','3663dece-5f71-4539-b623-2f21a76082b6','6b3e2a68-e200-47e0-998d-6f861c4aae19','11a01c9b-6a6f-4821-8e0e-56f6f1846e10','dd06191a-fdad-443b-91e3-2780a794a451');
delete from credit_cards where household_id in ('2e0ad47b-4905-470b-9a31-084972732897','936491c3-19b1-4acb-96e5-11973dd4d307','f25c61df-5aa4-480c-b94d-dee0946f107c','3663dece-5f71-4539-b623-2f21a76082b6','6b3e2a68-e200-47e0-998d-6f861c4aae19','11a01c9b-6a6f-4821-8e0e-56f6f1846e10','dd06191a-fdad-443b-91e3-2780a794a451');
delete from categories where household_id in ('2e0ad47b-4905-470b-9a31-084972732897','936491c3-19b1-4acb-96e5-11973dd4d307','f25c61df-5aa4-480c-b94d-dee0946f107c','3663dece-5f71-4539-b623-2f21a76082b6','6b3e2a68-e200-47e0-998d-6f861c4aae19','11a01c9b-6a6f-4821-8e0e-56f6f1846e10','dd06191a-fdad-443b-91e3-2780a794a451');
delete from households where id in ('2e0ad47b-4905-470b-9a31-084972732897','936491c3-19b1-4acb-96e5-11973dd4d307','f25c61df-5aa4-480c-b94d-dee0946f107c','3663dece-5f71-4539-b623-2f21a76082b6','6b3e2a68-e200-47e0-998d-6f861c4aae19','11a01c9b-6a6f-4821-8e0e-56f6f1846e10','dd06191a-fdad-443b-91e3-2780a794a451');

-- ===== kobi.grinboim@mail.huji.ac.il — has 1 real transaction, keep THAT household (not the oldest) =====
delete from memberships where user_id = 'b17c9d73-4c45-4376-b85e-5fffbf727f14'
  and household_id <> 'b8afc93a-b8eb-4760-aefc-3e7e5230f3d4';
delete from bank_accounts where household_id in ('132930ae-b075-40b8-88e5-6b76a94363b2','f4d62eca-4719-40f7-a80f-137689a1c3bf','71bc4707-9012-4d8d-9376-7423300ddcb9','d6763fb8-3d4e-4ac8-b2ca-b0e31b5cfacd','ae4244ee-b24b-42c9-9eb4-14d2ec2bc1da','d12c7d37-8a8b-47ef-9c2c-ea63a1a3714b','51c685ed-a76e-4a7c-9699-e8a58d7760fb','597cf74f-88a3-4c0c-8745-6c3aeb087211','7826533f-baed-4196-a022-5c0c9fbff0f7','6bdaa941-d70a-494c-b453-9d55b594d9b5','a1d482e5-67d3-4187-abe6-65b491c55056','fc00085a-393e-4339-8466-1dc17d875532');
delete from credit_cards where household_id in ('132930ae-b075-40b8-88e5-6b76a94363b2','f4d62eca-4719-40f7-a80f-137689a1c3bf','71bc4707-9012-4d8d-9376-7423300ddcb9','d6763fb8-3d4e-4ac8-b2ca-b0e31b5cfacd','ae4244ee-b24b-42c9-9eb4-14d2ec2bc1da','d12c7d37-8a8b-47ef-9c2c-ea63a1a3714b','51c685ed-a76e-4a7c-9699-e8a58d7760fb','597cf74f-88a3-4c0c-8745-6c3aeb087211','7826533f-baed-4196-a022-5c0c9fbff0f7','6bdaa941-d70a-494c-b453-9d55b594d9b5','a1d482e5-67d3-4187-abe6-65b491c55056','fc00085a-393e-4339-8466-1dc17d875532');
delete from categories where household_id in ('132930ae-b075-40b8-88e5-6b76a94363b2','f4d62eca-4719-40f7-a80f-137689a1c3bf','71bc4707-9012-4d8d-9376-7423300ddcb9','d6763fb8-3d4e-4ac8-b2ca-b0e31b5cfacd','ae4244ee-b24b-42c9-9eb4-14d2ec2bc1da','d12c7d37-8a8b-47ef-9c2c-ea63a1a3714b','51c685ed-a76e-4a7c-9699-e8a58d7760fb','597cf74f-88a3-4c0c-8745-6c3aeb087211','7826533f-baed-4196-a022-5c0c9fbff0f7','6bdaa941-d70a-494c-b453-9d55b594d9b5','a1d482e5-67d3-4187-abe6-65b491c55056','fc00085a-393e-4339-8466-1dc17d875532');
delete from households where id in ('132930ae-b075-40b8-88e5-6b76a94363b2','f4d62eca-4719-40f7-a80f-137689a1c3bf','71bc4707-9012-4d8d-9376-7423300ddcb9','d6763fb8-3d4e-4ac8-b2ca-b0e31b5cfacd','ae4244ee-b24b-42c9-9eb4-14d2ec2bc1da','d12c7d37-8a8b-47ef-9c2c-ea63a1a3714b','51c685ed-a76e-4a7c-9699-e8a58d7760fb','597cf74f-88a3-4c0c-8745-6c3aeb087211','7826533f-baed-4196-a022-5c0c9fbff0f7','6bdaa941-d70a-494c-b453-9d55b594d9b5','a1d482e5-67d3-4187-abe6-65b491c55056','fc00085a-393e-4339-8466-1dc17d875532');

-- ===== Prevent this from ever happening again =====
alter table memberships add constraint memberships_user_id_key unique (user_id);
