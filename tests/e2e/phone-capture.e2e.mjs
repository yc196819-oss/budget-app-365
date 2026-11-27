import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const OWNER = 'owner@example.com';
const SHOT = process.env.SHOT_DIR;

// The owner: a made-up address added to the owners' fingerprints for this page only.
async function open({ owner = true, scheme = 'light' } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, serviceWorkers: 'block', deviceScaleFactor: SHOT ? 2 : 1 });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  await mockSupabase(page, db);
  const hash = createHash('sha256').update(OWNER).digest('hex');
  await page.route('**/app/src/config.js', async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace("ownerHashes: [", "ownerHashes: ['" + hash + "', ");
    return r.fulfill({ response: res, body });
  });
  await signIn(page, server.base);
  if (owner) {
    await page.evaluate((e) => {
      const k = 'sb-bwwupwbakefjhwropdin-auth-token';
      const s = JSON.parse(localStorage.getItem(k)); s.user.email = e; localStorage.setItem(k, JSON.stringify(s));
    }, OWNER);
  }
  await page.goto(server.base + '/app/#/home');
  await page.reload();
  await page.waitForSelector('.hero');
  return { page, errors };
}

test('payments from the phone: only the owner sees it for now', async () => {
  const { page } = await open({ owner: false });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.waitForSelector('text=תקלות ורעיונות לשיפור');
  assert.equal(await page.locator('text=תשלומים מהטלפון').count(), 0);
  await page.close();
});

test('payments from the phone: a key shown once, the steps, and what arrived', async () => {
  for (const scheme of SHOT ? ['light', 'dark'] : ['light']) {
    const { page, errors } = await open({ scheme });
    let status = { key: null, recent: [] };
    const made = [];
    await page.route('**/api/capture/status*', (r) => r.fulfill(json(status)));
    await page.route('**/api/capture/key', (r) => {
      if (r.request().method() === 'POST') {
        made.push(JSON.parse(r.request().postData()));
        status = { key: { created_at: '2026-11-27T10:00:00Z', last_used_at: null }, recent: [] };
        return r.fulfill(json({ key: 'bk_EXAMPLEexampleEXAMPLEexample12' }));
      }
      status = { key: null, recent: [] };
      return r.fulfill(json({ ok: true }));
    });
    await page.click('button[aria-label="פרופיל והגדרות"]');
    await page.click('text=תשלומים מהטלפון');
    await page.waitForSelector('.phone-capture .badge');
    assert.match(await page.locator('.phone-capture .badge').textContent(), /לא מחובר/);
    assert.match(await page.locator('.phone-how').textContent(), /MacroDroid.*Google Wallet.*POST.*Authorization.*\[notification_title\].*\[notification\]/s);

    await page.click('button:has-text("ליצור קוד לטלפון")');
    await page.waitForSelector('.phone-key');
    assert.deepEqual(made, [{ householdId: 'h1' }]);
    const codes = await page.locator('.phone-key code').allTextContents();
    assert.equal(codes[0], server.base + '/api/capture/wallet');
    assert.equal(codes[1], 'Bearer bk_EXAMPLEexampleEXAMPLEexample12');
    assert.match(await page.locator('.phone-capture .badge').textContent(), /מחובר/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'nothing off screen on a phone');
    if (SHOT) await page.locator('.sheet').screenshot({ path: SHOT + '/phone-key-' + scheme + '.png' });

    // Later: notifications arrived. The key is not shown again.
    status = {
      key: { created_at: '2026-11-27T10:00:00Z', last_used_at: '2026-11-27T11:40:00Z' },
      recent: [
        { id: 'n1', received_at: '2026-11-27T11:40:00Z', title: 'מאפיית הכיכר', body: '₪45.90 באמצעות Mastercard •••• 4821', parsed: { amount: 45.9, currency: 'ILS', merchant: 'מאפיית הכיכר', last4: '4821' }, status: 'logged' },
        { id: 'n2', received_at: '2026-11-26T18:05:00Z', title: 'Book Shop', body: '$12.00 with Visa •••• 1234', parsed: { amount: 12, currency: 'USD', merchant: 'Book Shop', last4: '1234' }, status: 'logged' }
      ]
    };
    await page.click('.phone-capture .btn-text:has-text("חזרה")');
    await page.click('text=תשלומים מהטלפון');
    await page.waitForSelector('.phone-note');
    assert.equal(await page.locator('.phone-key').count(), 0);
    const notes = await page.locator('.phone-note').allTextContents();
    assert.match(notes[0], /מאפיית הכיכר.*45\.90.*כרטיס 4821.*עוד בלי תנועה/s);
    assert.match(notes[1], /Book Shop.*12 USD/s);
    if (SHOT) await page.locator('.sheet').screenshot({ path: SHOT + '/phone-recent-' + scheme + '.png' });

    // Stopping asks once more, then the phone can no longer send.
    await page.click('button:has-text("לבטל את הקוד")');
    await page.click('button:has-text("בטוח?")');
    await page.waitForSelector('button:has-text("ליצור קוד לטלפון")');
    assert.deepEqual(errors.filter((e) => !/fonts|Failed to load resource/.test(e)), []);
    await page.close();
  }
});
