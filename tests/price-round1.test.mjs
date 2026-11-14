import { test } from 'node:test';
import assert from 'node:assert/strict';
import { size, sizeOfProduct, choose, special, validOffers, bestPrice } from '../public/app/src/domain/prices.js';

// Made-up products, shaped like the chains' files.
const offers = (...prices) => prices.map((price, i) => ({ chain: 'c' + i, chain_name: 'רשת ' + i, price }));
const P = (barcode, name, qty, unit, prices) => ({ barcode, name, qty, unit, offers: offers(...prices), kosher: {} });

test('round 1: a quantity in grams with a kilo unit is a kilo, not a thousand kilos', () => {
  assert.deepEqual(size(1000, '1 קילוגרם'), { unit: 'kg', qty: 1 });
  assert.deepEqual(size(1500, 'ליטר'), { unit: 'l', qty: 1.5 });
  assert.deepEqual(size(250, "100 מ''ל"), { unit: 'l', qty: 0.25 }, 'two apostrophes for the quote mark');
  assert.deepEqual(size(5, 'ק"ג'), { unit: 'kg', qty: 5 }, 'a real five kilos stays');
});

test('round 1: the size written in the name, when the file has none or says one unit', () => {
  assert.deepEqual(size(null, '', 'טחינה גולמית 300 גרם'), { unit: 'kg', qty: 0.3 });
  assert.deepEqual(size(1, 'יח', 'במבה קלאסי שישייה 6*40 גרם'), { unit: 'kg', qty: 0.24 }, 'a pack of six');
  assert.deepEqual(size(null, null, 'מים מינרליים 1.5 ל\''), { unit: 'l', qty: 1.5 });
  assert.equal(size(null, null, 'קפה טורקי'), null);
  assert.deepEqual(sizeOfProduct({ name: 'חומוס 600 גרם' }), { unit: 'kg', qty: 0.6 });
});

test('round 1: a plain word means the ordinary product, not a special kind', () => {
  assert.ok(special('קפה עלית קפסולות', 'קפה'));
  assert.ok(!special('קפה עלית קפסולות', 'קפה קפסולות'), 'unless typed');
  assert.ok(special('מטרנה מחית ירקות', 'מטרנה'));
  assert.ok(special('פתיתים אפויים ללא גל', 'פתיתים'));
  const coffee = [P('1', 'קפה עלית קפסולות 10 יח', 10, 'יחידות', [16.7, 17, 18, 19]), P('2', 'קפה טורקי 200 גרם', 200, 'גרם', [14.9, 15.5, 16, 17])];
  assert.equal(choose('קפה', coffee, 'any').pick.barcode, '2');
});

test('round 1: eggs per egg are not compared with flour per kilo; the usual package comes first', () => {
  const rice = [P('1', 'אורז פרסי 1 ק"ג', 1, 'ק"ג', [8.9, 9.5, 9.9, 10.5]), P('2', 'אורז פרסי 1 ק"ג', 1000, '1 קילוגרם', [9.9, 10, 10.5, 11]), P('3', 'אורז יסמין 5 ק"ג', 5, 'ק"ג', [39.9, 41, 42, 43])];
  assert.equal(choose('אורז', rice, 'any').pick.barcode, '1', 'a kilo, not the cheaper-per-kilo five kilos');
});

test('round 1: a price that cannot be right is not used', () => {
  const carrot = P('1', 'גזר ארוז 1 ק"ג', 1, 'ק"ג', [0.1, 3.9, 4.2, 4.5]);
  assert.deepEqual(validOffers(carrot).map((o) => o.price), [3.9, 4.2, 4.5]);
  assert.equal(bestPrice(carrot).price, 3.9);
  const odd = P('2', 'קוטג 250 גרם', 250, 'גרם', [0.9, 5.9, 6.1, 6.3]);
  assert.equal(bestPrice(odd).price, 5.9, 'a fifth of the usual price is a mistake in the file');
});

test('round 1: fruit and vegetables are sold by the kilo, or said to be sold by weight', () => {
  const apples = [P('1', 'תפוחים-אגוזים 602 גרם', 602, 'גרם', [38.9, 39, 40]), P('2', 'סיידר רביעייה תפוחים', 4, 'ליטר', [30, 31, 32]), P('3', 'תפוחים קטנים לקישוט', null, '', [7.9, 8, 9])];
  assert.equal(choose('תפוחים', apples, 'any').status, 'fresh');
  const carrots = [P('1', 'גזר דק 250 גרם', 250, 'גרם', [6.9, 7, 7.5]), P('2', 'גזר ארוז', 1, 'ק"ג', [3.9, 4.2, 4.5])];
  assert.equal(choose('גזר', carrots, 'any').pick.barcode, '2');
});

test('round 1: "ופלים" finds "וופלים" as well', () => {
  const w = [P('1', 'ופלים יובלירנויה 275 גרם', 275, 'גרם', [8.9]), P('2', 'וופלים מן שוקו 500 גרם', 500, 'גרם', [10.9, 11, 11.5, 12, 12.5])];
  assert.equal(choose('ופלים', w, 'any').pick.barcode, '2', 'the one most chains sell');
});
