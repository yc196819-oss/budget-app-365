import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTerm, chooseAll, chainHe } from '../public/app/src/domain/prices.js';

const offers = (...prices) => prices.map((price, i) => ({ chain: 'c' + i, chain_name: 'רשת ' + i, price }));
const P = (barcode, name, qty, unit, prices) => ({ barcode, name, qty, unit, offers: offers(...prices), kosher: {} });

test('round 3: the list says it in the singular, the chains in the plural', () => {
  assert.equal(searchTerm('ביצה'), 'ביצים');
  assert.equal(searchTerm(' עגבנייה '), 'עגבניות');
  assert.equal(searchTerm('עגבניה'), 'עגבניות');
  assert.equal(searchTerm('לחמניה'), 'לחמניות');
  assert.equal(searchTerm('קוטג'), "קוטג'");
  assert.equal(searchTerm('חלב 3%'), 'חלב 3%', 'anything else as typed');
  assert.equal(searchTerm('ביצה קינדר'), 'ביצה קינדר', 'only the whole name');
});

test('round 3: "ביצה" on the list finds a box of eggs, and keeps its own name', () => {
  const eggs = [P('1', 'ביצים רגילות 12 יח\' M', 12, 'יחידות', [12.9, 13.4, 13.9]), P('2', 'ביצה קינדר', null, null, [6])];
  const [c] = chooseAll([{ id: 'a', name: 'ביצה' }], { 'ביצה': eggs }, 'any');
  assert.equal(c.pick.barcode, '1');
  assert.equal(c.query, 'ביצה');
});

test('round 3: a chain\'s old English name shows in Hebrew', () => {
  assert.equal(chainHe('Osher Ad (אושר עד)'), 'אושר עד');
  assert.equal(chainHe('Shufersal (שופרסל)'), 'שופרסל');
  assert.equal(chainHe('רמי לוי'), 'רמי לוי');
  assert.equal(chainHe('מעיין 2000'), 'מעיין 2000');
});

test('a Haredi kashrut: chains open on Shabbat are left out, unless the family brings one back', async () => {
  const { haredi, hiddenChains, withoutChains } = await import('../public/app/src/domain/prices.js');
  assert.equal(haredi(['בד"ץ העדה החרדית']), true);
  assert.equal(haredi(['רבנות', 'רבנות מהדרין']), false);
  assert.equal(haredi('any'), false);
  assert.deepEqual(hiddenChains(['הרב לנדא']), ['tiv-taam']);
  assert.deepEqual(hiddenChains(['הרב לנדא'], ['tiv-taam']), []);
  assert.deepEqual(hiddenChains(['רבנות']), []);
  const cat = { 'חלב': [P('1', 'חלב 1 ליטר', 1, 'ליטר', [6]) ] };
  cat['חלב'][0].offers = [{ chain: 'tiv-taam', price: 5 }, { chain: 'rami-levy', price: 6 }];
  assert.deepEqual(withoutChains(cat, ['tiv-taam'])['חלב'][0].offers.map((o) => o.chain), ['rami-levy']);
  assert.equal(withoutChains(cat, []), cat);
});

test('round 4: a fuel station shop is marked, and when it is the cheapest the cheapest supermarket is named', async () => {
  const { chainNote, bestAlways } = await import('../public/app/src/domain/prices.js');
  assert.equal(chainNote('yellow').short, 'חנות בתחנת דלק');
  assert.equal(chainNote('dor-alon').alt, 'בסופרמרקט');
  const rows = [{ chain: 'dor-alon', missing: 0, total: 50 }, { chain: 'yellow', missing: 0, total: 51 }, { chain: 'rami-levy', name: 'רמי לוי', missing: 0, total: 55 }];
  assert.equal(bestAlways(rows).chain, 'rami-levy');
});

test('round 4: quantities written in pieces, liters or kilos', async () => {
  const { count } = await import('../public/app/src/domain/prices.js');
  const { parseItem } = await import('../public/app/src/domain/shopping.js');
  const milk = P('1', 'חלב 3% 1 ליטר', 1, 'ליטר', [6]);
  const snack = P('2', 'במבה 80 גרם', 80, 'גרם', [4]);
  assert.equal(count('×3'), 3);
  assert.equal(count("3 יח'"), 3);
  assert.equal(count('2 חבילות'), 2);
  assert.equal(count('4'), 4);
  assert.equal(count('2 ליטר', milk), 2);
  assert.equal(count('2 ליטר'), 1, 'no product: one package');
  assert.equal(count('400 גרם', snack), 5);
  assert.equal(count('1 ק"ג', milk), 1, 'kilos of a liter product: one');
  assert.equal(count('2 ק"ג'), 1, 'fruit by weight');
  assert.deepEqual(parseItem('חלב 3% 2 ליטר'), { name: 'חלב 3%', qty: '2 ליטר' });
  assert.deepEqual(parseItem('2 ביצים'), { name: 'ביצים', qty: '×2' });
});

test('round 4: the list split between two chains, when it saves enough', async () => {
  const { twoChains } = await import('../public/app/src/domain/prices.js');
  const line = (id, cost) => ({ id, product: cost == null ? null : { barcode: id }, cost });
  const rows = [
    { chain: 'a', name: 'רשת א', missing: 0, total: 200, lines: [line('1', 100), line('2', 60), line('3', 40)] },
    { chain: 'b', name: 'רשת ב', missing: 0, total: 210, lines: [line('1', 70), line('2', 80), line('3', 60)] },
    { chain: 'mishnat-yosef', name: 'משנת יוסף', missing: 0, total: 150, lines: [line('1', 50), line('2', 50), line('3', 50)] }
  ];
  const t = twoChains(rows);
  assert.deepEqual([t.a.chain, t.b.chain, t.total, t.saved, t.atB], ['a', 'b', 170, 30, ['1']], 'item 1 at B, the rest at A; the weekly chain not suggested');
  assert.equal(twoChains(rows, { min: 40 }), null, 'not worth it');
});
