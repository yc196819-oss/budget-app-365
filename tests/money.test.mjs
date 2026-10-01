import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthsBack, monthShare, totalsFor, merchantKey, filterTxs, groupByDay, groupByMonth, dayLabel,
  categoryRows, parseQuickAdd, sameMerchant, guessCategory, frequentMerchants, sameMerchantIds, topCategoryId
} from '../public/app/src/domain/money.js';

const SEP = { y: 2026, m: 8 };
const tx = (o) => ({ id: o.id || Math.random().toString(36).slice(2), type: 'expense', amount: 100, tx_date: '2026-09-10', description: 'x', spread: 'month', nature: 'variable', ...o });

test('monthsBack returns n months oldest first, across years', () => {
  const r = monthsBack(new Date(2026, 1, 15), 3);
  assert.deepEqual(r, [{ y: 2025, m: 11 }, { y: 2026, m: 0 }, { y: 2026, m: 1 }]);
});

test('monthShare: a normal expense counts only in its own month', () => {
  const t = tx({ amount: 300, tx_date: '2026-09-02' });
  assert.equal(monthShare(t, SEP), 300);
  assert.equal(monthShare(t, { y: 2026, m: 9 }), 0);
});

test('monthShare: spread=year splits over 12 months starting with its month', () => {
  const t = tx({ amount: 1200, tx_date: '2026-03-05', spread: 'year' });
  assert.equal(monthShare(t, { y: 2026, m: 1 }), 0);
  assert.equal(monthShare(t, { y: 2026, m: 2 }), 100);
  assert.equal(monthShare(t, { y: 2027, m: 1 }), 100);
  assert.equal(monthShare(t, { y: 2027, m: 2 }), 0);
});

test('totalsFor sums expense and income separately', () => {
  const r = totalsFor([tx({ amount: 50 }), tx({ amount: 1000, type: 'income' }), tx({ amount: 30, tx_date: '2026-08-01' })], [SEP]);
  assert.deepEqual(r, { expense: 50, income: 1000, net: 950 });
});

test('merchantKey ignores branch numbers, punctuation and extra words', () => {
  assert.equal(merchantKey('שופרסל דיל 1234 ת"א'), merchantKey('שופרסל דיל'));
  assert.equal(merchantKey('  ARomA  '), 'aroma');
  assert.equal(merchantKey('12345'), '');
});

test('filterTxs by type, fixed and text (including category name)', () => {
  const cats = new Map([['c1', { id: 'c1', name: 'סופר' }]]);
  const list = [tx({ id: 'a', description: 'שופרסל', category_id: 'c1' }), tx({ id: 'b', type: 'income', description: 'משכורת' }), tx({ id: 'c', nature: 'fixed', description: 'משכנתא' })];
  assert.deepEqual(filterTxs(list, { filter: 'income' }).map((t) => t.id), ['b']);
  assert.deepEqual(filterTxs(list, { filter: 'expense' }).map((t) => t.id), ['a', 'c']);
  assert.deepEqual(filterTxs(list, { filter: 'fixed' }).map((t) => t.id), ['c']);
  assert.deepEqual(filterTxs(list, { query: 'סופ', categoriesById: cats }).map((t) => t.id), ['a']);
});

test('groupByDay: newest day first with net per day', () => {
  const g = groupByDay([tx({ tx_date: '2026-09-01', amount: 10 }), tx({ tx_date: '2026-09-03', amount: 20 }), tx({ tx_date: '2026-09-03', amount: 5, type: 'income' })]);
  assert.deepEqual(g.map((x) => [x.date, x.items.length, x.net]), [['2026-09-03', 2, -15], ['2026-09-01', 1, -10]]);
});

test('groupByMonth: newest month first, empty months dropped', () => {
  const months = [{ y: 2026, m: 6 }, { y: 2026, m: 7 }, SEP];
  const g = groupByMonth([tx({ tx_date: '2026-07-04' }), tx({ tx_date: '2026-09-04' })], months);
  assert.deepEqual(g.map((x) => x.month), [SEP, { y: 2026, m: 6 }]);
});

test('dayLabel marks today and yesterday', () => {
  const today = new Date(2026, 8, 19, 15);
  assert.equal(dayLabel('2026-09-19', today), 'היום · שבת, 19.9');
  assert.equal(dayLabel('2026-09-18', today), 'אתמול · יום ו׳, 18.9');
  assert.equal(dayLabel('2026-09-01', today), 'יום ג׳, 1.9');
});

