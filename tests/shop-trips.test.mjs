import test from 'node:test';
import assert from 'node:assert/strict';
import { finishSplit, staleItems, gapToCheck, compareReceipt, compareSummary, shopCategory, shopTwins, unitPaid } from '../public/app/src/domain/shopTrips.js';

test('finishing: what was marked is bought, the rest stays on the list', () => {
  const s = finishSplit([{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: true, cleared_at: 'x' }]);
  assert.deepEqual(s.bought.map((i) => i.id), [1]);
  assert.deepEqual(s.left.map((i) => i.id), [2]);
});

test('an item not bought three trips in a row is offered to take off; one bought in one of them is not', () => {
  const trips = [{ id: 't1', finished_at: '2026-10-01' }, { id: 't2', finished_at: '2026-10-08' }, { id: 't3', finished_at: '2026-10-15' }];
  const items = [
    { id: 'a', name: 'ציפורן', created_at: '2026-09-20', done: false },
    { id: 'b', name: 'קשיו', created_at: '2026-09-20', done: false },
    { id: 'c', name: 'קשיו', trip_id: 't2', cleared_at: '2026-10-08', done: true },
    { id: 'd', name: 'אוכמניות', created_at: '2026-10-10', done: false }
  ];
  assert.deepEqual(staleItems(items, trips).map((i) => i.id), ['a']);
});

test('a gap is "to check" above 15% or ₪3, the bigger of the two', () => {
  assert.equal(gapToCheck(24.9, 16.9), true);
  assert.equal(gapToCheck(9.5, 9.9), false);
  assert.equal(gapToCheck(7.5, 5.0), false, '₪2.5 is under ₪3 even though it is 50%');
  assert.equal(gapToCheck(60, 50), true, '₪10 is more than 15% of ₪50 (₪7.5)');
  assert.equal(gapToCheck(56, 50), false, '₪6 is under 15% of ₪50');
});

test('a receipt against our prices at the same chain: one per unit, another chain not used, a far price is another product', () => {
  const receipt = { store: 'רמי לוי', items: [
    { name: 'קוטג 5%', qty: 1, price: 5.9 },
    { name: 'גבינה צהובה', qty: 1, price: 24.9 },
    { name: 'יוגורט', qty: 3, price: 15 },
    { name: 'שמן זית', qty: 1, price: 45 },
    { name: 'מסרק', qty: 1, price: 14 }
  ] };
  const off = (chain, chain_name, price) => ({ chain, chain_name, price });
  const found = {
    'קוטג 5%': [{ name: 'קוטג 5%', offers: [off('rami', 'רמי לוי', 5.9), off('shufersal', 'שופרסל', 6.5)] }],
    'גבינה צהובה': [{ name: 'גבינה צהובה', offers: [off('rami', 'רמי לוי', 16.9)] }],
    'יוגורט': [{ name: 'יוגורט', offers: [off('rami', 'רמי לוי', 5.2)] }],
    'שמן זית': [{ name: 'שמן קנולה', offers: [off('rami', 'רמי לוי', 9.9)] }],
    'מסרק': []
  };
  const lines = compareReceipt(receipt, found, { chain: 'rami', chainName: 'רמי לוי' });
  assert.deepEqual(lines.map((l) => l.status), ['ok', 'check', 'ok', 'none', 'none']);
  assert.equal(lines[2].paid, 5);
  const s = compareSummary(lines);
  assert.equal(s.check, 1);
  assert.equal(s.known, 3);
  assert.equal(unitPaid({ qty: 2.5, price: 20 }), 20, 'a weighed line is its own price');
});

test('the category of a shopping expense: the last one used for the chain, else the supermarket one', () => {
  const cats = [{ id: 'food', name: 'מזון' }, { id: 'super', name: 'סופר', parent_id: 'food' }, { id: 'x', name: 'אחר' }];
  assert.deepEqual(shopCategory([], cats, 'רמי לוי'), { category_id: 'food', subcategory_id: 'super' });
  const txs = [{ type: 'expense', description: 'רמי לוי שיווק השקמה', category_id: 'x', subcategory_id: null, tx_date: '2026-10-01' }];
  assert.deepEqual(shopCategory(txs, cats, 'רמי לוי'), { category_id: 'x', subcategory_id: null });
});

test('a shopping expense and a card line of the same business within 3 days are offered as one; another business or 4 days are not', () => {
  const shop = { id: 's', source: 'shop', type: 'expense', description: 'רמי לוי', amount: 600, tx_date: '2026-11-10' };
  const card = { id: 'c', source: 'import', type: 'expense', description: 'רמי לוי שיווק השקמה', amount: 612.4, tx_date: '2026-11-11', card_id: 'k' };
  const other = { id: 'o', source: 'import', type: 'expense', description: 'שופרסל דיל', amount: 600, tx_date: '2026-11-10' };
  const late = { id: 'l', source: 'import', type: 'expense', description: 'רמי לוי', amount: 600, tx_date: '2026-11-14' };
  const t = shopTwins([shop, card, other, late]);
  assert.equal(t.length, 1);
  assert.equal(t[0].line.id, 'c');
  assert.deepEqual(shopTwins([shop, other, late]), []);
  assert.deepEqual(shopTwins([shop, card], new Set([t[0].key])), [], 'the household said they are two purchases');
});
