import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const clean = (errors) => errors.filter((e) => !/ERR_CERT|fonts|Failed to load resource/.test(e));

test('the sign-in screen says how the data is protected, and no longer "under construction"', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*.supabase.co/**', (r) => r.fulfill(json({})));
  await page.goto(server.base + '/app/');
  const text = await page.locator('main.login').textContent();
  assert.doesNotMatch(text, /בבנייה/);
  assert.match(await page.locator('.login-safe').textContent(), /בלי חיבור לבנק.*מוצפן.*כניסה בשני שלבים/s);
  await page.close();
});

test('two-step login by email: no data until the code is right, then the app opens', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  await mockSupabase(page, db);
  let state = { totp: false, email: true, required: true, ok: false };
  await page.route('**/rest/v1/rpc/my_mfa_state', (r) => r.fulfill(json(state)));
  const sent = [];
  await page.route('**/api/2fa/email/send', (r) => { sent.push(JSON.parse(r.request().postData())); return r.fulfill(json({ sent: true, to: 'yo***@example.com' })); });
  await page.route('**/api/2fa/email/verify', (r) => {
    const { code } = JSON.parse(r.request().postData());
    if (code !== '123456') return r.fulfill(json({ error: 'הקוד לא נכון. נסו שוב.' }, 400));
    state = { ...state, ok: true };
    return r.fulfill(json({ ok: true }));
  });
  await signIn(page, server.base);
  await page.waitForSelector('text=עוד שלב אחד');
  assert.equal(await page.locator('nav').count(), 0, 'the app is not shown yet');
  assert.equal(await page.locator('input[autocomplete="one-time-code"]').count(), 0, 'the box appears once a code was sent');
  await page.click('button:has-text("שלחו לי קוד במייל")');
  await page.waitForSelector('text=yo***@example.com');
  assert.deepEqual(sent, [{ purpose: 'login' }]);
  await page.fill('input[autocomplete="one-time-code"]', '111111');
  await page.click('button[type="submit"]:has-text("אישור")');
  assert.match(await page.locator('.error').textContent(), /לא נכון/);
  await page.fill('input[autocomplete="one-time-code"]', '123 456');
  await page.click('button[type="submit"]:has-text("אישור")');
  await page.waitForSelector('button[aria-label="פרופיל והגדרות"]');
  // Next time on this device the app does not open from the stored copy before asking.
  assert.equal(await page.evaluate(() => localStorage.getItem('twostep:u1')), '1');
  assert.deepEqual(clean(errors), []);
  await page.close();
});

test('an app code at sign-in goes to the authenticator check', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = makeFakeDb();
  await mockSupabase(page, db);
  let state = { totp: true, email: true, required: true, ok: false };
  await page.route('**/rest/v1/rpc/my_mfa_state', (r) => r.fulfill(json(state)));
  const user = { id: 'u1', email: 'yossi@example.com', aud: 'authenticated', user_metadata: { terms_version: '2026-10' }, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'a' }] };
  await page.route('**/auth/v1/user', (r) => r.fulfill(json(user)));
  let verified = null;
  await page.route('**/auth/v1/factors/f1/challenge', (r) => r.fulfill(json({ id: 'c1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 })));
  await page.route('**/auth/v1/factors/f1/verify', (r) => {
    verified = JSON.parse(r.request().postData());
    state = { ...state, ok: true };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return r.fulfill(json({ access_token: b({ alg: 'HS256' }) + '.' + b({ sub: 'u1', exp, aal: 'aal2' }) + '.s', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r2', user }));
  });
  await signIn(page, server.base);
  await page.waitForSelector('text=עוד שלב אחד');
  assert.equal(await page.locator('.seg button[aria-pressed="true"]').textContent(), 'קוד מהאפליקציה', 'both on: the app first, email one tap away');
  await page.fill('input[autocomplete="one-time-code"]', '654321');
  await page.click('button[type="submit"]:has-text("אישור")');
  await page.waitForSelector('button[aria-label="פרופיל והגדרות"]');
  assert.equal(verified.code, '654321');
  assert.equal(verified.challenge_id, 'c1');
  await page.close();
});

test('"your security": turn on an app code, see the devices, sign out the others', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  await mockSupabase(page, db);
  await page.route('**/rest/v1/rpc/my_mfa_state', (r) => r.fulfill(json({ totp: false, email: false, required: false, ok: true })));
  await page.route('**/rest/v1/rpc/my_sessions', (r) => r.fulfill(json([
    { id: 's1', created_at: '2026-11-01T10:00:00Z', last_seen: '2026-11-03T10:00:00Z', user_agent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36', current: true },
    { id: 's2', created_at: '2026-10-01T10:00:00Z', last_seen: '2026-10-20T10:00:00Z', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36', current: false }
  ])));
  await page.route('**/api/2fa/status', (r) => r.fulfill(json({ totp: false, email: false, required: false, ok: true, mailReady: true, emailOn: false, emailMasked: 'yo***@example.com' })));
  const factors = [];
  await page.route('**/auth/v1/user', (r) => r.fulfill(json({ id: 'u1', email: 'yossi@example.com', aud: 'authenticated', user_metadata: { terms_version: '2026-10' }, factors })));
  await page.route('**/auth/v1/factors', (r) => r.fulfill(json({ id: 'f9', type: 'totp', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://x' } })));
  let others = null;
  await page.route('**/auth/v1/logout**', (r) => { others = new URL(r.request().url()).searchParams.get('scope'); return r.fulfill({ status: 204, body: '' }); });
  await signIn(page, server.base);
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('button:has-text("האבטחה שלך")');
  await page.waitForSelector('text=אנדרואיד · Chrome');
  assert.match(await page.locator('.security').textContent(), /מחשב Windows · Chrome/);
  assert.equal(await page.locator('.sec-tag').first().textContent(), 'כבוי');
  // An app code: the QR and the key to type by hand.
  await page.locator('.sec-row', { hasText: 'קוד מאפליקציה' }).locator('button:has-text("להפעיל")').click();
  await page.waitForSelector('img[alt^="קוד QR"]');
  assert.match(await page.locator('.sec-steps').textContent(), /JBSWY3DPEHPK3PXP/);
  await page.click('.sec-steps button:has-text("ביטול")');
  // Sign out every other device, after a second tap.
  await page.click('button:has-text("לנתק את כל המכשירים האחרים")');
  await page.click('button:has-text("בטוח? לנתק מכשיר אחד")');
  await page.waitForSelector('text=כל המכשירים האחרים נותקו');
  assert.equal(others, 'others');
  assert.match(await page.locator('.security').textContent(), /אין לנו חיבור לבנק/);
  assert.deepEqual(clean(errors), []);
  await page.close();
});
