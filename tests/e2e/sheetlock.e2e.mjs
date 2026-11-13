import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

// A sheet open on the phone: the page behind it does not move when the
// person scrolls (on the sheet's end, or on the dimmed area); it is free
// again once the sheet closes.
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

test('the page behind an open sheet stays still, and scrolls again once it closes', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const db = makeFakeDb();
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/money');
  await page.waitForSelector('.row');
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.locator('.row').nth(2).click();
  await page.waitForSelector('.sheet');
  await page.waitForFunction(() => document.documentElement.classList.contains('sheet-open'), null, { timeout: 3000 });
  const before = await page.evaluate(() => window.scrollY);
  // A wheel or a swipe over the dimmed area does not move the page.
  await page.mouse.move(195, 40);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden');
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - before) < 2, 'the page did not scroll');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sheet')).overscrollBehaviorY), 'contain');
  await page.click('.sheet button[aria-label="סגירה"]');
  await page.waitForFunction(() => !document.documentElement.classList.contains('sheet-open'));
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.scrollY)) > before, 'scrolls again after closing');
  assert.deepEqual(errors, []);
  await page.close();
});
