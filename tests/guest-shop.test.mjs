import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const g = createRequire(import.meta.url)('../server/guestShop.js');

test('a shopping link: a URL-safe secret, only its fingerprint kept', () => {
  const t = g.newToken();
  assert.equal(g.isToken(t), true);
  assert.notEqual(g.newToken(), t, 'each link its own');
  assert.match(g.hashToken(t), /^[0-9a-f]{64}$/);
  assert.equal(g.hashToken(t), g.hashToken(t));
  for (const bad of ['', 'abc', "x'; drop table", t + 'x', null]) assert.equal(g.isToken(bad), false);
});

test('what a guest sends is cut to size, and the owner never sees the secret', () => {
  assert.deepEqual(g.cleanQueries(['חלב', '', '  לחם ', 5, null]), ['חלב', 'לחם', '5']);
  assert.equal(g.cleanQueries(Array.from({ length: 40 }, (_, i) => 'x' + i)).length, 15);
  assert.equal(g.cleanQueries('חלב').length, 0);
  assert.equal(g.cleanLabel('  <b>רינה</b> '), 'bרינה/b');
  assert.equal(g.cleanLabel(''), 'קישור לקניות');
  const row = { id: 'i', label: 'רינה', token_hash: 'f'.repeat(64), created_at: 'c', revoked_at: null, last_used_at: null, uses: 3 };
  assert.deepEqual(g.forOwner(row), { id: 'i', label: 'רינה', home: false, created_at: 'c', revoked: false, last_used_at: null, uses: 3 });
  assert.equal(g.forOwner({ ...row, household_id: 'h' }).home, true);
});

test('what a partner adds to the home list is cut to size', () => {
  assert.deepEqual(g.cleanItems([{ name: ' חלב ', qty: '2', aisle: 'dairy' }, { name: '' }, { name: 'x', aisle: 'DROP TABLE' }, null]), [{ name: 'חלב', qty: '2', aisle: 'dairy' }, { name: 'x', qty: null, aisle: 'other' }]);
  assert.equal(g.cleanItems(Array.from({ length: 100 }, () => ({ name: 'a' }))).length, 60);
  assert.equal(g.isId('11111111-1111-1111-1111-111111111111'), true);
  assert.equal(g.isId("1' or 1=1"), false);
});
