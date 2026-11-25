import { test } from 'node:test';
import assert from 'node:assert/strict';
import { size, sizeText, words, score, bestPrice, levelOf, allowed, choose, chooseAll, basket, count, kosherHint, typicalPrice } from '../public/app/src/domain/prices.js';

// Made-up products and prices.
const milkA = { barcode: '1001', name: 'חלב 3% בשקית', maker: 'מחלבה א', qty: 1, unit: 'ליטר', offers: [{ chain: 'x', chain_name: 'רשת א', price: 6.2 }, { chain: 'y', chain_name: 'רשת ב', price: 6.9 }], kosher: { votes: { mehadrin: 3 } } };
const milkB = { barcode: '1002', name: 'חלב 3% קרטון', maker: 'מחלבה ב', qty: 1000, unit: 'מיליליטר', offers: [{ chain: 'x', price: 5.9 }], kosher: { votes: { regular: 2 } } };
const milkBig = { barcode: '1003', name: 'חלב 3% 2 ליטר', qty: 2, unit: 'ליטר', offers: [{ chain: 'y', price: 11 }], kosher: {} };
const choco = { barcode: '2001', name: 'משקה שוקו בטעם חלב 3%', qty: 1, unit: 'ליטר', offers: [{ chain: 'x', price: 4 }], kosher: { votes: { mehadrin: 5 } } };

test('sizes in different words become one unit to compare by', () => {
  assert.deepEqual(size(1000, 'מיליליטר'), { unit: 'l', qty: 1 });
  assert.deepEqual(size('1', 'ליטר'), { unit: 'l', qty: 1 });
  assert.deepEqual(size(500, 'גרם'), { unit: 'kg', qty: 0.5 });
  assert.deepEqual(size(1, 'ק"ג'), { unit: 'kg', qty: 1 });
  assert.equal(size(0, 'ליטר'), null);
  assert.equal(size(3, '---'), null);
  assert.equal(sizeText({ unit: 'l', qty: 0.5 }), '500 מ"ל');
  assert.equal(sizeText({ unit: 'kg', qty: 1 }), '1 ק"ג');
});

test('typed words are found with a Hebrew prefix and without punctuation', () => {
  assert.deepEqual(words('חלב 3%, של תנובה'), ['חלב', '3%', 'תנובה']);
  assert.ok(score('חלב', { name: 'החלב הטרי' }) > 0);
  assert.equal(score('חלב 1%', milkA), 0, 'a different fat level is not a match');
  assert.ok(score('חלב 3%', milkA) > score('חלב 3%', choco), 'milk before chocolate milk');
});

test('the cheapest price is compared per liter, not per package', () => {
  assert.equal(bestPrice(milkBig).perUnit, 5.5);
  assert.equal(bestPrice(milkA).price, 6.2);
  assert.equal(bestPrice({ offers: [] }), null);
});

test('kashrut comes only from confirmations: the owner first, then most families', () => {
  assert.equal(levelOf(milkA).level, 'mehadrin');
  assert.equal(levelOf({ kosher: { votes: { mehadrin: 1, regular: 3 } } }).level, 'regular');
  assert.equal(levelOf({ kosher: { owner: 'mehadrin', votes: { none: 4 } } }).by, 'owner');
  assert.equal(levelOf({ name: 'חלב מהדרין', kosher: {} }), null, 'a word in the name is not a confirmation');
  assert.equal(kosherHint('חלב 3% מהדרין'), 'mehadrin');
  assert.equal(allowed(milkB, 'mehadrin'), false);
  assert.equal(allowed(milkA, 'regular'), true);
  assert.equal(allowed(milkBig, 'any'), true);
});

test('the automatic choice: the cheapest product the household\'s kashrut allows', () => {
  const all = [milkA, milkB, milkBig, choco];
  // The usual package first (a liter: two of the three), the cheapest of those
  // per liter; a 2-liter one only when no usual one is allowed.
  assert.equal(choose('חלב 3%', all, 'any').pick.barcode, '1002', 'the usual liter, cheapest');
  assert.equal(choose('חלב 3%', [milkBig, milkA], 'any').pick.barcode, '1001', 'a liter before a cheaper-per-liter 2 liters');
  assert.equal(choose('חלב 3%', all, 'regular').pick.barcode, '1002');
  assert.equal(choose('חלב 3%', all, 'mehadrin').pick.barcode, '1001', 'not the chocolate milk, though it is cheaper');
});

test('nothing confirmed for a strict household: marked unsure, never guessed', () => {
  const r = choose('חלב 3%', [milkBig], 'mehadrin', { strict: true });
  assert.equal(r.status, 'unsure');
  assert.equal(r.pick, null);
  assert.equal(r.options[0].barcode, '1003', 'still shown to choose from');
  assert.equal(choose('גבינה', [milkA], 'any').status, 'none');
});

