import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// What the service worker sends the open window when a notification is tapped.
const tap = (page, url) => page.evaluate(async (u) => {
  await navigator.serviceWorker.ready;
  navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: u } }));
}, url);

async function open(hash = '#/home') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  await page.route('**/api/telemetry', (r) => r.fulfill({ status: 204, body: '' }));
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  await page.waitForSelector('.hero, .month-nav, .sheet');
  return { page, errors };
}

test('a tapped notification, with the app open: another tab opens there, the check-in opens its sheet, an action opens the advisor', async () => {
  const { page, errors } = await open();
  await tap(page, '/app/#/money/report');
  await page.waitForFunction(() => location.hash === '#/money/report');
  await page.waitForSelector('.month-nav');

  await tap(page, '/app/#/plans/checkin');
  await page.waitForSelector('.sheet h2:has-text("בדיקה רבעונית")');
  assert.equal(await page.evaluate(() => location.hash), '#/plans');

  await tap(page, '/app/?action=ask');
  await page.waitForSelector('.sheet h2:has-text("היועץ")');
  assert.equal(await page.evaluate(() => location.search), '', 'the action is taken off the address');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a notification opening the app cold lands on its screen', async () => {
  const { page } = await open('#/plans/checkin');
  await page.waitForSelector('.sheet h2:has-text("בדיקה רבעונית")');
  await page.close();
});
