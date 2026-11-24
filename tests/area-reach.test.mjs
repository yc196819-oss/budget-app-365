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
