import { test } from 'node:test';
import assert from 'node:assert/strict';
import { size, choose, special, flavoured, madeFrom, validOffers, basket } from '../public/app/src/domain/prices.js';

// Made-up products, shaped like the chains' files.
const offers = (...prices) => prices.map((price, i) => ({ chain: 'c' + i, chain_name: 'רשת ' + i, price }));
const P = (barcode, name, qty, unit, prices) => ({ barcode, name, qty, unit, offers: offers(...prices), kosher: {} });

test('round 2: a pack of six priced as one package is six bottles', () => {
  assert.deepEqual(size(1.5, 'ליטר', 'קולה 1.5 ליטר (שישייה)'), { unit: 'l', qty: 9 });
  assert.deepEqual(size(120, 'גרם', 'טונה במים 120 גר רביעיות'), { unit: 'kg', qty: 0.48 });
  assert.deepEqual(size(560, 'גרם', 'טונה בשמן רביעייה 4 * 140 גרם'), { unit: 'kg', qty: 0.56 }, 'the name already counts the four');
  assert.deepEqual(size(null, null, 'נייר טואלט 32 יח'), { unit: 'unit', qty: 32 }, '"יח" with no apostrophe');
});

test('round 2: the plain product before a flavour, and its usual size', () => {
  assert.ok(flavoured('במבה מאנצ חמוץ חריף', 'במבה'));
  assert.ok(!flavoured('במבה מאנצ חמוץ חריף', 'במבה חריף'), 'unless typed');
  assert.ok(!flavoured('גלידה בטעם וניל', 'גלידה'), 'every ice cream has a taste');
  const bamba = [
    P('1', 'במבה חמוץ חריף 150 גרם', 150, 'גרם', [8.5, 8.9, 9, 9.5]), P('2', 'במבה נוגט 150 גרם', 150, 'גרם', [8.9, 9, 9.2, 9.5]),
    P('3', 'במבה אסם 80 גרם', 80, 'גרם', [3.9, 4.2, 4.5, 4.9])
  ];
  assert.equal(choose('במבה', bamba, 'any').pick.barcode, '3');
});

test('round 2: when no size is more usual than another, the cheapest per liter', () => {
  const leben = [P('1', 'לבן בלדי 3 ליטר', 3, 'ליטר', [38.9]), P('2', 'לבן 3% 150 מ"ל', 150, 'מ"ל', [1.1]), P('3', 'לבן 1.5 ליטר', 1.5, 'ליטר', [22.9])];
  assert.equal(choose('לבן', leben, 'any').pick.barcode, '2');
});

test('round 2: brown rice, sushi rice and pickles are not "rice" or "cucumbers"', () => {
  assert.ok(special('אורז מלא ארוך 1 ק"ג', 'אורז'));
  assert.ok(!special('אורז מלא ארוך 1 ק"ג', 'אורז מלא'));
  assert.ok(special('אורז סושי 1 ק"ג', 'אורז'));
  assert.ok(madeFrom('מלפפון קורנישון 1.36 ק"ג', 'מלפפון'));
  const cucumbers = [P('1', 'מלפפון קורנישון 1.36 ק"ג', 1.36, 'ק"ג', [12, 13, 14, 15, 16]), P('2', 'מלפפון', 1, 'ק"ג', [5.9, 6.9, 7.5])];
  assert.equal(choose('מלפפון', cucumbers, 'any').pick.barcode, '2');
});

test('round 2: a crate\'s price written as one kilo is not used', () => {
  assert.deepEqual(validOffers(P('1', 'בננה 1 ק"ג', 1, 'ק"ג', [55, 7.9])).map((o) => o.price), [7.9], 'two chains, one asks seven times more');
  assert.deepEqual(validOffers(P('2', 'מלפפון', 1, 'ק"ג', [14.9, 24.9, 38.9, 12.9])).map((o) => o.price), [14.9, 24.9, 12.9]);
  assert.deepEqual(validOffers(P('3', 'חלב', 1, 'ליטר', [6.2, 6.9])).map((o) => o.price), [6.2, 6.9], 'an ordinary difference stays');
});

test('round 2: a chain missing products shows about what they would add', () => {
  const milk = P('m', 'חלב 1 ליטר', 1, 'ליטר', [6, 7]);
  const coffee = { ...P('k', 'קפה 200 גרם', 200, 'גרם', [15]), offers: [{ chain: 'c0', chain_name: 'רשת 0', price: 15 }] };
  const rows = basket([{ id: 'a', pick: milk, pool: [milk] }, { id: 'b', pick: coffee, pool: [coffee] }], (c) => (c.id === 'b' ? 2 : 1));
  const c1 = rows.find((r) => r.chain === 'c1');
  assert.equal(c1.missing, 1);
  assert.equal(c1.gap, 30, 'two coffees at the cheapest price elsewhere');
  assert.equal(rows.find((r) => r.chain === 'c0').gap, 0);
});
