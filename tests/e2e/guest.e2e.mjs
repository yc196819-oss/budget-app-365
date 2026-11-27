import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
// The app's public contact address, which is also the owner's (as in the other tests).
const OWNER = 'budgetapp2852@gmail.com';

async function guestPage({ active = true, width = 390, scheme = 'light' } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const errors = collectErrors(page);
  await mockSupabase(page, makeFakeDb());
  const calls = { search: [] };
  await page.route('**/api/guest/shop/' + TOKEN, (r) => (active ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"label":"רינה"}' }) : r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"x"}' })));
  await page.route('**/api/guest/shop/' + TOKEN + '/search', (r) => {
    const q = JSON.parse(r.request().postData()).queries;
    calls.search.push(q);
    const rows = q.map((term, i) => ({ q: i + 1, barcode: String(7290000000100 + i), name: term + ' 1 ליטר', names: '', qty: 1, unit: 'ליטר', kosher: {}, offers: [{ chain: 'x', chain_name: 'רשת א', price: 6 + i }, { chain: 'y', chain_name: 'רשת ב', price: 5 + i }] }));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows }) });
  });
  await page.route('**/api/guest/shop/' + TOKEN + '/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.goto(server.base + '/app/#/guest/' + TOKEN);
  return { page, errors, calls };
}

test('a shopping link opens the shopping page alone, without an account: a list, the advisor, the prices', async () => {
  const { page, errors, calls } = await guestPage();
  await page.locator('.guest-shop .shop-add').waitFor();
  assert.match(await page.locator('.guest-head').textContent(), /רינה/);
  // Nothing else of the app: no menu, no tabs, no sign-in.
  assert.equal(await page.locator('.bottom-nav, .side-item, .login').count(), 0);
  await page.locator('.shop-add .input').fill('חלב, 2 ביצים');
  await page.keyboard.press('Enter');
  await page.locator('.shop-item', { hasText: 'ביצים' }).waitFor();
  assert.equal(await page.locator('.shop-item').count(), 2);
  // The advisor's list for the week.
  await page.click('.adv-cta');
  await page.locator('.adv-list').waitFor();
  await page.click('.adv-list button.btn');
  assert.ok(await page.locator('.shop-item').count() > 2, 'the advisor added items');
  // Kept in this browser: still there after a reload.
  const n = await page.locator('.shop-item').count();
  await page.reload();
  await page.locator('.shop-item').first().waitFor();
  assert.equal(await page.locator('.shop-item').count(), n);
  // The price comparison: the kashrut question once, then the chains.
  await page.click('.shop-prices-cta button');
  await page.click('button:has-text("בלי העדפה: הכי זול")');
  await page.locator('.pp-hero').waitFor();
  assert.ok(calls.search.length >= 1 && calls.search.every((q) => q.length <= 15));
  assert.match(await page.locator('.price-panel').textContent(), /מחירים כלליים של הרשתות/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a cancelled link says so, and shows nothing', async () => {
  const { page } = await guestPage({ active: false });
  await page.locator('text=הקישור לא פעיל').waitFor();
  assert.equal(await page.locator('.shop-add').count(), 0);
  await page.close();
});

for (const scheme of ['light', 'dark']) {
  test('the shopping page by a link passes WCAG AA (' + scheme + ')', async () => {
    const { page, errors } = await guestPage({ scheme });
    await page.locator('.guest-shop .shop-add').waitFor();
    await page.locator('.shop-add .input').fill('חלב, לחם');
    await page.keyboard.press('Enter');
    await page.locator('.shop-item').first().waitFor();
    await page.evaluate(AXE);
    const v = await page.evaluate(async () => (await window.axe.run(document.querySelector('.guest-shop'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] })).violations.map((x) => x.id + ': ' + x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')));
    assert.deepEqual(v, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('the owner makes a link, sees it once, and can cancel it', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  db.tables.shopping_items = [];
  await mockSupabase(page, db);
  let links = [];
  await page.route('**/api/admin/guest-links**', (r) => {
    const m = r.request().method();
    if (m === 'POST') { links = [{ id: '11111111-1111-1111-1111-111111111111', label: JSON.parse(r.request().postData()).label, created_at: '2026-11-15T08:00:00Z', revoked: false, last_used_at: null, uses: 0 }]; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ link: links[0], token: TOKEN }) }); }
    if (m === 'DELETE') { links = links.map((l) => ({ ...l, revoked: true })); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ links }) });
  });
  await signIn(page, server.base);
  await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, OWNER);
  await page.reload();
  await page.click('button[aria-label^="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.click('.admin-hub-btn:has-text("מחירי סופר")');
  const card = page.locator('.admin-guest');
  // A test link (a list of its own); "הבית שלנו" would share the owner's list.
  assert.equal(await card.locator('input[type=radio]').count(), 2);
  await card.locator('label:has-text("לבדיקה") input').check();
  await card.locator('input[aria-label="למי הקישור"]').fill('רינה');
  await card.locator('button:has-text("ליצור קישור")').click();
  assert.equal(await card.locator('.admin-guest-made input').inputValue(), server.base + '/app/#/guest/' + TOKEN);
  await card.locator('li', { hasText: 'רינה' }).waitFor();
  assert.match(await card.locator('li').textContent(), /עוד לא נכנסו/);
  await card.locator('button[aria-label="לבטל את הקישור של רינה"]').click();
  await card.locator('li.off').waitFor();
  assert.match(await card.locator('li').textContent(), /בוטל/);
  // (The owner board's own numbers are not served here: the test server has no database.)
  assert.deepEqual(errors.filter((e) => !/status of 503/.test(e)), []);
  await page.close();
});

