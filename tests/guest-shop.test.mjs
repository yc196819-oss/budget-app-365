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
  assert.deepEqual(g.forOwner(row), { id: 'i', label: 'רינה', created_at: 'c', revoked: false, last_used_at: null, uses: 3 });
});
