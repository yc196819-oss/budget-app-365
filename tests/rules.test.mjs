import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRule, applyRules, shouldAskRule, ruleKey } from '../public/app/src/domain/rules.js';

const rules = [
  { id: 'r1', type: 'expense', match: ruleKey('שופרסל דיל 123'), category_id: 'super', subcategory_id: null },
  { id: 'r2', type: 'income', match: ruleKey('משכורת חברה'), category_id: 'salary', subcategory_id: null }
];

test('a rule matches the same merchant and kind, and only that', () => {
  assert.equal(findRule(rules, 'expense', 'שופרסל דיל רמת גן').id, 'r1');
  assert.equal(findRule(rules, 'expense', 'שופרסל דיל').id, 'r1');
  assert.equal(findRule(rules, 'income', 'שופרסל דיל'), null, 'an expense rule does not file a refund');
  assert.equal(findRule(rules, 'expense', 'רמי לוי'), null);
  assert.equal(findRule(rules, 'expense', '1234'), null);
});

test('a statement: the rules come first and are marked; other lines are left for history and the AI', () => {
  const items = [
    { key: 'a', type: 'expense', description: 'שופרסל דיל 99', category_id: null },
    { key: 'b', type: 'expense', description: 'פז דלק', category_id: null }
  ];
  const out = applyRules(items, rules);
  assert.deepEqual([out[0].category_id, out[0].auto], ['super', 'rule']);
  assert.equal(out[1].category_id, null);
  assert.equal(applyRules(items, []), items);
});

test('after a change, ask to keep it, unless it already is the rule', () => {
  const tx = { type: 'expense', description: 'שופרסל דיל 99' };
  assert.equal(shouldAskRule(rules, tx, 'super', null), false);
  assert.equal(shouldAskRule(rules, tx, 'home', null), true);
  assert.equal(shouldAskRule([], { type: 'expense', description: 'פז' }, 'car', null), true);
  assert.equal(shouldAskRule([], { type: 'expense', description: '123' }, 'car', null), false);
  assert.equal(shouldAskRule([], tx, null, null), false);
});
