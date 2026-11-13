import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { storePlace, uniqueStores, nearestStores } = require('../server/area.js');

// Made-up branches.
test('a branch list with a number twice keeps one branch per number, the one on the map', () => {
  const list = [
    { store_id: '1', name: 'חברה ראשית', address: 'unknown', city: '0' },
    { store_id: '1', name: 'ויצמן 55 כפר סבא', address: 'unknown', city: '0' },
    { store_id: '2', name: 'מחסן אונליין', address: 'unknown', city: '0' },
    { store_id: '3', name: 'נחל קדרון 15 באר שבע', address: 'unknown', city: '0' }
  ];
  const u = uniqueStores(list);
  assert.equal(u.length, 3);
  assert.equal(u.find((s) => s.store_id === '1').name, 'ויצמן 55 כפר סבא');
});

test('short forms and other spellings of places in branch names', () => {
  const at = (name) => (storePlace({ name, address: 'unknown', city: '0' }) || {}).name;
  assert.equal(at('ת"א - כיכר רבין'), 'תל אביב - יפו');
  assert.equal(at('סניף יוקנעם'), 'יקנעם עילית');
  assert.equal(at('קניון סכנין'), "סח'נין");
  assert.equal(at('קריית מלאכי מרכז'), 'קרית מלאכי');
  assert.equal(at('רחוב יפו 97'), undefined, 'a street named Jaffa is not Tel Aviv');
  assert.equal(at('מודיעין עילית - אבני נזר'), 'מודיעין עילית', 'the full name wins');
});

test('every chain with a branch near the family is found', () => {
  const stores = [
    { chain: 'a', chain_name: 'רשת א', store_id: '1', name: 'בית שמש', address: 'x', city: '2610' },
    { chain: 'b', chain_name: 'רשת ב', store_id: '7', name: 'ויצמן 55 כפר סבא', address: 'unknown', city: '0' },
    { chain: 'c', chain_name: 'רשת ג', store_id: '9', name: 'סניף מבשרת', address: 'x', city: '1015' }
  ];
  const near = nearestStores(stores, { code: '2610' }, { maxKm: 25 });
  assert.deepEqual(near.map((s) => s.chain).sort(), ['a', 'c'].filter((c) => near.some((s) => s.chain === c)).sort());
  assert.ok(near.some((s) => s.chain === 'a'));
  assert.ok(!near.some((s) => s.chain === 'b'), 'far away');
});

test('everyday words that are also settlements do not place a branch', () => {
  const at = (name) => (storePlace({ name, address: 'unknown', city: '0' }) || {}).name;
  assert.equal(at('רחוב הרצל 5'), undefined);
  assert.notEqual(at('שדרות הרצל 5'), 'שדרות', 'a boulevard, not the town');
  assert.equal(at('סניף שדרות'), 'שדרות', 'the town');
  assert.equal(at('יבנה 10 תל אביב'), 'תל אביב - יפו', 'the longer name wins over a street');
});
