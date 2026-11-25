import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const geo = require('../server/geo.js');
const { place, nearestStores, reachCounts } = require('../server/area.js');
import { roundHome as roundOnPhone, wazeLink, storeWhy, areaReach } from '../public/app/src/domain/prices.js';

// Made-up branches and addresses, at real settlement numbers.
const S = (chain, store_id, name, address, city, pt) => ({ chain, chain_name: chain, store_id, name, address, city, ...(pt || {}) });

test('a family location is kept only rounded to 0.005 degrees (about 500 m), on the phone and on the server alike', () => {
  for (const f of [geo.roundHome, roundOnPhone]) {
    assert.deepEqual(f(31.74631, 34.98872), { lat: 31.745, lon: 34.99 });
    assert.deepEqual(f('31.7488', '34.9874'), { lat: 31.75, lon: 34.985 });
    assert.equal(f(40.7, -74), null, 'outside Israel: none');
    assert.equal(f('abc', 35), null);
  }
});

test('what is asked of the map service: the street address and its settlement, never without a real address', () => {
  const bs = place('2610');
  assert.equal(geo.geoQuery(S('x', '1', 'סניף', 'הרצל 10', '2610'), bs), 'הרצל 10, בית שמש, ישראל');
  assert.equal(geo.geoQuery(S('x', '1', 'סניף', 'הרצל 10 בית שמש', '2610'), bs), 'הרצל 10 בית שמש, ישראל', 'the settlement said once');
  assert.equal(geo.geoQuery(S('x', '1', 'סניף', 'unknown', '2610'), bs), null);
  assert.equal(geo.geoQuery(S('x', '1', 'סניף', '12', '2610'), bs), null, 'a number alone is no address');
  assert.equal(geo.geoQuery(S('x', '1', 'סניף', 'הרצל 10', '0'), null), null, 'no settlement: not asked');
});

test('a branch is looked up again only for a new address, or 30 days after it was not found', () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const q = 'הרצל 10, בית שמש, ישראל';
  assert.equal(geo.needsPoint({}, q, now), true, 'never asked');
  assert.equal(geo.needsPoint({ geo_q: q, lat: 31.7, lon: 35 }, q, now), false, 'found');
  assert.equal(geo.needsPoint({ geo_q: 'הרצל 8, בית שמש, ישראל', lat: 31.7, lon: 35 }, q, now), true, 'the address changed');
  assert.equal(geo.needsPoint({ geo_q: q, lat: null, geo_at: '2026-11-10T00:00:00Z' }, q, now), false, 'not found two weeks ago');
  assert.equal(geo.needsPoint({ geo_q: q, lat: null, geo_at: '2026-10-01T00:00:00Z' }, q, now), true, 'not found over 30 days ago');
  assert.equal(geo.needsPoint({}, null, now), false, 'no address to ask about');
});

const answer = (list, status = 200) => async () => ({ status, ok: status === 200, json: async () => list });

test('a map answer is believed only in Israel and near the branch settlement', async () => {
  const bs = place('2610');
  assert.deepEqual(await geo.lookUp(answer([{ lat: '31.751', lon: '34.991' }]), 'q', bs), { lat: 31.751, lon: 34.991 });
  assert.equal(await geo.lookUp(answer([{ lat: '32.08', lon: '34.78' }]), 'q', bs), null, 'the same street in Tel Aviv');
  assert.equal(await geo.lookUp(answer([]), 'q', bs), null);
  await assert.rejects(geo.lookUp(answer([], 429), 'q', bs), /refused/);
});

test('branches are looked up one at a time, with a pause, up to the night limit; a refusal stops at once', async () => {
  const stores = [1, 2, 3].map((i) => S('x', String(i), 'סניף', 'הרצל ' + i, '2610'));
  const asked = [], saved = [], waits = [];
  const fetchFn = async (url) => { asked.push(url); return { status: 200, ok: true, json: async () => [{ lat: '31.75', lon: '34.99' }] }; };
  const r = await geo.locateStores(stores, { fetchFn, townOf: () => place('2610'), save: async (s, p, q) => saved.push([s.store_id, p, q]), max: 2, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(r, { asked: 2, found: 2, left: 1, error: null });
  assert.equal(asked.length, 2);
  assert.match(decodeURIComponent(asked[0]), /countrycodes=il.*q=הרצל 1, בית שמש, ישראל/);
  assert.deepEqual(waits, [1100], 'a pause between two requests');
  assert.deepEqual(saved.map((x) => x[0]), ['1', '2']);
  const refused = await geo.locateStores(stores, { fetchFn: answer([], 429), townOf: () => place('2610'), save: async () => {}, sleep: async () => {} });
  assert.equal(refused.asked, 1);
  assert.match(refused.error, /refused/);
  assert.equal(refused.left, 3);
});

test('the request says who we are, with no personal details', () => {
  assert.match(geo.AGENT, /^BudgetApp\/1\.0/);
  assert.doesNotMatch(geo.AGENT, /@/);
});

test('"use my location": the settlement nearest the point', () => {
  const { places } = require('../server/data/places.json');
  assert.equal(geo.placeAt(31.745, 34.99, places).code, '2610');
  assert.equal(geo.placeAt(29.0, 30.0, places), null, 'nothing within 15 km');
});

test('from the family location: the branch really nearest, by its own point', () => {
  const home = { code: '2610', lat: 31.745, lon: 34.99 };
  const stores = [
    S('x', '1', 'סניף רחוק בעיר', 'א 1', '2610', { lat: 31.72, lon: 34.96 }),
    S('x', '9', 'סניף קרוב', 'ב 2', '2610', { lat: 31.746, lon: 34.991 }),
    S('y', '3', 'צרעה', 'ג 3', '567'),
    S('z', '4', 'ירושלים', 'ד 4', '3000', { lat: 31.78, lon: 35.21 })
  ];
  const r = Object.fromEntries(nearestStores(stores, home, { maxKm: 5 }).map((x) => [x.chain, x]));
  assert.equal(r.x.store_id, '9', 'the nearer branch, not the lowest number');
  assert.equal(r.x.kind, 'city');
  assert.ok(r.x.km > 0 && r.x.km < 0.5, 'a real distance in the settlement too');
  assert.deepEqual([r.x.lat, r.x.lon], [31.746, 34.991], 'its point, for Waze');
  assert.equal(r.y.kind, 'near', 'Tzora, from its center (no point yet)');
  assert.equal(r.z, undefined, 'Jerusalem is far');
  // Without the family location: as before.
  assert.equal(nearestStores(stores, { code: '2610' }, { maxKm: 5 }).find((x) => x.chain === 'x').store_id, '1');
  // In the settlement it counts at every distance.
  assert.equal(reachCounts(stores, home)[0], 1);
});

test('on the screen: from your location, the distance in your settlement, and Waze to the point', () => {
  assert.equal(areaReach({ city: 'בית שמש', max_km: 5, lat: 31.745, lon: 34.99, stores: [] }), 'מחפשים מהמיקום שלכם, עד 5 ק"מ · אין סניף של אף רשת');
  assert.equal(storeWhy({ kind: 'city', km: 1.2, city: 'בית שמש' }), 'ביישוב שלכם, 1.2 ק"מ');
  assert.equal(storeWhy({ kind: 'city', km: 0, city: 'בית שמש' }), 'ביישוב שלכם');
  assert.equal(wazeLink({ name: 'סניף', address: 'הרצל 1', city: 'בית שמש', lat: 31.746, lon: 34.991 }), 'https://waze.com/ul?ll=31.746,34.991&navigate=yes');
});
