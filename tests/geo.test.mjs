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
  const later = Date.parse('2026-12-10T00:00:00Z');
  assert.equal(geo.needsPoint({ geo_q: q, lat: null, geo_at: '2026-12-01T00:00:00Z' }, q, later), false, 'not found nine days ago');
  assert.equal(geo.needsPoint({ geo_q: q, lat: null, geo_at: '2026-10-01T00:00:00Z' }, q, later), true, 'not found over 30 days ago');
  assert.equal(geo.needsPoint({ geo_q: q, lat: null, geo_at: '2026-11-25T11:00:00Z' }, q, now), true, 'missed before the fix: asked again');
  assert.equal(geo.needsPoint({}, null, now), false, 'no address to ask about');
});

const answer = (list, status = 200) => async () => ({ status, ok: status === 200, json: async () => list });

test('a map answer is believed only in Israel and near the branch settlement', async () => {
  const bs = place('2610');
  assert.deepEqual(await geo.lookUp(answer([{ lat: '31.751', lon: '34.991' }]), 'q', bs), { lat: 31.751, lon: 34.991 });
  assert.equal(await geo.lookUp(answer([{ lat: '32.08', lon: '34.78' }]), 'q', bs), null, 'the same street in Tel Aviv');
  assert.equal(await geo.lookUp(answer([]), 'q', bs), null);
  await assert.rejects(geo.lookUp(answer([], 429), 'q', bs), /answered 429/);
  await assert.rejects(geo.lookUp(answer([], 503), 'q', bs), /answered 503/, 'busy: stop, not "not found"');
});

test('branches are looked up one at a time, with a pause, up to the night limit; a refusal stops at once', async () => {
  const stores = [1, 2, 3].map((i) => S('x', String(i), 'סניף', 'הרצל ' + i, '2610'));
  const asked = [], saved = [], waits = [];
  const fetchFn = async (url) => { asked.push(url); return { status: 200, ok: true, json: async () => [{ lat: '31.75', lon: '34.99' }] }; };
  const r = await geo.locateStores(stores, { fetchFn, townOf: () => place('2610'), save: async (s, p, q) => saved.push([s.store_id, p, q]), max: 2, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(r, { asked: 2, found: 2, missed: 0, left: 1, error: null });
  assert.equal(asked.length, 2);
  assert.match(decodeURIComponent(asked[0]).replace(/\+/g, ' '), /countrycodes=il.*street=הרצל 1&city=בית שמש&country=ישראל/, 'street and city apart first');
  assert.deepEqual(waits, [1100], 'a pause between two requests');
  assert.deepEqual(saved.map((x) => x[0]), ['1', '2']);
  const refused = await geo.locateStores(stores, { fetchFn: answer([], 429), townOf: () => place('2610'), save: async () => {}, sleep: async () => {} });
  assert.equal(refused.asked, 1);
  assert.match(refused.error, /answered 429/);
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

test('a street as the chains write it, in the words the map knows', () => {
  assert.equal(geo.cleanStreet('שד.הרצל 20'), 'שדרות הרצל 20');
  assert.equal(geo.cleanStreet('ד.הים 14'), 'דרך הים 14');
  assert.equal(geo.cleanStreet("רח' הגפן 5"), 'הגפן 5');
  assert.equal(geo.cleanStreet('7 מול הדקל'), '7 הדקל');
  assert.equal(geo.cleanStreet('  הזית  3 ,  '), 'הזית 3');
  assert.equal(geo.cleanStreet('הדקל 12&#x0D;'), 'הדקל 12');
  assert.equal(geo.cleanStreet('הפסגה 39 39'), 'הפסגה 39');
  assert.equal(geo.cleanStreet('דרך האלון 0'), 'דרך האלון');
  assert.equal(geo.cleanStreet('דרך הערבה 4 ת.ד. 9113'), 'דרך הערבה 4');
});

test('when the street and city apart find nothing, the one-line address is tried, after a pause', async () => {
  const calls = [];
  let n = 0;
  const fetchFn = async (url) => { calls.push(url); n++; return { status: 200, ok: true, json: async () => (n === 1 ? [] : [{ lat: '31.75', lon: '34.99' }]) }; };
  const waits = [];
  const p = await geo.lookUp(fetchFn, 'הרצל 1, בית שמש, ישראל', place('2610'), S('x', '1', 'סניף', 'הרצל 1', '2610'), async () => waits.push(1));
  assert.deepEqual(p, { lat: 31.75, lon: 34.99 });
  assert.equal(calls.length, 2);
  assert.match(decodeURIComponent(calls[1]).replace(/\+/g, ' '), /&q=הרצל 1, בית שמש, ישראל$/);
  assert.deepEqual(waits, [1]);
});

test('a long run of misses is the service slowing us down: stop, and keep none of them', async () => {
  const stores = Array.from({ length: 30 }, (_, i) => S('x', String(i), 'סניף', 'הרצל ' + (i + 1), '2610'));
  const saved = [];
  const r = await geo.locateStores(stores, { fetchFn: answer([]), townOf: () => place('2610'), save: async (s, p) => saved.push([s.store_id, p]), streak: 5, sleep: async () => {} });
  assert.equal(r.asked, 5);
  assert.match(r.error, /5 misses in a row/);
  assert.deepEqual(saved, [], 'not marked "not found"');
  assert.equal(r.left, 30);
});

test('a few misses between finds are kept as not found', async () => {
  const stores = [1, 2, 3].map((i) => S('x', String(i), 'סניף', 'הרצל ' + i, '2610'));
  let n = 0;
  // Branch 2: nothing, both ways. Branches 1 and 3: found at once.
  const fetchFn = async () => { n++; return { status: 200, ok: true, json: async () => (n === 2 || n === 3 ? [] : [{ lat: '31.75', lon: '34.99' }]) }; };
  const saved = [];
  const r = await geo.locateStores(stores, { fetchFn, townOf: () => place('2610'), save: async (s, p) => saved.push([s.store_id, p ? 'found' : 'missed']), sleep: async () => {} });
  assert.deepEqual(saved, [['1', 'found'], ['2', 'missed'], ['3', 'found']]);
  assert.deepEqual(r, { asked: 3, found: 2, missed: 1, left: 0, error: null });
});

test('a branch in no settlement shows its distance only', () => {
  assert.equal(storeWhy({ kind: 'near', km: 3.4, city: '' }), '3.4 ק"מ');
  assert.equal(storeWhy({ kind: 'near', km: 3, city: 'צרעה' }), 'צרעה, 3 ק"מ');
});
