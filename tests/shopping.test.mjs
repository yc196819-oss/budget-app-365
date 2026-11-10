import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aisleOf, parseItem, parseItems, grouped, usual, previousList, onList, listText, perWeek } from '../public/app/src/domain/shopping.js';

test('each item goes to its department; a longer match wins', () => {
  assert.equal(aisleOf('חלב 3%'), 'dairy');
  assert.equal(aisleOf('עגבניות שרי'), 'produce');
  assert.equal(aisleOf('לחם מלא'), 'bakery');
  assert.equal(aisleOf('סבון כלים'), 'clean');
  assert.equal(aisleOf('סבון ידיים'), 'care');
  assert.equal(aisleOf('חיתולים מידה 4'), 'baby');
  assert.equal(aisleOf('משהו לא מוכר'), 'other');
});

test('an item with its amount, however it is written', () => {
  assert.deepEqual(parseItem('2 ביצים'), { name: 'ביצים', qty: '×2' });
  assert.deepEqual(parseItem('ביצים x2'), { name: 'ביצים', qty: '×2' });
  assert.deepEqual(parseItem('שתי תבניות ביצים'), { name: 'ביצים', qty: '2 תבניות' });
  assert.deepEqual(parseItem('1 ק"ג עגבניות'), { name: 'עגבניות', qty: '1 ק"ג' });
  assert.deepEqual(parseItem('חלב'), { name: 'חלב', qty: null });
  assert.equal(parseItem('   '), null);
});

test('several items in one line, with commas or "ו"', () => {
  const items = parseItems('חלב, 2 ביצים ולחם, ומשהו לכביסה');
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.aisle]), [
    ['חלב', null, 'dairy'], ['ביצים', '×2', 'dairy'], ['לחם', null, 'bakery'], ['משהו לכביסה', null, 'clean']
  ]);
});

const at = (d) => '2026-11-0' + d + 'T10:00:00Z';
const list = [
  { id: '1', name: 'חלב', aisle: 'dairy', done: false, created_at: at(8) },
  { id: '2', name: 'עגבניות', aisle: 'produce', done: true, created_at: at(8) },
  { id: '3', name: 'לחם', aisle: 'bakery', done: false, created_at: at(8), qty: '×2' },
  // Two finished shoppings.
  { id: '4', name: 'ביצים', aisle: 'dairy', done: true, created_at: at(1), cleared_at: at(2) },
  { id: '5', name: 'קוטג׳', aisle: 'dairy', done: true, created_at: at(1), cleared_at: at(2) },
  { id: '6', name: 'ביצים', aisle: 'dairy', done: true, created_at: at(5), cleared_at: at(6) },
  { id: '7', name: 'חלב', aisle: 'dairy', done: true, created_at: at(5), cleared_at: at(6) },
  { id: '8', name: 'אורז', aisle: 'dry', done: true, created_at: at(5), cleared_at: at(6) }
];

test('the open list in store order, done last within a department', () => {
  const g = grouped(list);
  assert.deepEqual(g.map((x) => x.aisle), ['produce', 'bakery', 'dairy']);
  assert.deepEqual(g.find((x) => x.aisle === 'dairy').items.map((i) => i.name), ['חלב']);
});

test('what this household usually buys, without what is already on the list', () => {
  assert.deepEqual(usual(list), ['ביצים', 'אורז', 'קוטג׳']);
});

test('the previous shopping, to bring back, without what is already on the list', () => {
  assert.deepEqual(previousList(list).map((i) => i.name), ['ביצים', 'אורז']);
  assert.equal(onList(list, 'חלב '), true);
  assert.equal(onList(list, 'ביצים'), false);
});

test('the list as text for an email or print: open items only, by department', () => {
  assert.equal(listText(list), 'מאפים:\n☐ לחם (×2)\n\nמוצרי חלב:\n☐ חלב');
});

test('how much per week keeps the food budget until the month ends', () => {
  // 8 November: 23 days left, about 3.3 weeks.
  assert.equal(perWeek(1000, new Date(2026, 10, 8)), 304);
  // The last days of the month count as one whole week.
  assert.equal(perWeek(500, new Date(2026, 10, 29)), 500);
  assert.equal(perWeek(0, new Date(2026, 10, 8)), 0);
  assert.equal(perWeek(-50, new Date(2026, 10, 8)), 0);
});

test('the advisor\'s week: what the home buys again first, then the basics sized by the people, nothing twice', async () => {
  const { suggestList } = await import('../public/app/src/domain/shopping.js');
  const items = [
    { name: 'במבה', done: true, cleared_at: '2026-11-01T10:00:00Z' }, { name: 'במבה', done: true, cleared_at: '2026-11-08T10:00:00Z' },
    { name: 'חלב', done: true, cleared_at: '2026-11-08T10:00:00Z' },
    { name: 'עגבניות', done: false, cleared_at: null }
  ];
  const four = suggestList({ items, people: 4 });
  assert.equal(four[0].name, 'במבה');
  assert.equal(four[0].why, 'קונים בדרך כלל');
  assert.ok(!four.some((x) => x.name === 'עגבניות'), 'already on the list');
  assert.ok(!four.some((x) => x.name === 'חלב 3%'), 'milk is already there from the usual list');
  assert.equal(four.find((x) => x.name === 'ביצים').qty, 'תבנית');
  assert.equal(four.find((x) => x.name === 'מלפפונים').qty, '2 ק״ג');
  assert.equal(four.find((x) => x.name === 'לחם').qty, '×2');
  assert.equal(four.find((x) => x.name === 'לחם').why, 'לפי 4 נפשות');
  const six = suggestList({ items: [], people: 6 });
  assert.equal(six.find((x) => x.name === 'ביצים').qty, '×2 תבניות');
  assert.equal(six.find((x) => x.name === 'חלב 3%').qty, '×6');
  assert.equal(suggestList({ people: 1 }).find((x) => x.name === 'חלב 3%').why, 'לפי נפש אחת');
  assert.equal(suggestList({ people: 1 }).find((x) => x.name === 'חזה עוף').aisle, 'meat');
});
