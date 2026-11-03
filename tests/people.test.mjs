import { test } from 'node:test';
import assert from 'node:assert/strict';
import { g, partnerWord, looksLikeUsername, realName, genderOf } from '../public/app/src/domain/people.js';

test('each person in their own form, never "את/ה"', () => {
  assert.equal(g('m', 'ענה', 'ענתה'), 'ענה');
  assert.equal(g('f', 'ענה', 'ענתה'), 'ענתה');
  assert.equal(g(null, 'ענה', 'ענתה'), 'ענה או ענתה');
  assert.equal(partnerWord('m'), 'בן הזוג');
  assert.equal(partnerWord('f'), 'בת הזוג');
  assert.equal(partnerWord(null), 'בן או בת הזוג');
  assert.equal(genderOf({ u1: 'f', u2: 'x' }, 'u1'), 'f');
  assert.equal(genderOf({ u2: 'x' }, 'u2'), null);
});

test('a username or an email is never used as a name', () => {
  for (const n of ['budgetapp2852', 'yossi@example.com', 'kobi.g', '', '  ']) assert.equal(realName(n), '', n);
  for (const n of ['קובי', 'Noa Levi', 'Dani']) assert.equal(realName(n), n.trim(), n);
  assert.equal(looksLikeUsername('נעמי'), false);
});
