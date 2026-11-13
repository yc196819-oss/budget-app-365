import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CERTS, NOT_KOSHER, certFromText, certOf, certLevel, isCert, nonFood, allowed, choose } from '../public/app/src/domain/prices.js';

// Made-up products and prices.
const p = (barcode, name, price, kosher = {}) => ({ barcode, name, qty: 1, unit: 'ליטר', offers: [{ chain: 'x', price }], kosher });

test('the certifier a label or a name speaks of, the most specific first', () => {
  assert.equal(certFromText('he:בהשגחת הבדץ העדה החרדית'), 'בד"ץ העדה החרדית');
  assert.equal(certFromText('כשר למהדרין בהשגחת הרבנות צפת'), 'רבנות מהדרין');
  assert.equal(certFromText('בהשגחת הרבנות הראשית'), 'רבנות');
  assert.equal(certFromText('he:בד״ץ רובין'), 'הרב רובין');
  assert.equal(certFromText('en:kosher'), null, 'just "kosher" says nothing about who');
  assert.equal(certLevel('רבנות'), 'regular');
  assert.equal(certLevel('הרב לנדא'), 'mehadrin');
  assert.equal(certLevel(NOT_KOSHER), 'none');
  assert.ok(isCert(NOT_KOSHER) && !isCert('המצאה'));
  assert.equal(new Set(CERTS.map((c) => c.name)).size, CERTS.length);
});

test('a product\'s certifier: the owner first, then most families, then the open database', () => {
  assert.equal(certOf(p('1', 'חלב', 6, { owner_cert: 'הרב לנדא', certs: { רבנות: 5 }, open: 'רבנות' })).by, 'owner');
  assert.deepEqual(certOf(p('1', 'חלב', 6, { certs: { רבנות: 1, 'בד"ץ בית יוסף': 3 }, open: 'רבנות' })), { cert: 'בד"ץ בית יוסף', by: 'families', n: 3 });
  assert.deepEqual(certOf(p('1', 'חלב', 6, { open: 'רבנות' })), { cert: 'רבנות', by: 'open', n: 0 });
  assert.equal(certOf(p('1', 'חלב מהדרין בד"ץ', 6)), null, 'a word in the name is not a confirmation');
  assert.equal(certOf(p('1', 'חלב', 6, { certs: { 'משהו אחר': 9 } })), null, 'only certifiers from the list');
});

test('the family\'s certifiers decide what is chosen by itself; non-food needs none', () => {
  const mine = ['בד"ץ העדה החרדית', 'הרב לנדא'];
  const a = p('1', 'חלב 3% בשקית', 6.2, { certs: { 'בד"ץ העדה החרדית': 2 } });
  const b = p('2', 'חלב 3% קרטון', 5.5, { open: 'רבנות מהדרין' });
  const c = p('3', 'חלב 3% בקבוק', 4.9, { certs: { [NOT_KOSHER]: 1 } });
  const unknown = p('4', 'חלב 3% טרי', 4.5);
  assert.ok(allowed(a, mine));
  assert.ok(!allowed(b, mine), 'a certifier they do not rely on');
  assert.ok(!allowed(c, [...mine, NOT_KOSHER]), 'never "not kosher"');
  assert.ok(!allowed(unknown, mine), 'unknown is not chosen by itself');
  assert.ok(allowed(unknown, []), 'no certifiers picked: no preference');
  const r = choose('חלב 3%', [a, b, c, unknown], mine);
  assert.equal(r.status, 'auto');
  assert.equal(r.pick.barcode, '1', 'the cheapest they rely on, though others are cheaper');
  // Nothing confirmed: the unknown one is priced, marked unverified (never
  // the one known to have another kashrut); strict households wait instead.
  const u = choose('חלב 3%', [b, unknown], mine);
  assert.equal(u.status, 'unverified');
  assert.equal(u.pick.barcode, '4');
  assert.equal(choose('חלב 3%', [b, unknown], mine, { strict: true }).status, 'unsure');
  assert.equal(choose('חלב 3%', [b, c], mine).status, 'unsure', 'only other or no kashrut: nothing picked');
  // Non-food: chosen at any certifier.
  assert.ok(nonFood({ name: 'נוזל כלים לימון 750 מ"ל' }));
  assert.ok(!nonFood({ name: 'לימון' }));
  assert.ok(allowed(p('5', 'ספוג לכלים', 9.9), mine));
  // The old levels still work.
  assert.ok(allowed(p('6', 'חלב', 5, { owner: 'mehadrin' }), 'mehadrin'));
});

test('with the family\'s area: only the chains with a branch near it, and the branch shows with the total', async () => {
  const { nearby, basket, choose } = await import('../public/app/src/domain/prices.js');
  const milk = { barcode: '1', name: 'חלב 3%', qty: 1, unit: 'ליטר', kosher: {}, offers: [{ chain: 'x', chain_name: 'רשת א', price: 6.4, store: 'סניף בדוי', local: true }, { chain: 'y', chain_name: 'רשת ב', price: 5.9, local: false }] };
  const cat = { 'חלב 3%': [milk] };
  assert.equal(nearby(cat, false), cat, 'no area: everything, as before');
  const near = nearby(cat, true);
  assert.deepEqual(near['חלב 3%'][0].offers.map((o) => o.chain), ['x'], 'the far chain is left out');
  const b = basket([choose('חלב 3%', near['חלב 3%'], 'any')]);
  assert.deepEqual(b.map(({ lines, ...r }) => r), [{ chain: 'x', name: 'רשת א', store: 'סניף בדוי', total: 6.4, missing: 0, swaps: 0 }]);
});
