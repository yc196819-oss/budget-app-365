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
  assert.deepEqual([s.paid, s.ours], [5.9 + 24.9 + 15, 5.9 + 16.9 + 15.6], 'the sums are over the lines found only, every unit');
  assert.equal(unitPaid({ qty: 2.5, price: 20 }), 8, 'a weighed line: its kilo price');
  assert.equal(unitPaid({ qty: 1.5, price: 20, unit_price: 13.9, weighed: true }), 13.9, 'the kilo price written on the line');
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

test('by barcode first: exact even when the name would pick another product; deals; kilos; fair totals', () => {
  const off = (price, promos = []) => ({ chain: 'demo', chain_name: 'רשת בדויה', price, promos });
  const deal = (text, unit_price, need = 1) => ({ text, unit_price, need, everyone: true });
  const receipt = { store: 'רשת בדויה', total: 200, items: [
    { name: 'מיץ ענבים', code: '7290000000011', qty: 1, price: 9.6 },
    { name: 'ג\'ל כביסה', code: '7290000000028', qty: 1, price: 32 },
    { name: 'מרכך כביסה', code: '7290000000035', qty: 1, price: 4.9 },
    { name: 'חטיף בדוי', code: '7290000000042', qty: 2, price: 6 },
    { name: 'דג פילה', code: '8611', qty: 1.5, price: 90, unit_price: 60, weighed: true },
    { name: 'בטטה', code: '9001', qty: 0.6, price: 3.6, weighed: true },
    { name: 'שקית', code: '9028', qty: 5, price: 3 },
    { name: 'נייר טואלט', code: '7290000000059', qty: 1, price: 39.9 }
  ] };
  const byCode = {
    '7290000000011': { barcode: '7290000000011', name: 'מיץ ענבים טבעי 1 ליטר', offers: [off(11.9)] },
    '7290000000028': { barcode: '7290000000028', name: 'ג\'ל כביסה 5 ליטר', offers: [off(39.9, [deal('2 ב-64', 32, 2)])] },
    '7290000000035': { barcode: '7290000000035', name: 'מרכך כביסה 1 ליטר', offers: [off(8.9, [deal('4.90 עד 3', 4.9)])] },
    '7290000000042': { barcode: '7290000000042', name: 'חטיף בדוי 60 גרם', offers: [off(3)] },
    '7290000000059': { barcode: '7290000000059', name: 'נייר טואלט 32', offers: [off(29.9)] }
  };
  const found = {
    'מיץ ענבים': [{ name: 'מיץ ענבים רוזה 750 מ"ל', offers: [off(18.9)] }],
    'דג פילה': [{ name: 'דג פילה', qty: 1, unit: 'ק"ג', offers: [off(59.9)] }],
    'בטטה': [{ name: 'בטטה ארוזה 1.5 ק"ג', offers: [off(12.9)] }, { name: 'בטטה', offers: [off(5.9)] }]
  };
  const lines = compareReceipt(receipt, found, { chain: 'demo', chainName: 'רשת בדויה', byCode });
  const st = Object.fromEntries(lines.map((l) => [l.name, l.status]));
  assert.equal(lines[0].ours, 11.9, 'the barcode, not the rosé at 18.90 the name found');
  assert.equal(lines[0].by, 'code');
  assert.equal(st['מיץ ענבים'], 'cheaper', 'less than ours with no deal we know of');
  assert.equal(st['ג\'ל כביסה'], 'promo');
  assert.equal(lines[1].promo, '2 ב-64');
  assert.equal(st['מרכך כביסה'], 'promo');
  assert.equal(st['חטיף בדוי'], 'ok');
  assert.equal(lines[3].paid, 3);
  assert.deepEqual([lines[4].paid, lines[4].ours, lines[4].status, lines[4].by], [60, 59.9, 'ok', 'name'], 'by the kilo');
  assert.deepEqual([lines[5].paid, lines[5].ours, lines[5].status], [6, 5.9, 'ok'], 'a packed 1.5 kilo bag is not the kilo price');
  assert.equal(st['שקית'], 'none');
  assert.equal(st['נייר טואלט'], 'check', 'paid ₪10 more than our price');
  const s = compareSummary(lines);
  assert.equal(s.known, 7);
  assert.equal(s.total, 8);
  assert.equal(s.check, 1);
  assert.equal(s.promo, 3);
  // Paid: 9.6 + 32 + 4.9 + 6 + 90 + 3.6 + 39.9; ours: 11.9 + 39.9 + 8.9 + 6 + 59.9×1.5 + 5.9×0.6 + 29.9.
  assert.equal(s.paid, 186);
  assert.equal(s.ours, 189.99);
  assert.equal(s.saved, 3.99);
});
