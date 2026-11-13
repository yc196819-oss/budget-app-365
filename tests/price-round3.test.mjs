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
