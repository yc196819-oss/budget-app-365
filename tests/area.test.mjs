import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { place, placeByName, suggest, storePlace, km, nearestStores } = createRequire(import.meta.url)('../server/area.js');

// Made-up branches, at real settlement numbers.
const S = (chain, store_id, name, address, city) => ({ chain, chain_name: chain, store_id, name, address, city });

test('settlements by number and by name, with the ones the old data had no place for', () => {
  assert.equal(place('3000').name, 'ירושלים');
  assert.equal(placeByName('בית שמש').code, '2610');
  assert.ok(Math.abs(place('3780').lat - 31.7) < 0.1, 'ביתר עילית is where it is, not in the Negev');
  assert.ok(Math.abs(place('3616').lon - 35.31) < 0.05, 'מעלה אדומים too');
  assert.deepEqual(suggest('בית ש').map((p) => p.name).slice(0, 1), ['בית שמש']);
  assert.deepEqual(suggest('ב'), [], 'two letters at least');
  assert.ok(km(place('3000'), place('2610')) > 15 && km(place('3000'), place('2610')) < 35);
});

test('where a branch is: its settlement number, or a settlement named in its name or address', () => {
  assert.equal(storePlace(S('a', '1', 'סניף', 'רחוב 1', '6100')).name, 'בני ברק');
  assert.equal(storePlace(S('a', '2', 'אשדוד', 'זבוטינסקי 27', '0')).name, 'אשדוד');
  assert.equal(storePlace(S('a', '3', 'סניף מרכז', 'הרצל 5, כפר סבא', '0')).name, 'כפר סבא');
  assert.equal(storePlace(S('a', '4', 'חברה ראשית', 'unknown', '0')), null);
});

test('for each chain, the branch for this home: in the neighborhood, in the settlement, or the nearest within reach', () => {
  const stores = [
    S('x', '1', 'סניף העיר הוותיקה', 'הרצל 1', '2610'),
    S('x', '2', 'סניף רמת בית שמש', 'נחל דולב 4, רמת בית שמש', '2610'),
    S('y', '7', 'סניף מרכז', 'יגאל אלון 3', '2610'),
    S('z', '3', 'ירושלים', 'יפו 1', '3000'),
    S('far', '9', 'אילת', 'התמרים 1', '2600')
  ];
  const r = nearestStores(stores, { code: '2610', hood: 'רמת בית שמש' });
  const by = Object.fromEntries(r.map((x) => [x.chain, x]));
  assert.equal(by.x.store_id, '2', 'the branch in the neighborhood');
  assert.equal(by.x.kind, 'hood');
  assert.equal(by.y.kind, 'city');
  assert.equal(by.z.kind, 'near', 'no branch in Beit Shemesh: the one in Jerusalem, about 23 km away');
  assert.ok(by.z.km > 20 && by.z.km < 25);
  assert.equal(nearestStores(stores, { code: '2610' }, { maxKm: 15 }).find((x) => x.chain === 'z'), undefined, 'beyond reach: left out');
  assert.equal(by.far, undefined, 'too far: left out');
  assert.equal(nearestStores(stores, { code: '2610' }).find((x) => x.chain === 'x').store_id, '1', 'no neighborhood: the first in the settlement');
  assert.deepEqual(nearestStores(stores, { code: '999999' }), []);
});
