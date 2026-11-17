import test from 'node:test';
import assert from 'node:assert/strict';
import { wantsFix, candidatesFor, parseFix, undoPatches, ruleOffer, FIX_MARK } from '../public/app/src/domain/advisorFix.js';

const cats = [
  { id: 'gift', name: 'תרומות', kind: 'expense' }, { id: 'inc', name: 'הכנסות', kind: 'income' }, { id: 'grant', name: 'מלגה', kind: 'income', parent_id: 'inc' },
  { id: 'food', name: 'אוכל', kind: 'expense' }, { id: 'super', name: 'סופר', kind: 'expense', parent_id: 'food' }
];
const txs = [
  { id: 't1', type: 'expense', amount: 1000, description: 'מוסד לימודים בדוי', tx_date: '2026-11-10', category_id: 'gift' },
  { id: 't2', type: 'expense', amount: 1000, description: 'מוסד לימודים בדוי', tx_date: '2026-10-10', category_id: 'gift' },
  { id: 't3', type: 'expense', amount: 84, description: 'מכולת בדויה', tx_date: '2026-11-12', category_id: null },
  { id: 't4', type: 'expense', amount: 250, description: 'דלק בדוי', tx_date: '2026-11-03', category_id: null }
];

test('a fix is asked for in words like these; a question about money is not', () => {
  assert.equal(wantsFix('מוסד לימודים בדוי זה לא תרומה, זו מלגה'), true);
  assert.equal(wantsFix('תעביר את המכולת לסופר'), true);
  assert.equal(wantsFix('כמה הוצאתי החודש על אוכל?'), false);
  assert.equal(wantsFix('איך אני חוסך יותר?'), false);
});

test('the transactions sent with the request: the business named, or an amount on a day', () => {
  assert.deepEqual(candidatesFor('מוסד לימודים זה לא תרומה', txs, cats).map((c) => c.id), ['t1', 't2']);
  assert.deepEqual(candidatesFor('ה-84 ב-12/11 זה סופר', txs, cats).map((c) => c.id), ['t3']);
  assert.equal(candidatesFor('תעביר לסופר', txs, cats).length, 0, 'nothing named: nothing sent');
  assert.equal(candidatesFor('מוסד לימודים', txs, cats)[0].category, 'תרומות');
});

test('the advisor\'s changes are checked: an expense to income in an income category, before and after shown', () => {
  const raw = 'אלה שתי תנועות.\n' + FIX_MARK + JSON.stringify({ ops: [
    { op: 'update', id: 't1', set: { type: 'income', category: 'הכנסות', subcategory: 'מלגה' }, reason: 'מלגה' },
    { op: 'update', id: 't2', set: { type: 'income', category: 'הכנסות', subcategory: 'מלגה' } }
  ] }) + '\n@@הצעות: עוד|משהו';
  const r = parseFix(raw, txs, cats);
  assert.equal(r.changes.length, 2);
  assert.deepEqual(r.changes[0].patch, { type: 'income', category_id: 'inc', subcategory_id: 'grant' });
  assert.equal(r.changes[0].before, 'הוצאה · תרומות');
  assert.equal(r.changes[0].after, 'הכנסה · הכנסות · מלגה');
  assert.deepEqual(undoPatches(r.changes)[0], { id: 't1', patch: { type: 'expense', category_id: 'gift', subcategory_id: null } });
  assert.deepEqual(ruleOffer(r.changes), { tx: { ...txs[0], type: 'income' }, category_id: 'inc', subcategory_id: 'grant' });
});

test('dropped: unknown ids, a category that does not exist, an expense put in an income category, deletions, no change', () => {
  const raw = FIX_MARK + JSON.stringify({ ops: [
    { op: 'update', id: 'nope', set: { category: 'אוכל' } },
    { op: 'update', id: 't3', set: { category: 'מסעדות' } },
    { op: 'update', id: 't3', set: { category: 'הכנסות' } },
    { op: 'delete', id: 't4' },
    { op: 'update', id: 't1', set: { category: 'תרומות' } },
    { op: 'update', id: 't3', set: { category: 'אוכל', subcategory: 'סופר' } }
  ] });
  const r = parseFix(raw, txs, cats);
  assert.equal(r.dropped, 5);
  assert.deepEqual(r.changes.map((c) => c.patch), [{ category_id: 'food', subcategory_id: 'super' }]);
  assert.equal(parseFix('בלי שינויים', txs, cats), null);
  assert.equal(parseFix(FIX_MARK + '{לא json', txs, cats), null);
});

test('an amount and a date can be fixed too; a rule is offered only for one business moved to one category', () => {
  const r = parseFix(FIX_MARK + JSON.stringify({ ops: [{ op: 'update', id: 't4', set: { amount: 245.5, tx_date: '2026-11-02' } }] }), txs, cats);
  assert.deepEqual(r.changes[0].patch, { amount: 245.5, tx_date: '2026-11-02' });
  assert.equal(r.changes[0].after, '₪245.5 · 2026-11-02');
  assert.equal(ruleOffer(r.changes), null);
});
