import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open({ share = true, joined = 0, search = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: process.env.SHOT ? 2 : 1 });
  const errors = collectErrors(page);
  const calls = [];
  await mockSupabase(page, makeFakeDb());
  await page.route('**/api/share', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'a1b2c3', joined }) }));
  await page.route('**/api/share/joined', (r) => { calls.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  if (share) await page.addInitScript(() => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; });
  else await page.addInitScript(() => { delete Navigator.prototype.share; navigator.share = undefined; });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + search + '#/home');
  await page.waitForSelector('.hero');
  return { page, errors, calls };
}

test('tell your friends: one tap opens the phone\'s share sheet with a ready message and the sign-up link', async () => {
  const { page, errors } = await open({ joined: 2 });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  const card = page.locator('.share-card');
  await card.waitFor();
  assert.match(await card.textContent(), /נהנית\? ספר לחבריך/);
  assert.match(await card.locator('.share-joined').textContent(), /2 חברים כבר הצטרפו בזכותך/);
  if (process.env.SHOT) { await page.waitForTimeout(500); await card.screenshot({ path: process.env.SHOT }); }
  await card.locator('button:has-text("לשתף עם חברים")').click();
  const [d] = await page.evaluate(() => window.__shared);
  assert.match(d.text, /התקציב שלנו/);
  assert.ok(d.text.trim().endsWith('/app/?ref=a1b2c3'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('on a computer without a share sheet: WhatsApp, email and copy', async () => {
  const { page } = await open({ share: false });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.locator('.share-card button:has-text("לשתף עם חברים")').click();
  const more = page.locator('.share-more');
  await more.waitFor();
  assert.match(await more.locator('a:has-text("וואטסאפ")').getAttribute('href'), /^https:\/\/wa\.me\/\?text=.*ref%3Da1b2c3/);
  assert.match(await more.locator('a:has-text("מייל")').getAttribute('href'), /^mailto:\?subject=/);
  assert.equal(await page.locator('.share-joined').count(), 0, 'nothing about friends until one joins');
  await page.close();
});

test('arriving from a friend\'s link: the code is sent once after signing in', async () => {
  const { page, calls } = await open({ search: '?ref=a1b2c3' });
  await page.waitForFunction(() => !localStorage.getItem('ref'));
  assert.deepEqual(calls, [{ ref: 'a1b2c3' }]);
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(300);
  assert.equal(calls.length, 1, 'once');
  await page.close();
});
