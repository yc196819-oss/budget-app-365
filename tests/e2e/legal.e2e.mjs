import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

test('terms, privacy and the accessibility statement are public pages, with the operator and a contact', async () => {
  const page = await browser.newPage();
  for (const [path, words] of [
    ['/terms', [/קובי גרינבוים/, /budgetapp2852@gmail\.com/, /אינו ייעוץ השקעות/, /עלולים לטעות/, /הדין הישראלי/]],
    ['/privacy', [/בעל השליטה במאגר:.*קובי גרינבוים/s, /תיקון 13/, /עיון/, /תיקון:/, /העברה לחו"ל/]],
    ['/accessibility', [/ת"י 5568/, /WCAG 2\.0/, /רכז הנגישות:.*קובי גרינבוים/s, /budgetapp2852@gmail\.com/]]
  ]) {
    const res = await page.goto(server.base + path);
    assert.equal(res.status(), 200, path);
    const text = await page.locator('main').textContent();
    for (const w of words) assert.match(text, w, path + ' ' + w);
    assert.equal(await page.locator('a[href="/terms"]').count() > 0, true, path + ' links the terms');
    assert.equal(await page.locator('a[href="/accessibility"]').count() > 0, true, path + ' links the statement');
  }
  await page.close();
});

test('sign-up needs the terms ticked, and records them on the account', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  let signup = null;
  await page.route('**/*.supabase.co/**', (r) => {
    if (r.request().url().includes('/auth/v1/signup')) { signup = JSON.parse(r.request().postData()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'n1', email: 'new@example.com' }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(server.base + '/app/');
  await page.click('.seg button:has-text("הרשמה")');
  await page.fill('input[type="email"]', 'new@example.com');
  await page.fill('input[type="password"]', 'password123');
  await page.click('form button[type="submit"]');
  assert.match(await page.locator('.error').textContent(), /לאשר את תנאי השימוש/);
  assert.equal(signup, null);
  await page.check('.terms-check input');
  await page.click('form button[type="submit"]');
  await page.waitForSelector('.notice');
  assert.equal(signup.data.terms_version, '2026-10');
  assert.ok(signup.data.terms_accepted_at);
  assert.equal(await page.locator('.legal-links a[href="/accessibility"]').count(), 1);
  assert.deepEqual(errors.filter((e) => !/ERR_CERT|fonts/.test(e)), [], 'no errors (fonts are offline here)');
  await page.close();
});

test('an account that has not confirmed the terms sees them first; confirming opens the app', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = makeFakeDb();
  await mockSupabase(page, db);
  let updated = null;
  await page.route('**/auth/v1/user', (r) => {
    updated = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'yossi@example.com', aud: 'authenticated', user_metadata: updated.data }) });
  });
  await page.goto(server.base + '/app/');
  await page.evaluate(() => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const b = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    localStorage.setItem('sb-bwwupwbakefjhwropdin-auth-token', JSON.stringify({ access_token: b({ alg: 'HS256' }) + '.' + b({ sub: 'u1', exp }) + '.s', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user: { id: 'u1', email: 'yossi@example.com', aud: 'authenticated', user_metadata: {} } }));
  });
  await page.reload();
  await page.waitForSelector('.terms-gate');
  assert.match(await page.locator('.terms-gate').textContent(), /מידע כללי.*לא ייעוץ השקעות/s);
  assert.equal(await page.locator('.terms-gate button[type="submit"]').isDisabled(), true);
  await page.check('.terms-check input');
  await page.click('.terms-gate button[type="submit"]');
  await page.waitForSelector('.shell');
  assert.equal(updated.data.terms_version, '2026-10');
  await page.close();
});