test('a product the person chose stays chosen', () => {
  const r = choose('חלב 3%', [milkA, milkB], 'any', { keep: '1001' });
  assert.equal(r.status, 'chosen');
  assert.equal(r.pick.barcode, '1001');
});

test('a list of 200 items gets all its choices at once, quickly', () => {
  const catalog = {};
  const items = Array.from({ length: 200 }, (_, i) => {
    const name = 'מוצר ' + i;
    catalog[name] = Array.from({ length: 30 }, (_, j) => ({ barcode: i + '-' + j, name: name + ' סוג ' + j, qty: 1, unit: 'יחידה', offers: [{ chain: 'x', price: 10 + j }], kosher: { votes: { mehadrin: j % 2 } } }));
    return { id: 'i' + i, name };
  });
  const t0 = Date.now();
  const out = chooseAll(items, catalog, 'mehadrin');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(out.length, 200);
  assert.ok(out.every((c) => c.status === 'auto' && c.pick.barcode.endsWith('-1')));
});

test('the list at each chain: cheapest first, and what each chain is missing', () => {
  const choices = [choose('חלב 3%', [milkA], 'any'), choose('חלב 3%', [milkB], 'any')];
  const b = basket(choices, () => 2);
  const plain = ({ lines, ...r }) => r;
  assert.deepEqual(plain(b[0]), { chain: 'x', name: 'רשת א', store: null, total: 24.2, missing: 0, swaps: 0, gap: 0, fair: 24.2, saved: 0 });
  assert.deepEqual(plain(b[1]), { chain: 'y', name: 'רשת ב', store: null, total: 13.8, missing: 1, swaps: 0, gap: 11.8, fair: 25.6, saved: 0 });
  assert.equal(count('×3'), 3);
  assert.equal(count('2 ק"ג'), 1);
});

test('chains are compared by the whole list: a missing product counts at about its usual price', () => {
  const p = (barcode, name, offers) => ({ barcode, name, qty: 1, unit: 'ליטר', offers: offers.map(([chain, price]) => ({ chain, chain_name: chain, price })), kosher: { votes: { regular: 2 } } });
  const juice = p('3001', 'מיץ תפוזים', [['a', 10], ['b', 9], ['c', 11]]);
  const oil = p('3002', 'שמן קנולה', [['a', 12], ['c', 14]]);
  const soap = p('3003', 'סבון ידיים', [['a', 8], ['c', 8]]);
  const rows = basket([juice, oil, soap].map((x, i) => ({ id: 'i' + i, query: x.name, status: 'auto', pick: x, options: [x], pool: [x] })));
  // b lacks two of three: it goes last, whatever its price.
  assert.deepEqual(rows.map((r) => r.chain), ['a', 'c', 'b']);
  assert.equal(typicalPrice(oil), 13);
  const b = rows.find((r) => r.chain === 'b');
  assert.equal(b.gap, 21);
  assert.equal(b.fair, 30);
});

test('a chain about as cheap that lacks something does not beat one that has everything', () => {
  const p = (barcode, offers) => ({ barcode, name: 'מוצר ' + barcode, qty: 1, unit: 'ליטר', offers: offers.map(([chain, price]) => ({ chain, chain_name: chain, price })), kosher: { votes: { regular: 2 } } });
  const items = [p('4001', [['full', 20], ['part', 19]]), p('4002', [['full', 20], ['part', 19]]), p('4003', [['full', 10], ['part', 10]]), p('4004', [['full', 10.5], ['other', 9.5]])];
  const rows = basket(items.map((x, i) => ({ id: 'i' + i, query: x.name, status: 'auto', pick: x, options: [x], pool: [x] })));
  // part: 48 + about 10 = 58, a guess; full: 60.50 for everything.
  assert.equal(rows.find((r) => r.chain === 'part').fair, 58);
  assert.equal(rows[0].chain, 'part', 'clearly cheaper even with the guess (58 × 1.03 < 60.50)');
  const close = basket(items.map((x, i) => ({ id: 'i' + i, query: x.name, status: 'auto', pick: x, options: [x], pool: [x] })).map((c) => c.pick.barcode === '4004' ? { ...c, pick: { ...c.pick, offers: [{ chain: 'full', chain_name: 'full', price: 9 }, { chain: 'other', chain_name: 'other', price: 11 }] }, pool: [] } : c));
  // Now full is 59 for everything and part about 58 without one: full wins.
  assert.equal(close[0].chain, 'full');
});
