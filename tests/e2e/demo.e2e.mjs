import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const OWNER = 'budgetapp2852@gmail.com';
const STATS = { active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } };

// The owner's tab and the demo tab share one browser (as in real life): the
// demo session lives only in its own tab.
async function ownerBoard() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  await mockSupabase(ctx, db);
  await ctx.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATS) }));
  await ctx.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await ctx.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await ctx.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await signIn(page, server.base);
  await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const s = JSON.parse(localStorage.getItem(k)); s.user.email = e; localStorage.setItem(k, JSON.stringify(s)); }, OWNER);
  await page.goto(server.base + '/app/#/home');
  await page.reload();
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.click('.admin-hub-btn:has-text("חשבון הדמו")');
  await page.waitForSelector('.demo-card');
  return { ctx, page, errors };
}

test('the owner opens the demo household in a new tab without a password, and stays signed in to their own account', async () => {
  const { ctx, page, errors } = await ownerBoard();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
  // A made-up session of the demo account (the fake database's household).
  const session = { access_token: b({ alg: 'HS256' }) + '.' + b({ sub: 'u1', exp }) + '.s', refresh_token: 'rd', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', email: 'demo.family@example.com', aud: 'authenticated', user_metadata: { full_name: 'דוד לוי', terms_version: '2026-10' } } };
  let asked = 0;
  await ctx.route('**/api/admin/demo/session', (r) => { asked++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session, name: 'משפחת לוי (הדגמה)' }) }); });
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click('.demo-card button:has-text("לפתוח את חשבון הדמו")')]);
  await tab.waitForSelector('.demo-bar');
  assert.equal(asked, 1);
  assert.match(await tab.locator('.demo-bar').textContent(), /חשבון הדמו/);
  // The session is not left in the address, and it is kept in this tab only.
  assert.doesNotMatch(tab.url(), /demo=ey|access_token/);
  assert.match(tab.url(), /\?demo=1#\/home$/);
  const demoUser = await tab.evaluate(() => JSON.parse(sessionStorage.getItem('sb-demo-auth')).user.email);
  assert.equal(demoUser, 'demo.family@example.com');
  // The owner's own sign-in is untouched (the same browser storage).
  const ownerUser = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-bwwupwbakefjhwropdin-auth-token')).user.email);
  assert.equal(ownerUser, OWNER);
  assert.equal(await page.locator('.demo-bar').count(), 0, 'no demo bar in the owner\'s tab');
  await ctx.close();
  assert.deepEqual(errors, []);
});

test('the owner rebuilds the demo data up to today', async () => {
  const { ctx, page, errors } = await ownerBoard();
  let asked = 0;
  await ctx.route('**/api/admin/demo/refresh', (r) => { asked++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"transactions":512,"name":"משפחת לוי (הדגמה)"}' }); });
  await page.click('.demo-card button:has-text("לרענן את הנתונים")');
  await page.waitForSelector('.toast:has-text("נתוני הדמו עודכנו: 512 תנועות")');
  assert.equal(asked, 1);
  await ctx.close();
  assert.deepEqual(errors, []);
});

test('the demo session that cannot be made says so, and no empty tab stays open', async () => {
  const { ctx, page, errors } = await ownerBoard();
  await ctx.route('**/api/admin/demo/session', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'לא מצאנו את חשבון הדמו.' }) }));
  const opened = [];
  ctx.on('page', (p) => opened.push(p));
  await page.click('.demo-card button:has-text("לפתוח את חשבון הדמו")');
  await page.waitForSelector('.toast:has-text("לא מצאנו את חשבון הדמו")');
  for (let i = 0; i < 20 && opened.some((p) => !p.isClosed()); i++) await page.waitForTimeout(100);
  assert.ok(opened.every((p) => p.isClosed()), 'the blank tab was closed');
  await ctx.close();
  assert.deepEqual(errors.filter((e) => !/404/.test(e)), []);
});
