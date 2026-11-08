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
  assert.match(await card.locator('.share-netfree').textContent(), /פתוח למשתמשי נטפרי/);
  assert.match(await card.locator('.share-joined').textContent(), /2 חברים כבר הצטרפו בזכותך/);
  if (process.env.SHOT) { await page.waitForTimeout(500); await card.screenshot({ path: process.env.SHOT }); }
  await card.locator('button:has-text("לשתף עם חברים")').click();
  const [d] = await page.evaluate(() => window.__shared);
  assert.match(d.text, /התקציב שלנו/);
  assert.match(d.text, /נטפרי/);
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

test('writing to us is one tap from the home screen, and near the top of the profile', async () => {
  const { page, errors } = await open();
  await page.locator('.talk-to-us button:has-text("לכתוב לנו")').click();
  await page.waitForSelector('.sheet[aria-label="פנייה אלינו"]');
  await page.click('.sheet button[aria-label="סגירה"]');
  await page.click('button[aria-label="פרופיל והגדרות"]');
  // Right under "tell your friends", not at the bottom of the list.
  const order = await page.evaluate(() => [...document.querySelectorAll('.sheet .share-card, .sheet button')].map((b) => b.className.includes('share-card') ? 'share' : b.textContent.trim()).filter((t) => t === 'share' || /תקלות ורעיונות|מצב כהה|מצב בהיר/.test(t)));
  assert.deepEqual(order.slice(0, 2), ['share', 'תקלות ורעיונות לשיפור']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('on a computer, the side menu has "write to us" too', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/money');
  await page.locator('.sidebar .side-talk').click();
  await page.waitForSelector('.sheet[aria-label="פנייה אלינו"]');
  await page.close();
});

test('the confirmation link opened in another browser: the code saved with the account is sent instead', async () => {
  const { page, calls } = await open();
  assert.deepEqual(calls, []);
  await page.evaluate(() => {
    const k = 'sb-bwwupwbakefjhwropdin-auth-token';
    const s = JSON.parse(localStorage.getItem(k));
    s.user.user_metadata = { ...s.user.user_metadata, ref: 'd4e5f6' };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(500);
  assert.deepEqual(calls, [{ ref: 'd4e5f6' }]);
  await page.close();
});
