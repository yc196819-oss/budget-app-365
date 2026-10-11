const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan, deleteAccount } = require('../server/account');

test('alone in a household: it is deleted; shared: the person only leaves', () => {
  const members = [
    { household_id: 'h1', user_id: 'u1', role: 'owner' },
    { household_id: 'h2', user_id: 'u1', role: 'owner' },
    { household_id: 'h2', user_id: 'u2', role: 'member' },
    { household_id: 'h3', user_id: 'u1', role: 'member' },
    { household_id: 'h3', user_id: 'u3', role: 'owner' }
  ];
  assert.deepEqual(plan('u1', members), { remove: ['h1'], leave: [{ hid: 'h2', newOwner: 'u2' }, { hid: 'h3', newOwner: null }] });
  assert.deepEqual(plan('u9', members), { remove: [], leave: [] });
});

// A stand-in for the Supabase client that records each call in order.
function fakeAdmin(memberships, { failOn } = {}) {
  const calls = [];
  const q = (table) => {
    const c = { table, op: 'select', filters: [] };
    const api = {
      select() { return api; },
      delete() { c.op = 'delete'; return api; },
      update(v) { c.op = 'update'; c.value = v; return api; },
      eq(k, v) { c.filters.push([k, v]); return api; },
      in(k, v) { c.filters.push([k, v]); return api; },
      is(k, v) { c.filters.push([k, v]); return api; },
      then(res) {
        calls.push(c);
        if (failOn === table) return res({ error: { message: 'boom' } });
        if (table === 'memberships' && c.op === 'select') {
          const [k, v] = c.filters[0];
          return res({ data: memberships.filter((m) => (Array.isArray(v) ? v.includes(m[k]) : m[k] === v)) });
        }
        return res({ data: [] });
      }
    };
    return api;
  };
  return { calls, from: q, auth: { admin: { deleteUser: async (id) => { calls.push({ table: 'auth', op: 'deleteUser', id }); return {}; } } } };
}

test('deleting: transactions and categories, then cards and accounts, the household, and the login last', async () => {
  const admin = fakeAdmin([{ household_id: 'h1', user_id: 'u1', role: 'owner' }]);
  await deleteAccount(admin, 'u1');
  const order = admin.calls.filter((c) => c.op !== 'select').map((c) => c.op + ':' + c.table);
  const at = (x) => { const i = order.indexOf(x); assert.ok(i >= 0, x); return i; };
  assert.ok(at('delete:transactions') < at('delete:credit_cards') && at('delete:categories') < at('delete:credit_cards'), 'nothing points at a card when it goes');
  assert.ok(at('delete:credit_cards') < at('delete:bank_accounts'));
  assert.ok(at('delete:bank_accounts') < at('delete:households'), 'the household goes last, so a retry finds what is left');
  assert.equal(order.at(-1), 'deleteUser:auth', 'the login goes last');
  assert.ok(order.includes('update:invites'));
});

test('leaving a shared household keeps it and hands it over', async () => {
  const admin = fakeAdmin([{ household_id: 'h2', user_id: 'u1', role: 'owner' }, { household_id: 'h2', user_id: 'u2', role: 'member' }]);
  await deleteAccount(admin, 'u1');
  assert.equal(admin.calls.some((c) => c.table === 'households'), false, 'the partner keeps the household');
  const left = admin.calls.find((c) => c.table === 'memberships' && c.op === 'delete');
  assert.deepEqual(left.filters, [['household_id', 'h2'], ['user_id', 'u1']]);
  const owner = admin.calls.find((c) => c.table === 'memberships' && c.op === 'update');
  assert.deepEqual([owner.value, owner.filters], [{ role: 'owner' }, [['household_id', 'h2'], ['user_id', 'u2']]]);
});

test('a failed step stops before the login is deleted', async () => {
  const admin = fakeAdmin([{ household_id: 'h1', user_id: 'u1', role: 'owner' }], { failOn: 'credit_cards' });
  await assert.rejects(deleteAccount(admin, 'u1'), /credit_cards/);
  assert.equal(admin.calls.some((c) => c.op === 'deleteUser'), false);
  assert.equal(admin.calls.some((c) => c.table === 'households'), false, 'the household stays for a retry');
});

const { assetLinks, PACKAGE } = require('../server/twa');

test('Google Play asset links: the package and the signing fingerprints; nothing until a key is set', () => {
  const fp = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0')).join(':');
  const links = assetLinks(undefined, fp + ', not-a-key');
  assert.equal(links[0].target.package_name, PACKAGE);
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [fp.toUpperCase()]);
  assert.deepEqual(links[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(assetLinks('com.x', ''), null);
  assert.equal(assetLinks('com.x', 'AB:CD'), null);
  assert.equal(assetLinks(' com.x ', fp)[0].target.package_name, 'com.x');
});
