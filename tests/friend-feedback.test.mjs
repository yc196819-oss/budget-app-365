import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGeneric, sameMerchant, guessCategory } from '../public/app/src/domain/money.js';
import { categorizeByWords } from '../public/app/src/domain/statement.js';
import { looseGroups, looseTxs } from '../public/app/src/domain/guide.js';
import { shouldAskRule } from '../public/app/src/domain/rules.js';
import { chainQuery } from '../public/app/src/domain/spend.js';

// A friend's first upload (made-up lines of the same kind): card statements
// only, many Bit payments, an investment platform.
test('a Bit payment or a transfer is never "the same merchant" as another', () => {
  for (const d of ['BIT', 'ביט', 'העברה ב BIT בנה"פ', 'BIT העברה', 'PAYBOX', 'העברה']) assert.equal(isGeneric(d), true, d);
  for (const d of ['ארומה תל אביב', 'ביטוח ישיר', 'שופרסל דיל']) assert.equal(isGeneric(d), false, d);
  assert.equal(sameMerchant('BIT', 'BIT'), false);
  assert.equal(sameMerchant('ארומה', 'ארומה תל אביב'), true, 'shops as before');
  // A past Bit payment's category is not given to the next one.
  assert.equal(guessCategory('BIT', [{ description: 'BIT', category_id: 'food', tx_date: '2026-10-01' }]), null);
  // No "always" rule, and no "every purchase at bit".
  assert.equal(shouldAskRule([], { type: 'expense', description: 'BIT' }, 'food', null), false);
  assert.equal(chainQuery('BIT'), '');
});

test('the sorting sheet: each Bit payment on its own line, a year back', () => {
  const today = new Date('2026-11-15T10:00:00Z');
  const txs = [
    ...[1, 2, 3].map((i) => ({ id: 'b' + i, type: 'expense', amount: 40 * i, description: 'BIT', tx_date: '2026-0' + (i + 1) + '-10' })),
    { id: 's1', type: 'expense', amount: 90, description: 'חנות בדויה', tx_date: '2026-10-01' },
    { id: 's2', type: 'expense', amount: 60, description: 'חנות בדויה', tx_date: '2026-09-01' }
  ];
  const loose = looseTxs(txs, today);
  assert.equal(loose.length, 5, 'lines from February are still there to sort');
  const g = looseGroups(loose);
  assert.equal(g.length, 4, 'three Bit payments and one shop');
  assert.ok(g.filter((x) => x.generic).every((x) => x.ids.length === 1 && x.date));
});

test('an investment platform goes to the household\'s "השקעות" by its words', () => {
  const cats = [{ id: 'inv', name: 'השקעות', kind: 'expense' }, { id: 'food', name: 'אוכל', kind: 'expense' }];
  const out = categorizeByWords([
    { description: 'פלטפורמה בדויה להשקעות בשוק ההון', type: 'expense' },
    { description: 'קרן נאמנות בדויה', type: 'expense' },
    { description: 'BIT', type: 'expense' },
    { description: 'מניות בדויות', type: 'expense', category_id: 'food' }
  ], cats);
  assert.deepEqual(out.map((t) => t.category_id), ['inv', 'inv', undefined, 'food']);
  assert.deepEqual(categorizeByWords([{ description: 'קרן נאמנות', type: 'expense' }], [{ id: 'food', name: 'אוכל' }])[0].category_id, undefined, 'no such category: nothing');
});
