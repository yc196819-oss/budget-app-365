import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

// A trip to Romania three weeks ago, with the flight booked a month before.
function withTrip(db) {
  const add = (id, daysAgo, description, amount) => db.tables.transactions.push({ id, household_id: 'h1', type: 'expense', amount, description, tx_date: ago(daysAgo), nature: 'variable', spread: 'month', source: 'pdf' });
  add('f1', 60, 'WIZZ AIR HU', 1400);
  add('r1', 24, 'KAUFLAND BRASOV RO', 210);
  add('r2', 23, 'PEPCO CORBEANCA', 90);
  add('r3', 23, 'THERME NORD BUCURESTI', 400);
  add('r4', 22, 'AIRBNB * HM123', 650);
  add('r5', 21, 'BOLT BUCURESTI', 40);
  return db;
}

async function open(hash, db = withTrip(makeFakeDb())) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  return { page, db, errors };
}

test('a trip in the card lines is offered on the home screen; opening it makes a folder in plans → trips', async () => {
  const { page, db, errors } = await open('#/home');
  const card = page.locator('.trip-found');
  await card.waitFor();
  assert.match(await card.textContent(), /נראה שהייתם ברומניה/);
  assert.match(await card.textContent(), /6 הוצאות/);
  await card.locator('text=לפתוח תיקייה').click();
  await page.waitForSelector('.sheet .trip-total');
  assert.match(page.url(), /#\/plans\/trips$/);
  const row = db.tables.trips[0];
  assert.equal(row.status, 'saved');
  assert.equal(row.name, 'חופשה ברומניה ' + ago(24).slice(0, 4));
  assert.deepEqual([...row.transaction_ids].sort(), ['f1', 'r1', 'r2', 'r3', 'r4', 'r5']);
  assert.match(await page.locator('.sheet .trip-total').textContent(), /₪2,790/);
  assert.match(await page.locator('.sheet').textContent(), /הוזמן מראש/);
  // One line out of the trip.
  await page.locator('.sheet .trip-line', { hasText: 'BOLT' }).locator('input').uncheck();
  await page.waitForTimeout(150);
  assert.deepEqual(db.tables.trips[0].excluded_ids, ['r5']);
  assert.match(await page.locator('.sheet .trip-total').textContent(), /₪2,750/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('"not a trip" is remembered and not offered again', async () => {
  const { page, db } = await open('#/home');
  await page.locator('.trip-found >> text=זה לא טיול').click();
  await page.waitForTimeout(150);
  assert.equal(db.tables.trips[0].status, 'dismissed');
  assert.equal(await page.locator('.trip-found').count(), 0);
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.trip-found').count(), 0);
  await page.close();
});

test('planning the next trip: the advisor checks the destination, the local currency is converted, the plan is saved as a goal', async () => {
  const db = withTrip(makeFakeDb());
  db.tables.trips = [{ id: 'tr1', household_id: 'h1', status: 'saved', name: 'חופשה ברומניה 2026', country: 'רומניה', start_date: ago(24), end_date: ago(21), people: 2, transaction_ids: ['f1', 'r1', 'r2', 'r3', 'r4', 'r5'], excluded_ids: [] }];
  const { page, errors } = await open('#/plans/trips', db);
  const asked = [];
  await page.route('**/api/ai/trip-estimate', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estimate: {
      destination: 'ניו יורק', country: 'ארה״ב', currency: 'USD', flight_per_person: { low: 2800, typical: 3400, high: 4200 }, lodging_per_night: { low: 700, typical: 900, high: 1400 },
      percent_vs_past: { food: 70, transport: 60, attractions: 50, shopping: 10, other: 0 }, daily_per_person_local: 120, season: 'shoulder', cheaper_months: ['2099-02'], cheaper_note: 'אחרי החגים', tips: ['כרטיס מטרו שבועי'], confidence: 'medium' } }) });
  });
  await page.route('**/api/fx/rate**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"rate":3.7,"date":"2026-10-12","source":"boi"}' }));
  await page.click('text=✈️ לתכנן טיול');
  await page.fill('.sheet input[placeholder^="למשל: יוון"]', 'ניו יורק');
  await page.click('.sheet button:has-text("✨ לבדוק")');
  await page.waitForSelector('.sheet .trip-est');
  const est = await page.locator('.sheet .trip-est').textContent();
  assert.match(est, /₪2,800–₪4,200/);
  assert.match(est, /120 USD/);
  assert.match(est, /₪444/);
  assert.match(await page.locator('.sheet').textContent(), /\+70%/);
  assert.equal(asked[0].destination, 'ניו יורק');
  assert.equal(asked[0].past.country, 'רומניה');
  assert.ok(asked[0].past.flight_per_person > 0);
  await page.click('.sheet button:has-text("לשמור ביעדים")');
  await page.waitForSelector('.toast');
  const goal = db.tables.goals.find((g) => g.icon === '✈️');
  assert.equal(goal.name, 'חופשה בניו יורק');
  assert.ok(goal.target_amount > 6800, 'two fares of ₪3,400 at least');
  assert.ok(goal.plan_items.some((p) => p.name === 'טיסות' && p.amount === 6800));
  assert.match(await page.locator('section', { hasText: 'מתוכנן' }).textContent(), /חופשה בניו יורק/);
  assert.deepEqual(errors, []);
  await page.close();
});
