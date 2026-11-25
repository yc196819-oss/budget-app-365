import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaReach, storeWhy, reachKm } from '../public/app/src/domain/prices.js';

// Made-up area and branches.
const S = (kind, km, city = 'בית שמש') => ({ chain: 'x', chain_name: 'רשת א', name: 'סניף בדוי', city, km, kind });

test('the area line says where the search starts, how far it goes, and how many branches', () => {
  assert.equal(areaReach({ city: 'בית שמש', max_km: 10, stores: [S('city', 0), S('near', 8)] }), 'מחפשים ממרכז בית שמש, עד 10 ק"מ · 2 סניפים');
  assert.equal(areaReach({ city: 'בית שמש', stores: [S('hood', 0)] }), 'מחפשים ממרכז בית שמש, עד 5 ק"מ · סניף אחד', '5 km when none was saved');
  assert.equal(areaReach({ city: 'בית שמש', max_km: 25, stores: [S('hood', 0)] }), 'מחפשים ממרכז בית שמש, עד 10 ק"מ · סניף אחד', 'an older save of 25 km counts as 10');
  assert.equal(areaReach({ city: 'בית שמש', max_km: 0, stores: [S('city', 0)] }), 'מחפשים רק בתוך בית שמש · סניף אחד');
  assert.equal(reachKm(undefined), 5);
  assert.equal(areaReach({ city: 'בית שמש', max_km: 5, stores: [] }), 'מחפשים ממרכז בית שמש, עד 5 ק"מ · אין סניף של אף רשת');
});

test('why each branch was chosen', () => {
  assert.equal(storeWhy(S('hood', 0)), 'בשכונה שלכם');
  assert.equal(storeWhy(S('city', 0)), 'ביישוב שלכם');
  assert.equal(storeWhy(S('near', 22.8, 'ירושלים')), 'ירושלים, 22.8 ק"מ');
  assert.equal(storeWhy(S('near', 12, 'ירושלים')), 'ירושלים, 12 ק"מ');
});

test('the Waze link: by the street address and settlement, or the branch name when there is no address', async () => {
  const { wazeLink } = await import('../public/app/src/domain/prices.js');
  assert.equal(wazeLink({ name: 'סניף מרכז', address: 'הרצל 10', city: 'בית שמש' }), 'https://waze.com/ul?q=' + encodeURIComponent('הרצל 10, בית שמש') + '&navigate=yes');
  assert.equal(wazeLink({ name: 'סניף מרכז', address: 'unknown', city: 'בית שמש' }), 'https://waze.com/ul?q=' + encodeURIComponent('סניף מרכז, בית שמש') + '&navigate=yes');
  assert.equal(wazeLink({ name: 'סניף מרכז', address: null, city: '' }), 'https://waze.com/ul?q=' + encodeURIComponent('סניף מרכז') + '&navigate=yes');
});

test('the distance picker says how many chains at the chosen distance, and at 10 km when more', async () => {
  const { reachText } = await import('../public/app/src/domain/prices.js');
  const counts = [8, 8, 8, 14, 14, 18, 18, 18, 18, 19, 19];
  assert.equal(reachText(counts, 5), 'עד 5 ק"מ: 18 רשתות (עד 10 ק"מ: 19 רשתות).');
  assert.equal(reachText(counts, 10), 'עד 10 ק"מ: 19 רשתות.');
  assert.equal(reachText(counts, 0), 'ביישוב עצמו: 8 רשתות (עד 10 ק"מ: 19 רשתות).');
  assert.equal(reachText([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 3), 'עד 3 ק"מ: רשת אחת.');
  assert.equal(reachText(null, 5), '');
});
