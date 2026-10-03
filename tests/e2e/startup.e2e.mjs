import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

test('opening again is instant: the last data shows at once and refreshes in the background', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  await page.waitForTimeout(1200); // the copy is written shortly after loading
  // Next time the data is slow (a cold or far server): the screen does not wait.
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/rest/v1/transactions*', async (r) => { await gate; return r.fallback(); });
  await page.route('**/rest/v1/memberships*', async (r) => { await gate; return r.fallback(); });
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector('.hero');
  assert.ok(Date.now() - t0 < 5000, 'shown from the copy, not after the data');
  assert.equal(await page.locator('.loading').count(), 0, 'no skeleton: real numbers right away');
  await page.waitForSelector('.refreshing:has-text("מתעדכן")');
  release();
  await page.waitForFunction(() => !document.querySelector('.refreshing'));
  await page.close();
});

test('with no connection at all, the app still opens with the last data and says it could not refresh', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  // Once more so the worker (now in control) keeps all of the app's files.
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(1500);
  await page.unroute('**/*.supabase.co/**');
  await page.route('**/*.supabase.co/**', (r) => r.abort('internetdisconnected'));
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForSelector('.toast:has-text("מוצגים הנתונים האחרונים")');
  await context.close();
});

test('signing out removes the data kept on the device', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  await page.waitForTimeout(1200);
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('cache:household:'))));
  await page.click('.topbar .icon-btn');
  await page.click('button:has-text("יציאה")');
  await page.waitForSelector('.login');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cache:')).length), 0);
  await page.close();
});
