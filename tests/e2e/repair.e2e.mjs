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
  await page.locator('.row').first().click();
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