test('categoryRows rolls subcategories up and compares to budget × months', () => {
  const cats = [{ id: 'food', name: 'אוכל', kind: 'expense' }, { id: 'super', name: 'סופר', parent_id: 'food', kind: 'expense' }, { id: 'car', name: 'רכב', kind: 'expense' }, { id: 'sal', name: 'משכורת', kind: 'income' }];
  const budgets = [{ category_id: 'food', monthly_amount: 1000 }];
  const list = [tx({ category_id: 'super', amount: 700 }), tx({ category_id: 'food', amount: 500 }), tx({ category_id: 'car', amount: 200 }), tx({ amount: 40 }), tx({ type: 'income', category_id: 'sal', amount: 9000 })];
  const rows = categoryRows(list, cats, budgets, [SEP]);
  assert.deepEqual(rows.map((r) => [r.name, r.spent, r.budget, r.over]), [['אוכל', 1200, 1000, true], ['רכב', 200, 0, false], ['בלי קטגוריה', 40, 0, false]]);
  assert.equal(categoryRows(list, cats, budgets, [SEP, { y: 2026, m: 7 }])[0].budget, 2000);
});

test('topCategoryId maps a subcategory to its parent', () => {
  const byId = new Map([['s', { id: 's', parent_id: 'p' }], ['p', { id: 'p' }]]);
  assert.equal(topCategoryId({ category_id: 's' }, byId), 'p');
  assert.equal(topCategoryId({ category_id: 'p' }, byId), 'p');
});

test('parseQuickAdd takes the amount from anywhere in the text', () => {
  assert.deepEqual(parseQuickAdd('46 קפה בארומה'), { amount: 46, description: 'קפה בארומה' });
  assert.deepEqual(parseQuickAdd('מוסך ₪1,200'), { amount: 1200, description: 'מוסך' });
  assert.deepEqual(parseQuickAdd('דלק 250.5'), { amount: 250.5, description: 'דלק' });
  assert.equal(parseQuickAdd('קפה'), null);
  assert.equal(parseQuickAdd('46'), null);
  assert.equal(parseQuickAdd('0 קפה'), null);
});

test('guessCategory uses the latest transaction of the same merchant', () => {
  const hist = [tx({ description: 'ארומה 12', category_id: 'old', tx_date: '2026-07-01' }), tx({ description: 'ארומה', category_id: 'food', subcategory_id: 'cafe', tx_date: '2026-09-01' })];
  assert.deepEqual(guessCategory('ארומה תל אביב', hist), { category_id: 'food', subcategory_id: 'cafe' });
  assert.equal(guessCategory('חדש לגמרי', hist), null);
});

test('frequentMerchants: recent, variable, at least twice, typical amount', () => {
  const today = new Date(2026, 8, 19);
  const list = [
    tx({ description: 'ארומה', amount: 40, tx_date: '2026-09-10' }), tx({ description: 'ארומה', amount: 46, tx_date: '2026-09-12' }), tx({ description: 'ארומה', amount: 60, tx_date: '2026-09-15' }),
    tx({ description: 'סונול', amount: 250, tx_date: '2026-09-01' }), tx({ description: 'סונול', amount: 280, tx_date: '2026-08-20' }),
    tx({ description: 'פעם אחת', amount: 10 }), tx({ description: 'ישן', tx_date: '2026-01-01' }), tx({ description: 'ישן', tx_date: '2026-01-02' }),
    tx({ description: 'משכנתא', nature: 'fixed' }), tx({ description: 'משכנתא', nature: 'fixed' })
  ];
  const r = frequentMerchants(list, today);
  assert.deepEqual(r.map((x) => [x.description, x.amount, x.count]), [['ארומה', 46, 3], ['סונול', 280, 2]]);
});

test('sameMerchantIds finds other transactions of the same merchant and type', () => {
  const a = tx({ id: 'a', description: 'ארומה 1' });
  const list = [a, tx({ id: 'b', description: 'ארומה' }), tx({ id: 'c', description: 'ארומה', type: 'income' }), tx({ id: 'd', description: 'קפה' })];
  assert.deepEqual(sameMerchantIds(a, list), ['b']);
});

test('sameMerchant: word-prefix match only', () => {
  assert.equal(sameMerchant('ארומה', 'ארומה תל אביב'), true);
  assert.equal(sameMerchant('קפה לנדוור', 'קפה גרג'), false);
  assert.equal(sameMerchant('', 'ארומה'), false);
});
