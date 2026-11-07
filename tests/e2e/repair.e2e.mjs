import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

test('a household with no categories at all (made by an early version) gets the usual ones, so a category can be chosen', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  db.tables.categories = [];
  for (const t of db.tables.transactions) { t.category_id = null; t.subcategory_id = null; }
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/money');
  // An expense (on some days the first line is an income, with income categories).
  await page.locator('.row', { hasText: 'שופרסל' }).first().click();
  // The transaction's sheet offers categories to pick.
  await page.waitForSelector('.sheet .chip:has-text("אוכל")');
  assert.ok(db.tables.categories.some((c) => c.name === 'אוכל' && !c.parent_id));
  assert.ok(db.tables.categories.some((c) => c.name === 'סופר' && c.parent_id));
  const count = db.tables.categories.length;
  // Opening again adds nothing more.
  await page.reload();
  await page.waitForSelector('.row');
  await page.waitForTimeout(300);
  assert.equal(db.tables.categories.length, count);
  assert.deepEqual(errors, []);
  await page.close();
});

// Made-up: a card statement read badly, every purchase on the charge day.
function badStatement(db) {
  const now = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const charge = iso(new Date(now.getFullYear(), now.getMonth() - 1, 10));
  const real = iso(new Date(now.getFullYear(), now.getMonth() - 2, 20));
  const monthEnd = iso(new Date(now.getFullYear(), now.getMonth() - 1, 0));
  const add = (o) => db.tables.transactions.push({ id: 'rp' + db.tables.transactions.length, household_id: 'h1', type: 'expense', card_id: 'c1', category_id: 'food', subcategory_id: 'super', created_by: 'u1', ...o });
  add({ import_id: 'imp-old', tx_date: real, description: 'מאפיית הדר', amount: 42.5 });
  add({ import_id: 'imp-bad', tx_date: charge, description: 'מאפיית הדר', amount: 42.5 });
  for (let i = 0; i < 9; i++) add({ import_id: 'imp-bad', tx_date: charge, description: 'חנות ספרים ' + 'אבגדהוזחט'[i], amount: 20 + i });
  return { charge, monthEnd };
}

test('the advisor finds a statement dated by the charge day and fixes it in one tap', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  const { charge, monthEnd } = badStatement(db);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.waitForSelector('.repair-card');
  const text = await page.locator('.repair-card').textContent();
  assert.match(text, /היועץ מצא טעות בהעלאה/);
  assert.match(text, /10 קניות נרשמו/);
  assert.match(text, /1 מהן כבר נמצאות/);
  assert.match(text, /9 נעביר/);
  await page.click('.repair-card button:has-text("לתקן בלחיצה")');
  await page.waitForSelector('.repair-card', { state: 'detached' });
  const bad = db.tables.transactions.filter((t) => t.import_id === 'imp-bad');
  assert.equal(bad.length, 9, 'the duplicate went');
  assert.ok(bad.every((t) => t.tx_date === monthEnd), 'the rest moved to the end of the month before');
  assert.ok(!bad.some((t) => t.tx_date === charge));
  assert.equal(db.tables.transactions.filter((t) => t.import_id === 'imp-old').length, 1, 'the real one stays');
  assert.deepEqual(errors, []);
  await page.close();
});

test('"keep as is" hides the finding and changes nothing', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = makeFakeDb();
  const { charge } = badStatement(db);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.click('.repair-card button:has-text("להשאיר כך")');
  await page.waitForSelector('.repair-card', { state: 'detached' });
  assert.equal(db.tables.transactions.filter((t) => t.import_id === 'imp-bad' && t.tx_date === charge).length, 10);
  await page.reload();
  await page.waitForSelector('.hero, .home');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.repair-card').count(), 0);
  await page.close();
});
