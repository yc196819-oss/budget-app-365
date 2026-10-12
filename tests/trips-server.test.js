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

const { cleanChat, chatPrompt, pickChat } = require('../server/trips');

test('the chat request needs a message and keeps only known context', () => {
  assert.equal(cleanChat({}), null);
  const r = cleanChat({ message: ' בפריז   אנחנו אצל אחי ', history: Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'ai' : 'x', text: 'm' + i })),
    context: { destination: 'פריז', month: '2027-05', days: 7, travelers: 3, lines: { lodging: 4500, casino: 5 }, prefs: { skip: ['lodging', 'nope'], covered: { food: 'all', flights: 'x' }, pct: { food: -500 }, funding: 2000, notes: ['א'] }, estimate: { flight: 1800, currency: 'eur' } } });
  assert.equal(r.message, 'בפריז אנחנו אצל אחי');
  assert.equal(r.history.length, 10);
  assert.equal(r.history[0].role, 'me');
  assert.deepEqual(r.context.lines, { lodging: 4500 });
  assert.deepEqual(r.context.prefs.skip, ['lodging']);
  assert.deepEqual(r.context.prefs.covered, { food: 'all' });
  assert.equal(r.context.prefs.pct.food, -100);
  assert.equal(r.context.estimate.currency, null);
});

test('the chat prompt carries the plan, what is known and the message, and asks for JSON', () => {
  const r = cleanChat({ message: 'האוכל ממומן', history: [{ role: 'me', text: 'שלום' }], context: { destination: 'פריז', days: 5, travelers: 2, lines: { food: 2000 }, prefs: { skip: ['lodging'], notes: ['לינה אצל האח'] } } });
  const p = chatPrompt(r, '2026-10-12');
  for (const w of ['פריז', 'food (אוכל): ₪2000', 'לא צריך: lodging', 'לינה אצל האח', 'משתמש: שלום', 'האוכל ממומן', '"changes"']) assert.ok(p.includes(w), w);
});

test('the chat answer: only known keys, categories and bounded numbers get through', () => {
  assert.equal(pickChat(null, '2026-10-12'), null);
  assert.equal(pickChat({ changes: { skip: ['lodging'] } }, '2026-10-12'), null, 'no words, no changes');
  const out = pickChat({ reply: 'הורדתי את הלינה', changes: { skip: ['lodging', 'yacht'], covered: { food: 'all', flights: -3 }, fixed: { flights: 4200 }, pct: { food: -50 }, funding: 2000, days: 99, travelers: 3, month: '2020-01', destination: 'פריז', notes_add: ['לינה אצל האח'], hack: true } }, '2026-10-12');
  assert.equal(out.reply, 'הורדתי את הלינה');
  assert.deepEqual(out.changes, { skip: ['lodging'], covered: { food: 'all', flights: 0 }, fixed: { flights: 4200 }, pct: { food: -50 }, funding: 2000, days: 60, travelers: 3, destination: 'פריז', notes_add: ['לינה אצל האח'] });
  assert.deepEqual(pickChat({ reply: 'מה התקציב לאוכל?', changes: { funding: null, month: null } }, '2026-10-12').changes, {});
});