test('the server: an unknown or malformed link gets nothing, and only the signed-in owner makes links', async () => {
  const get = (p, opts) => fetch(server.base + p, opts);
  assert.equal((await get('/api/guest/shop/' + TOKEN)).status, 404);
  assert.equal((await get('/api/guest/shop/short')).status, 404);
  const s = await get('/api/guest/shop/' + TOKEN + '/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"queries":["חלב"]}' });
  assert.equal(s.status, 404);
  // Refused without a signed-in owner (401; 503 on this test server, which has no database).
  const refused = (r) => [401, 503].includes(r.status);
  assert.ok(refused(await get('/api/admin/guest-links')));
  assert.ok(refused(await get('/api/admin/guest-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })));
  assert.ok(refused(await get('/api/admin/guest-links/11111111-1111-1111-1111-111111111111', { method: 'DELETE' })));
});

test('a home link (a partner): the household\'s own list, saved on the server, the same one the owner sees', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = collectErrors(page);
  await mockSupabase(page, makeFakeDb());
  // The household's list on the server (made-up items).
  let list = [{ id: '11111111-1111-1111-1111-111111111111', name: 'חלב', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-15T08:00:00Z', cleared_at: null, barcode: null }];
  const sent = [];
  await page.route('**/api/guest/shop/' + TOKEN, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"label":"הבית","home":true}' }));
  await page.route('**/api/guest/shop/' + TOKEN + '/items**', (r) => {
    const m = r.request().method();
    sent.push(m);
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: list }) });
    if (m === 'POST') { const add = JSON.parse(r.request().postData()).items.map((x, i) => ({ ...x, id: '2222222' + i + '-2222-2222-2222-222222222222', done: false, created_at: '2026-11-15T08:01:00Z', cleared_at: null, barcode: null })); list = [...list, ...add]; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: add }) }); }
    if (m === 'PATCH') { const id = r.request().url().split('/').pop(); list = list.map((x) => (x.id === id ? { ...x, ...JSON.parse(r.request().postData()) } : x)); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (m === 'DELETE') { const id = r.request().url().split('/').pop(); list = list.filter((x) => x.id !== id); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    return r.continue();
  });
  // Something left in this browser from a test link is not mixed in.
  await page.goto(server.base + '/app/');
  await page.evaluate(() => localStorage.setItem('guest:list', JSON.stringify([{ id: 'gx', name: 'מוצר מקישור אחר', aisle: 'other', done: false, created_at: 'x', cleared_at: null }])));
  await page.goto(server.base + '/app/#/guest/' + TOKEN);
  await page.reload();
  await page.locator('.shop-item', { hasText: 'חלב' }).waitFor();
  assert.match(await page.locator('.guest-head').textContent(), /רשימה משותפת של הבית/);
  assert.equal(await page.locator('.shop-item', { hasText: 'מוצר מקישור אחר' }).count(), 0);
  await page.locator('.shop-add .input').fill('לחם');
  await page.keyboard.press('Enter');
  await page.locator('.shop-item', { hasText: 'לחם' }).waitFor();
  assert.ok(list.some((x) => x.name === 'לחם'), 'saved on the server');
  await page.locator('.shop-item', { hasText: 'חלב' }).locator('input[type=checkbox]').check();
  for (let i = 0; i < 20 && !list.find((x) => x.name === 'חלב').done; i++) await page.waitForTimeout(100);
  assert.equal(list.find((x) => x.name === 'חלב').done, true);
  await page.click('button[aria-label="להוריד את לחם מהרשימה"]');
  for (let i = 0; i < 20 && list.some((x) => x.name === 'לחם'); i++) await page.waitForTimeout(100);
  assert.equal(list.some((x) => x.name === 'לחם'), false);
  assert.ok(sent.includes('POST') && sent.includes('PATCH') && sent.includes('DELETE'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('round 5 (the Shabbat testing): on a shopping link, a thing already on the list says so, "קוטג\'" is "קוטג", and finished shoppings older than 120 days leave the browser', async () => {
  const { page, errors } = await guestPage();
  await page.locator('.guest-shop .shop-add').waitFor();
  await page.evaluate(() => localStorage.setItem('guest:list', JSON.stringify([
    { id: 'old', name: 'אורז', aisle: 'dry', done: true, created_at: '2025-01-01T10:00:00Z', cleared_at: '2025-01-02T10:00:00Z' },
    { id: 'recent', name: 'קפה', aisle: 'dry', done: true, created_at: new Date(Date.now() - 5 * 86400000).toISOString(), cleared_at: new Date(Date.now() - 4 * 86400000).toISOString() }
  ])));
  await page.reload();
  await page.locator('.guest-shop .shop-add').waitFor();
  await page.locator('.shop-add .input').fill('קוטג\', חלב');
  await page.keyboard.press('Enter');
  await page.locator('.shop-item', { hasText: 'חלב' }).waitFor();
  await page.locator('.shop-add .input').fill('קוטג');
  await page.keyboard.press('Enter');
  await page.locator('.guest-shop [role=status]', { hasText: 'קוטג כבר ברשימה' }).waitFor();
  assert.equal(await page.locator('.shop-item').count(), 2);
  await page.locator('.shop-add .input').fill('חלב, קוטג׳');
  await page.keyboard.press('Enter');
  await page.locator('.guest-shop [role=status]', { hasText: 'הכול כבר ברשימה' }).waitFor();
  // Saving again keeps only what is recent.
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('guest:list')).map((i) => i.id));
  assert.equal(kept.includes('old'), false);
  assert.equal(kept.includes('recent'), true);
  assert.deepEqual(errors, []);
  await page.close();
});
