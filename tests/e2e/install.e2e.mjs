import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

async function open({ userAgent, init } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, ...(userAgent ? { userAgent } : {}) });
  if (init) await page.addInitScript(init);
  const errors = collectErrors(page);
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  return { page, errors };
}

test('iPhone, not installed: the home screen suggests installing and shows the two steps', async () => {
  const { page, errors } = await open({ userAgent: IPHONE });
  const card = page.locator('.install-card');
  await card.waitFor();
  assert.match(await card.textContent(), /להתקין את האפליקציה בטלפון/);
  assert.match(await card.textContent(), /רק כך אפשר לקבל התראות באייפון/);
  await card.locator('text=איך מתקינים').click();
  assert.match(await card.textContent(), /הוספה למסך הבית/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('"not now" hides it, and it stays hidden after reopening', async () => {
  const { page } = await open({ userAgent: IPHONE });
  await page.click('.install-card >> text=לא עכשיו');
  assert.equal(await page.locator('.install-card').count(), 0);
  await page.reload();
  await page.waitForSelector('.hero');
  assert.equal(await page.locator('.install-card').count(), 0);
  await page.close();
});

test('Android Chrome: one button opens the browser\'s own install dialog', async () => {
  const { page } = await open({
    userAgent: ANDROID,
    init: () => {
      // The browser's offer, as Chrome sends it, once the page has loaded.
      window.addEventListener('load', () => setTimeout(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => { window.__prompted = true; };
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
      }, 50));
    }
  });
  const btn = page.locator('.install-card button.btn', { hasText: 'להתקין' });
  await btn.waitFor();
  await btn.click();
  await page.waitForSelector('.toast');
  assert.equal(await page.evaluate(() => window.__prompted), true);
  assert.match(await page.locator('.toast').textContent(), /הותקנה/);
  await page.close();
});

test('already installed (opened from the home screen): nothing is suggested', async () => {
  const { page } = await open({ userAgent: IPHONE, init: () => { Object.defineProperty(navigator, 'standalone', { value: true }); } });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.install-card').count(), 0);
  await page.close();
});

test('on a computer the home screen does not ask', async () => {
  const { page } = await open();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.install-card').count(), 0);
  await page.close();
});

test('the public download page: one tap on Android, the two steps on iPhone, the link on a computer', async () => {
  const android = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: ANDROID });
  const errors = collectErrors(android);
  await android.route('**/fonts.g*/**', (r) => r.abort());
  await android.addInitScript(() => {
    window.addEventListener('load', () => setTimeout(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    }, 50));
  });
  await android.goto(server.base + '/download');
  await android.waitForTimeout(200);
  await android.click('#install-btn');
  await android.waitForSelector('#installed:not([hidden])');
  assert.equal(await android.evaluate(() => window.__prompted), true);
  assert.deepEqual(errors, []);
  await android.close();

  const iphone = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: IPHONE });
  await iphone.goto(server.base + '/download');
  await iphone.click('#install-btn');
  assert.ok(await iphone.locator('#steps-ios').isVisible());
  assert.match(await iphone.locator('#steps-ios').textContent(), /הוספה למסך הבית/);
  await iphone.close();

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(server.base + '/download');
  await desktop.click('#install-btn');
  assert.match(await desktop.locator('#url').textContent(), /\/download$/);
  await desktop.close();
});

test('the sign-in screen links to the download page', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: IPHONE });
  await mockSupabase(page, makeFakeDb());
  await page.goto(server.base + '/app/');
  await page.waitForSelector('.login');
  assert.equal(await page.locator('a[href="/download"]').count(), 1);
  assert.equal(await page.locator('.install-card').count(), 1, 'on an iPhone the install steps are offered right away');
  await page.close();
});

test('deleting the account from the profile: the word must be typed, then the account is gone and the app signs out', async () => {
  const { page } = await open();
  const deleted = [];
  await page.route('**/api/account/delete', (r) => { deleted.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=מחיקת החשבון');
  const go = page.locator('button', { hasText: 'למחוק לצמיתות' });
  assert.ok(await go.isDisabled());
  await page.fill('.delete-account input', 'מחק');
  assert.ok(await go.isDisabled());
  await page.fill('.delete-account input', 'מחיקה');
  await go.click();
  await page.waitForSelector('.login');
  assert.deepEqual(deleted, [{ confirm: 'מחיקה' }]);
  await page.close();
});
