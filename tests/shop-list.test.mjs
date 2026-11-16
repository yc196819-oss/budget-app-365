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

import { fromTemplate, personal, TEMPLATES } from '../public/app/src/domain/shopTemplates.js';

test('ready carts are sized to the people; fixed things stay one package; dairy and meat are apart', () => {
  assert.deepEqual(TEMPLATES.map((t) => t.key), ['week', 'shabbat', 'holiday', 'guests']);
  const s = fromTemplate('shabbat', 6);
  assert.equal(s.people, 6);
  const at = (l, n) => l.items.find((i) => i.name === n);
  assert.equal(qtyText(at(s, 'חלות'), 6, s.people), '4');
  assert.equal(qtyText(at(s, 'יין לקידוש'), 6, s.people), '2 בקבוקים');
  assert.equal(qtyText(at(s, 'נרות שבת'), 6, s.people), '1 חבילה');
  assert.equal(qtyText(at(s, 'חלות'), 2, s.people), '1');
  const dairy = fromTemplate('guests', 10, { meal: 'dairy' });
  const meat = fromTemplate('guests', 10, { meal: 'meat' });
  assert.equal(dairy.title, 'ארוחה חלבית לאורחים');
  assert.ok(!dairy.items.some((i) => /בשר|עוף/.test(i.name)), 'no meat in a dairy meal');
  assert.ok(!meat.items.some((i) => /גבינ|שמנת|חלב/.test(i.name)), 'no dairy in a meat meal');
  assert.equal(qtyText(at(meat, 'בשר / עוף לצלייה'), 10, 10), '3.5 ק"ג');
  assert.equal(fromTemplate('nope', 3), null);
  assert.equal(fromTemplate('week', 0).people, 4, 'no number: four');
});

test('a cart is made personal only when the home has bought enough things more than once', () => {
  assert.equal(personal([]), false);
  assert.equal(personal([{ times: 2 }, { times: 3 }, { times: 1 }, { times: 5 }]), false);
  assert.equal(personal([{ times: 2 }, { times: 3 }, { times: 2 }, { times: 5 }]), true);
});

import { recipeItems, mergeItems, isPantry } from '../public/app/src/domain/shopList.js';

test('a recipe is sized from its servings to the list, its pantry things marked', () => {
  const r = { title: 'שקשוקה', servings: 4, items: [{ name: 'ביצים', qty: 6, unit: "יח'", aisle: 'dairy' }, { name: 'שמן זית', qty: 3, unit: 'כפות', pantry: true }, { name: 'מלח', qty: null, unit: '' }, { name: 'עגבניות', qty: 0.8, unit: 'ק"ג' }] };
  const items = recipeItems(r, 6);
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.pantry, i.from]), [['ביצים', 9, false, 'recipe'], ['שמן זית', 4.5, true, 'recipe'], ['מלח', null, true, 'recipe'], ['עגבניות', 1.2, false, 'recipe']]);
  assert.equal(isPantry('פלפל שחור גרוס'), true);
  assert.equal(isPantry('פלפל אדום'), false);
  assert.deepEqual(recipeItems({ items: [] }, 4), []);
});

test('a recipe added to a cart: the same product in the same unit becomes one line', () => {
  const cart = [{ name: 'עגבניות', qty: 1.5, unit: 'ק"ג', aisle: 'produce', scale: true }, { name: 'חלות', qty: 4, unit: '', scale: true }];
  const more = [{ name: 'עגבניות', qty: 1.2, unit: 'ק"ג', from: 'recipe' }, { name: 'ביצים', qty: 9, unit: "יח'", from: 'recipe' }, { name: 'חלות', qty: 2, unit: 'יח' }];
  const m = mergeItems(cart, more);
  assert.deepEqual(m.map((i) => [i.name, i.qty]), [['עגבניות', 2.7], ['חלות', 4], ['ביצים', 9]]);
  assert.equal(cart[0].qty, 1.5, 'the cart itself is not changed');
});
