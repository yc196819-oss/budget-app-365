const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanRequest, estimatePrompt, pickEstimate } = require('../server/trips');

test('the request is bounded and needs a destination', () => {
  assert.equal(cleanRequest({}), null);
  const r = cleanRequest({ destination: '  ניו   יורק ', month: '2027-04', days: 500, travelers: 0, past: { country: 'רומניה', days: 6, travelers: 2, flight_per_person: 1133, lodging_per_night: 300, per_person_per_day: { food: 90, junk: 5 } } });
  assert.equal(r.destination, 'ניו יורק');
  assert.equal(r.days, 60);
  assert.equal(r.travelers, 1, 'at least one traveler');
  assert.deepEqual(r.past.per_person_per_day, { food: 90, transport: 0, attractions: 0, shopping: 0, other: 0 });
  assert.equal(cleanRequest({ destination: 'x', month: '2027-13' }).month, null);
});

test('the prompt carries the past trip and asks for JSON', () => {
  const p = estimatePrompt(cleanRequest({ destination: 'יוון', month: '2027-06', days: 5, travelers: 4, past: { country: 'רומניה', days: 6, travelers: 2, flight_per_person: 1133 } }), '2026-10-12');
  assert.match(p, /יעד: יוון/);
  assert.match(p, /רומניה, 6 ימים/);
  assert.match(p, /אין לך מחירים חיים/);
  assert.match(p, /"percent_vs_past"/);
});

test('the answer is cleaned: ranges, percentages, months in the future only', () => {
  const e = pickEstimate({
    destination: 'ניו יורק', country: 'ארה״ב', currency: 'USD',
    flight_per_person: { low: 2800, high: 4200 }, lodging_per_night: { low: 700, typical: 950, high: 1400 },
    percent_vs_past: { food: 140, transport: 900, attractions: 'x' }, daily_per_person_local: 120.4,
    season: 'shoulder', cheaper_months: ['2026-09', '2027-02', 'bad'], tips: ['MetroCard שבועי', '', 'x'], confidence: 'sure'
  }, '2026-10-12');
  assert.deepEqual(e.flight_per_person, { low: 2800, typical: 3500, high: 4200 });
  assert.deepEqual(e.percent_vs_past, { food: 140, transport: 300 });
  assert.deepEqual(e.cheaper_months, ['2027-02']);
  assert.deepEqual(e.tips, ['MetroCard שבועי', 'x']);
  assert.equal(e.confidence, 'medium');
  assert.equal(e.daily_per_person_local, 120);
  assert.equal(pickEstimate({ flight_per_person: {}, lodging_per_night: { typical: 500 } }, '2026-10-12'), null);
  assert.equal(pickEstimate(null), null);
});
