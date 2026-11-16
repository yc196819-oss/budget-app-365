import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, qtyText, shopContext, alreadyOn, toItems, LIST_MARK } from '../public/app/src/domain/shopList.js';

const answer = 'הכנתי רשימה לשבת ל-6 נפשות.\n' + LIST_MARK + JSON.stringify({
  title: 'רשימה לשבת', people: 6, kosher: 'מהדרין',
  items: [
    { name: 'עגבניות', qty: 1.5, unit: 'ק"ג', aisle: 'produce' },
    { name: 'תפוחי אדמה', qty: 2, unit: 'ק"ג' },
    { name: 'עוף שלם', qty: 2, unit: "יח'", aisle: 'meat' },
    { name: 'חלות', qty: 4, unit: '' },
    { name: 'יין לקידוש', qty: 2, unit: 'בקבוקים', aisle: 'drinks' },
    { name: 'נרות שבת', qty: 1, unit: 'חבילה', scale: false },
    { name: 'חלות', qty: 9 },
    { name: '', qty: 1 },
    { name: 'משהו', aisle: 'not-an-aisle' }
  ]
}) + '\n@@הצעות: בלי בשר?|להוסיף סלטים?';

test('the list is read from the answer: names once, known aisles, fixed items kept fixed', () => {
  const l = parseList(answer);
  assert.equal(l.title, 'רשימה לשבת');
  assert.equal(l.people, 6);
  assert.equal(l.kosher, 'מהדרין');
  assert.deepEqual(l.items.map((i) => i.name), ['עגבניות', 'תפוחי אדמה', 'עוף שלם', 'חלות', 'יין לקידוש', 'נרות שבת', 'משהו']);
  assert.equal(l.items[1].aisle, 'produce', 'from the name when not given');
  assert.equal(l.items[6].aisle, 'other');
  assert.equal(l.items[5].scale, false);
  assert.equal(l.items[6].qty, null);
});

test('no list, a broken one, or one with no items: nothing', () => {
  assert.equal(parseList('סתם תשובה'), null);
  assert.equal(parseList(LIST_MARK + '{not json'), null);
  assert.equal(parseList(LIST_MARK + '{"items":[]}'), null);
});

test('amounts follow the number of people, in words people use', () => {
  const l = parseList(answer);
  const at = (n) => l.items.map((i) => qtyText(i, n, l.people));
  assert.deepEqual(at(6), ['1.5 ק"ג', '2 ק"ג', "2 יח'", '4', '2 בקבוקים', '1 חבילה', '']);
  assert.deepEqual(at(3), ['750 גרם', '1 ק"ג', "1 יח'", '2', '1 בקבוק', '1 חבילה', '']);
  assert.deepEqual(at(12), ['3 ק"ג', '4 ק"ג', "4 יח'", '8', '4 בקבוקים', '1 חבילה', '']);
  assert.equal(qtyText({ qty: 1.5, unit: 'ק"ג', scale: true }, 1, 6), '250 גרם');
  assert.equal(qtyText({ qty: 2, unit: "יח'", scale: true }, 1, 6), "1 יח'", 'never less than one');
  assert.equal(qtyText({ qty: 3, unit: 'ליטר', scale: true }, 3, 6), '1.5 ליטר');
});

test('what the advisor builds on: the people, the kashrut, what this home buys (receipts too) and what is on the list', () => {
  const items = [
    { name: 'חלב 3%', qty: '2', done: true, cleared_at: '2026-11-01' },
    { name: 'חלב 3%', done: true, cleared_at: '2026-11-08' },
    { name: 'לחם', done: true, cleared_at: '2026-11-08' },
    { name: 'ביצים', done: false, cleared_at: null },
    { name: 'עגבניות', done: true, cleared_at: null }
  ];
  const receipts = [{ items: [{ name: 'חלב 3%', price: 6.9 }, { name: 'גבינה', price: 0 }] }];
  const c = shopContext({ items, receipts, people: 5, kosher: ['בד"ץ'] });
  assert.equal(c.people, 5);
  assert.deepEqual(c.kosher, ['בד"ץ']);
  assert.deepEqual(c.usual[0], { name: 'חלב 3%', times: 2, qty: '2', lastPrice: 6.9 });
  assert.equal(c.usual[1].name, 'לחם');
  assert.deepEqual(c.onList, ['ביצים']);
  assert.equal(c.receipts, 1);
  assert.equal(shopContext({}).people, null);
});

test('what is already on the list is not added again; the rest is added sized', () => {
  assert.equal(alreadyOn('חלב', ['חלב 3%']), true);
  assert.equal(alreadyOn('גבינה', ['חלב 3%']), false);
  const l = parseList(answer);
  const checked = new Set(['עגבניות', 'חלות', 'נרות שבת']);
  assert.deepEqual(toItems(l, 3, checked, ['חלות לשבת']), [
    { name: 'עגבניות', qty: '750 גרם', aisle: 'produce' },
    { name: 'נרות שבת', qty: '1 חבילה', aisle: 'other' }
  ]);
});
