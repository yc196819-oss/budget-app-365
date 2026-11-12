import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
import { makeXlsx } from '../fixtures/zip.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = new Date();
const dd = (k, day) => { const d = new Date(today.getFullYear(), today.getMonth() - k, day); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
const statement = () => makeXlsx([['פירוט עסקאות לכרטיס 2928'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'], [dd(1, 3), 'מסעדה בדויה', '80.00', '80.00'], [dd(1, 20), 'חנות בדויה', '120.00', '120.00'], ['', 'סה"כ', '', '200.00']]);
// What the service worker keeps when a file is shared to the app.
async function share(page, name, bytes) {
  await page.evaluate(async ({ name, data }) => {
    const c = await caches.open('shared-files');
    await c.put('/shared/0', new Response(new Uint8Array(data), { headers: { 'content-type': 'application/octet-stream', 'x-name': encodeURIComponent(name), 'x-at': String(Date.now()) } }));
  }, { name, data: [...bytes] });
}
const setup = (d) => {
  d.tables.bank_accounts = [{ id: 'b1', household_id: d.hid, name: 'החשבון של משה', provider: 'leumi', balance: 1 }, { id: 'b2', household_id: d.hid, name: 'החשבון של רחל', provider: 'hapoalim', balance: 1 }];
  d.tables.credit_cards = [{ id: 'm1', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 1, last4: '4821', bank_account_id: 'b1' }, { id: 'm2', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 1, last4: '2928', bank_account_id: 'b2' }];
};

test('a file shared from the phone: pick the card (guessed from its name), then the usual upload, saved to that card', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  const db = makeFakeDb(); setup(db);
  await page.route('**/api/telemetry', (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/ai/import', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"transactions":[]}' }));
  await mockSupabase(page, db); await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home'); await page.waitForSelector('.hero');
  await share(page, 'max_2928_nov.xlsx', statement());
  await page.goto(server.base + '/app/?action=shared');
  await page.waitForSelector('.share-sheet');
  assert.match(await page.locator('.share-file').textContent(), /max_2928_nov\.xlsx/);
  assert.match(await page.locator('.share-opt.on').textContent(), /2928.*יורד מהחשבון של רחל.*לפי הקובץ/);
  await page.click('.share-opt.on');
  await page.waitForSelector('.sheet:has-text("העלאת פירוט")');
  const save = page.locator('.sheet button', { hasText: /לשמור \d/ });
  await save.waitFor({ timeout: 15000 });
  await save.click();
  await page.waitForSelector('.toast:has-text("נשמרו")');
  assert.ok(db.tables.imports.some((f) => f.source_id === 'm2'), 'saved as the second bank\'s Max');
  assert.equal(await page.evaluate(async () => (await (await caches.open('shared-files')).keys()).length), 0, 'nothing left on the device');
  assert.deepEqual(errors, []);
  await page.close();
});

test('shared before signing in: the file waits, the sign-in screen says so, and it can be dropped', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(server.base + '/app/');
  await share(page, 'cal-statement.xlsx', statement());
  await page.reload();
  await page.waitForSelector('.share-wait');
  assert.match(await page.locator('.share-wait').textContent(), /cal-statement\.xlsx מחכה לך.*אחרי הכניסה נמשיך ישר להעלאה/);
  await page.click('.share-wait button:has-text("לבטל")');
  await page.waitForSelector('.share-wait', { state: 'detached' });
  assert.equal(await page.evaluate(async () => (await caches.keys()).includes('shared-files')), false);
  await page.close();
});
