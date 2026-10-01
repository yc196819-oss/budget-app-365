import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function openMoney(width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const db = makeFakeDb();
  const calls = [];
  const errors = collectErrors(page);
  await mockSupabase(page, db, calls);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/money');
  await page.waitForSelector('.month-nav');
  return { page, db, calls, errors };
}

test('loads only a bounded date range, page by page (not the whole history)', async () => {
  const { page, calls, errors } = await openMoney();
  const txCalls = calls.filter((c) => c.table === 'transactions' && c.method === 'GET');
  assert.ok(txCalls.length >= 1);
  assert.match(txCalls[0].query, /tx_date=gte\./);
  assert.match(txCalls[0].query, /limit=1000/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('month navigation: arrows, the 12-month strip and the year view', async () => {
  const { page, errors } = await openMoney();
  const title = () => page.locator('.month-nav b').textContent();
  const now = await title();
  await page.click('button[aria-label="החודש הקודם"]');
  assert.notEqual(await title(), now);
  assert.equal(await page.locator('button[aria-label="החודש הבא"]').isDisabled(), false);
  await page.locator('.strip button').first().click();
  assert.equal(await page.locator('button[aria-label="החודש הקודם"]').isDisabled(), true);
  await page.click('text=12 החודשים האחרונים');
  assert.equal(await page.locator('.month-nav').count(), 0);
  assert.equal(await page.locator('.group-head').count(), 2);
  await page.click('text=להציג עוד 3 חודשים');
  assert.equal(await page.locator('.group-head').count(), 5);
  assert.deepEqual(errors, []);
  await page.close();
});

test('search across the whole year shows a total', async () => {
  const { page } = await openMoney();
  await page.click('text=12 החודשים האחרונים');
  await page.fill('input[type="search"]', 'סונול');
  const summary = await page.locator('text=/נמצאו \\d+ תנועות/').textContent();
  assert.match(summary, /נמצאו 12 תנועות/);
  await page.close();
});

test('changing a category applies to the same merchant and can be undone', async () => {
  const { page, db } = await openMoney();
  // The previous month is always a full month of data, whatever today's date is.
  await page.click('button[aria-label="החודש הקודם"]');
  await page.locator('.row', { hasText: 'ארומה' }).first().click();
  await page.waitForSelector('.sheet');
  assert.ok(await page.locator('text=/לשנות גם ב-\\d+ התנועות האחרות של ארומה/').count());
  await page.locator('.sheet .chip', { hasText: 'רכב' }).click();
  await page.waitForSelector('.toast');
  const moved = db.tables.transactions.filter((t) => t.description === 'ארומה' && t.category_id === 'car').length;
  const all = db.tables.transactions.filter((t) => t.description === 'ארומה').length;
  assert.equal(moved, all);
  await page.click('.toast button');
  await page.waitForTimeout(300);
  assert.equal(db.tables.transactions.filter((t) => t.description === 'ארומה' && t.category_id === 'car').length, 0);
  assert.equal(db.tables.transactions.filter((t) => t.description === 'ארומה' && t.subcategory_id === 'cafe').length, all);
  await page.close();
});

test('delete hides at once, undo brings it back, nothing is deleted in the database', async () => {
  const { page, db } = await openMoney();
  const before = db.tables.transactions.length;
  const rows = await page.locator('.list .row').count();
  await page.locator('.list .row').first().click();
  await page.click('text=מחיקת התנועה');
  assert.equal(await page.locator('.list .row').count(), rows - 1);
  await page.click('.toast button');
  assert.equal(await page.locator('.list .row').count(), rows);
  await page.waitForTimeout(5500);
  assert.equal(db.tables.transactions.length, before);
  await page.close();
});

test('delete without undo removes it from the database after the undo window', async () => {
  const { page, db } = await openMoney();
  const before = db.tables.transactions.length;
  await page.locator('.list .row').first().click();
  await page.click('text=מחיקת התנועה');
  await page.waitForTimeout(5600);
  assert.equal(db.tables.transactions.length, before - 1);
  await page.close();
});

test('quick add: free text, category guessed from the merchant, Enter adds', async () => {
  const { page, db } = await openMoney();
  await page.click('.nav-add');
  await page.fill('.sheet input.input', '52 ארומה');
  assert.ok(await page.locator('text=כמו בפעם הקודמת').count());
  await page.press('.sheet input.input', 'Enter');
  await page.waitForSelector('.toast');
  const added = db.tables.transactions.find((t) => String(t.id).startsWith('new'));
  assert.equal(added.amount, 52);
  assert.equal(added.description, 'ארומה');
  assert.equal(added.category_id, 'food');
  assert.equal(added.subcategory_id, 'cafe');
  assert.equal(added.household_id, 'h1');
  assert.ok(await page.locator('.row', { hasText: 'ארומה' }).first().textContent());
  await page.close();
});

test('one-tap add from the most frequent merchants', async () => {
  const { page, db } = await openMoney();
  await page.click('.nav-add');
  const quick = page.locator('.sheet button.chip', { hasText: 'ארומה' });
  assert.ok(await quick.count());
  await quick.first().click();
  await page.waitForSelector('.toast');
  assert.ok(db.tables.transactions.some((t) => String(t.id).startsWith('new') && t.description === 'ארומה'));
  await page.close();
});

test('categories view: spending vs budget, and the 12-month detail', async () => {
  const { page, errors } = await openMoney();
  await page.click('button[aria-label="החודש הקודם"]');
  await page.click('.tabs >> text=קטגוריות');
  const food = page.locator('.list .row', { hasText: 'אוכל' });
  assert.match(await food.textContent(), /מתוך ₪3,000/);
  await food.click();
  await page.waitForSelector('.sheet');
  assert.match(await page.locator('.sheet').textContent(), /12 החודשים האחרונים/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('yearly report on desktop, no errors', async () => {
  const { page, errors } = await openMoney(1440);
  await page.click('text=12 החודשים האחרונים');
  await page.click('.tabs >> text=דוח');
  assert.match(await page.locator('main').textContent(), /כמה נשאר בסוף כל חודש/);
  assert.deepEqual(errors, []);
  await page.close();
});
