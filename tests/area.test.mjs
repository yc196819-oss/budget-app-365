import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { place, placeByName, suggest, storePlace, branchPlace, km, reachKm, nearestStores, reachCounts } = createRequire(import.meta.url)('../server/area.js');

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
  const r = nearestStores(stores, { code: '2610', hood: 'רמת בית שמש' }, { maxKm: 25 });
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
  assert.equal(nearestStores(stores, { code: '2610' }).find((x) => x.chain === 'z'), undefined, '5 km unless said: Jerusalem is out');
  assert.deepEqual(nearestStores(stores, { code: '2610' }, { maxKm: 0 }).map((x) => x.kind), ['city', 'city'], '0 km: the settlement only');
});

test('how far the family goes: 0 to 10 km, 5 unless said, older saves of up to 50 km as 10', () => {
  assert.equal(reachKm(undefined), 5);
  assert.equal(reachKm(null), 5);
  assert.equal(reachKm(0), 0);
  assert.equal(reachKm('7'), 7);
  assert.equal(reachKm(25), 10);
  assert.equal(reachKm(-3), 0);
  assert.equal(reachKm('abc'), 5);
});

test('how many chains at each distance, 0 to 10 km', () => {
  const stores = [
    S('x', '1', 'סניף', 'הרצל 1', '2610'),
    S('y', '2', 'צרעה', 'הרצל 3', '567'),
    S('z', '3', 'כפר אוריה', 'הגפן 1', '364'),
    S('w', '4', 'ירושלים', 'יפו 1', '3000')
  ];
  // Beit Shemesh itself; Tzora about 2.6 km; Kfar Uria about 6.5 km; Jerusalem about 23 km, never.
  assert.deepEqual(reachCounts(stores, { code: '2610' }), [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
});

test('settlements that were far from where they are: Hebron, Kiryat Arba, Ofra, Karne Shomron, Tamra', () => {
  const near = (code, lat, lon) => assert.ok(km(place(code), { lat, lon }) < 3, place(code).name + ' at ' + place(code).lat + ',' + place(code).lon);
  near('3400', 31.53, 35.095);
  near('3611', 31.53, 35.12);
  near('3617', 31.956, 35.26);
  near('3640', 32.17, 35.1);
  near('8900', 32.853, 35.198);
});

test('a branch whose own point is far from the settlement in its name is in no settlement: it counts by distance', () => {
  // A Tel Aviv street named after a settlement (made-up branch).
  const street = { ...S('x', '1', 'סניף', 'חשמונאים 99', '0'), lat: 32.0697, lon: 34.7842 };
  assert.equal(storePlace(street).name, 'חשמונאים', 'looked up on the map as before');
  const p = branchPlace(street);
  assert.equal(p.code, null);
  assert.equal(p.name, 'תל אביב - יפו', 'named after the settlement around it');
  // Near its settlement, or with no point: as before.
  assert.equal(branchPlace({ ...S('x', '2', 'סניף', 'הרצל 1', '2610'), lat: 31.75, lon: 34.99 }).code, '2610');
  assert.equal(branchPlace(S('x', '3', 'סניף', 'הרצל 1', '2610')).code, '2610');
  // At a junction far from every center: no name, only its distance.
  assert.equal(branchPlace({ ...S('x', '4', 'תחנה', 'צומת', '0'), lat: 30.79, lon: 34.77 }).name, '');
  // Families in Hashmonaim no longer get the Tel Aviv branch as "in your settlement".
  assert.deepEqual(nearestStores([street], { code: '3770' }, { maxKm: 5 }), []);
  const ta = nearestStores([street], { code: '5000' }, { maxKm: 5 })[0];
  assert.equal(ta.kind, 'near');
  assert.ok(ta.km < 5);
});
