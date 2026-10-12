import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTrips, tripSummary, tripName, category, placeOf, planBudget, savingPlan, isPrep } from '../public/app/src/domain/trips.js';
import { SAMPLE } from './fixtures/trip-sample.mjs';

test('the trip is found with what was booked ahead, and nothing at home is in it', () => {
  const trips = detectTrips(SAMPLE);
  assert.equal(trips.length, 1);
  const tr = trips[0];
  assert.equal(tr.country, 'רומניה');
  assert.equal(tripName(tr), 'חופשה ברומניה 2026');
  assert.deepEqual([tr.start, tr.end], ['2026-10-03', '2026-10-08']);
  const names = tr.items.map((t) => t.description).join('|');
  for (const w of ['WIZZ', 'BOOKING', 'AIRBNB', 'ביטוח נסיעות', 'JAMES RICHARDSON', 'עמלת המרה']) assert.ok(names.includes(w), w);
  for (const w of ['שופרסל', 'ארומה', 'נטפליקס', 'סונול']) assert.ok(!names.includes(w), w);
  const s = tripSummary(tr, 2);
  assert.equal(s.days, 6);
  assert.equal(s.by.flights, 1380);
  assert.equal(s.by.lodging, 3300);
});

test('a Latin name next to a day abroad counts as abroad (a shop in a small town); online services do not', () => {
  const t = (id, tx_date, description, amount = 50) => ({ id, tx_date, description, amount, type: 'expense' });
  const txs = [
    t('a', '2026-05-01', 'KAUFLAND BRASOV RO'), t('b', '2026-05-02', 'PEPCO CORBEANCA'), t('c', '2026-05-02', 'PENNY RAMNICU VALCEA'),
    t('d', '2026-05-03', 'MEGA IMAGE BUCURESTI'), t('e', '2026-05-02', 'NETFLIX.COM'), t('f', '2026-05-02', 'IWATCH (תשלום 3 מתוך 3)'),
    t('g', '2026-06-20', 'ZARA RAMAT AVIV'), t('h', '2026-05-15', 'ALIEXPRESS')
  ];
  const [tr] = detectTrips(txs);
  assert.deepEqual(tr.items.map((x) => x.id).sort(), ['a', 'b', 'c', 'd']);
  assert.equal(placeOf({ description: 'NETFLIX.COM AMSTERDAM' }), null);
});

test('flights and lodging are linked up to 120 days ahead, airport and duty free only around the trip', () => {
  const t = (id, tx_date, description, amount = 100) => ({ id, tx_date, description, amount, type: 'expense' });
  const txs = [
    t('fl', '2026-03-01', 'MYTRIP_123'), t('car', '2026-04-28', 'C24 MIETWAGEN'), t('old', '2026-02-01', 'אלונית נתב"ג'),
    t('df', '2026-05-01', 'ג א ר היינמן טרמינל'), t('tr', '2026-05-04', 'רכבת ישראל - נמל תעופה'),
    t('a', '2026-05-01', 'KAUFLAND BRASOV RO'), t('b', '2026-05-02', 'OMV BRASOV'), t('c', '2026-05-03', 'BOLT BUCURESTI')
  ];
  const [tr] = detectTrips(txs);
  const ids = tr.items.map((x) => x.id);
  for (const id of ['fl', 'car', 'df', 'tr']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('old'), 'an airport line from months before is another day out');
  assert.equal(isPrep('C24 MIETWAGEN'), true);
});

test('trips already saved or dismissed are not offered again', () => {
  const tr = detectTrips(SAMPLE)[0];
  assert.deepEqual(detectTrips(SAMPLE, { skip: new Set(tr.items.map((t) => t.id)) }), []);
});

test('categories: by name first, then by the household\'s own category', () => {
  assert.equal(category('BOLT.EU BUCURESTI RO'), 'transport');
  assert.equal(category('THERME NORD BUCURESTI'), 'attractions');
  assert.equal(category('HEINEMANN DUTY FREE OTOPENI RO'), 'shopping');
  assert.equal(category('A1 STANGA COMULIESTI'), 'other');
  assert.equal(category('A1 STANGA COMULIESTI', 'דלק'), 'transport');
  assert.equal(category('AMSTERDAM DISTRICT', 'מסעדות ואוכל בחוץ'), 'food');
});

test('budget for the next trip: fare per person, percentages per line, and the monthly saving', () => {
  const base = tripSummary(detectTrips(SAMPLE)[0], 2);
  const plain = planBudget(base, { days: 6, people: 2 });
  assert.ok(Math.abs(plain.total - base.total) < 400);
  const p = planBudget(base, { days: 6, people: 2, level: 'cheaper', adjust: { flightsPerPerson: 3200, pct: { lodging: 60 } } });
  assert.equal(p.lines.flights, 6400);
  assert.equal(p.lines.lodging, Math.round(plain.lines.lodging * 1.6 / 50) * 50);
  assert.ok(p.lines.food < plain.lines.food);
  assert.deepEqual(savingPlan(9000, '2027-04-10', new Date(2026, 9, 11)).monthly, 1500);
});

import { pastRates, adjustFromEstimate, planFromEstimate, savingCapacity, readyMonth } from '../public/app/src/domain/trips.js';

const EST = { flight_per_person: { low: 2800, typical: 3400, high: 4200 }, lodging_per_night: { low: 700, typical: 900, high: 1400 }, percent_vs_past: { food: 70, transport: 60 }, daily_per_person_local: 100 };

test('the advisor\'s estimate becomes plan adjustments: the fare and the night, percentages for the rest', () => {
  const base = tripSummary(detectTrips(SAMPLE)[0], 2);
  const r = pastRates(base);
  assert.equal(r.lodging_per_night, 660);
  const adj = adjustFromEstimate(EST);
  assert.equal(adj.flightsPerPerson, 3400);
  assert.equal(adj.lodgingPerNight, 900);
  assert.equal(adj.pct.food, 70);
  const plan = planBudget(base, { days: 6, people: 2, adjust: adj });
  assert.equal(plan.lines.flights, 6800);
  assert.equal(plan.lines.lodging, 4500, '5 nights × ₪900');
});

test('with no past trip the plan comes straight from the estimate, the daily spend converted from the local currency', () => {
  const p = planFromEstimate(EST, { days: 5, people: 2 }, 3.7);
  assert.equal(p.lines.flights, 6800);
  assert.equal(p.lines.lodging, 3600);
  assert.equal(p.lines.food, Math.round(100 * 3.7 * 0.45 * 5 * 2 / 50) * 50);
});

test('what can be saved each month, and when the trip is affordable', () => {
  assert.equal(savingCapacity({ income: 20000, fixed: 9000, variable: 8000 }), 1500);
  assert.equal(savingCapacity({ income: 9000, fixed: 9000, variable: 500 }), 0);
  assert.equal(readyMonth(9000, 1500, new Date(2026, 9, 12)), '2027-04');
  assert.equal(readyMonth(9000, 0, new Date(2026, 9, 12)), null);
});
