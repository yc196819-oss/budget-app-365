import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn } from './helpers.mjs';

// A phone on a slow or stalled connection must never be left on "loading"
// for good: the app says what happened and offers a way out.
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const KEY = 'sb-bwwupwbakefjhwropdin-auth-token';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (exp) => b64({ alg: 'HS256' }) + '.' + b64({ sub: 'u1', exp }) + '.s';
const USER = { id: 'u1', email: 'yossi@example.com', aud: 'authenticated', user_metadata: { terms_version: '2026-10' } };

test('renewing the sign-in stalls: the app says the connection is slow, and trying again gets in', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await mockSupabase(page, makeFakeDb());
  let hang = true;
  await page.route('**/auth/v1/token*', async (r) => {
    if (hang) return; // never answers
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: token(exp), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r2', user: USER }) });
  });
  await page.goto(server.base + '/app/');
  // A sign-in from yesterday: it has to be renewed before anything loads.
  await page.evaluate(([k, t, u]) => {
    const exp = Math.floor(Date.now() / 1000) - 3600;
    localStorage.setItem(k, JSON.stringify({ access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user: u }));
  }, [KEY, token(Math.floor(Date.now() / 1000) - 3600), USER]);
  await page.reload();
  await page.waitForSelector('[role=alert]:has-text("החיבור איטי מדי כרגע")', { timeout: 15000 });
  hang = false;
  await page.click('button:has-text("לנסות שוב")');
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.close();
});

test('the household check stalls on a first visit: "could not connect" with a retry, not endless loading', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.waitForSelector('.hero');
  await page.waitForTimeout(1500); // the copy is written shortly after loading
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cache:')).forEach((k) => localStorage.removeItem(k)));
  let hang = true;
  await page.route('**/rest/v1/memberships*', async (r) => { if (hang) return; return r.fallback(); });
  await page.reload();
  await page.waitForSelector('[role=alert]:has-text("לא הצלחנו להתחבר כרגע")', { timeout: 15000 });
  hang = false;
  await page.click('button:has-text("לנסות שוב")');
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.close();
});

test('the app itself fails to start: after a while a way out shows, and signing in again clears the stuck sign-in', async () => {
  // No service worker here, so the broken file is not served from the device.
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.waitForSelector('.hero');
  await page.route('**/app/src/main.js', (r) => r.abort());
  await page.reload();
  assert.equal(await page.locator('.rescue').count(), 0, 'not at once');
  await page.waitForSelector('.rescue:has-text("הטעינה לוקחת יותר מדי זמן")', { timeout: 16000 });
  await page.unroute('**/app/src/main.js');
  await page.click('.rescue button:has-text("להתחבר מחדש")');
  await page.waitForSelector('.login', { timeout: 15000 });
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null);
  await context.close();
});

test('a normal start never shows the way-out offer', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.waitForSelector('.hero');
  await page.waitForTimeout(13000);
  assert.equal(await page.locator('.rescue').count(), 0);
  await page.close();
});
