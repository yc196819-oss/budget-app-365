import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, launchBrowser } from './helpers.mjs';
import { HOUSEHOLDS, openHousehold as openIn } from './households.mjs';

// The Shabbat testing rounds: 15 made-up households (households.mjs) going
// through the shopping tab, one test per round.
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const openHousehold = (h, setup) => openIn(browser, server, h, setup);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test('round 1: each household types its list in one line; every item lands in a department, the screen fits, one is checked, one removed', async () => {
  for (const h of HOUSEHOLDS) {
    const { page, db, errors } = await openHousehold(h);
    await page.locator('.shop-add .input').fill(h.line);
    await page.keyboard.press('Enter');
    const n = h.line.split(',').length + (h.line.match(/ ונרות/) ? 1 : 0);
    await page.waitForFunction((k) => document.querySelectorAll('.shop-item').length === k, n);
    // Nothing they typed is left without a department.
    const other = db.tables.shopping_items.filter((i) => i.aisle === 'other').map((i) => i.name);
    assert.deepEqual(other, [], h.name + ': ' + other.join(', '));
    assert.equal(await noSideways(page), true, h.name + ' at ' + h.width + 'px: no sideways scroll');
    await page.locator('.shop-item input[type=checkbox]').first().check();
    await page.waitForSelector('.shop-item.done');
    await page.locator('.shop-item .shop-del').last().click();
    await page.waitForFunction((k) => document.querySelectorAll('.shop-item').length === k, n - 1);
    assert.deepEqual(errors, [], h.name);
    await page.close();
  }
});

test('round 2: in the store, each household marks, hides, undoes and finishes; "352,90" is saved as ₪352.90, and a word is not a sum', async () => {
  for (const h of HOUSEHOLDS.filter((_, i) => i % 3 === 0)) {
    const { page, db, errors } = await openHousehold(h);
    await page.locator('.shop-add .input').fill(h.line);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shop-item');
    await page.click('.store-go');
    const tiles = page.locator('.store-tile');
    const n = await tiles.count();
    await tiles.nth(0).click();
    await tiles.nth(1).click();
    await page.click('.store-hide');
    assert.equal(await page.locator('.store-tile').count(), n - 2, h.name + ': what was bought is hidden');
    await page.click('.store-hide');
    assert.equal(await noSideways(page), true, h.name);
    await page.click('.store-foot .btn');
    const sum = page.locator('.trip-finish input[aria-label="כמה שילמתם"]');
    await sum.fill('הרבה');
    assert.equal(await page.locator('.trip-finish .btn-ghost').isDisabled(), true, 'not a sum: not saved as nothing');
    assert.match(await page.locator('.trip-bad').textContent(), /לא נראה כמו סכום/);
    await sum.fill('352,90');
    await page.click('.trip-finish .btn-ghost');
    await page.waitForFunction(() => !document.querySelector('.trip-finish'));
    for (let i = 0; i < 30 && !db.tables.shop_trips?.[0]?.total; i++) await page.waitForTimeout(100);
    assert.equal(db.tables.shop_trips[0].total, 352.9, h.name);
    await page.waitForFunction((k) => document.querySelectorAll('.shop-item').length === k, n - 2).catch(() => {});
    assert.equal(await page.locator('.shop-item').count(), n - 2, h.name + ': the rest stays on the list');
    assert.deepEqual(errors, [], h.name);
    await page.close();
  }
});

test('round 3: lists: a list for Shabbat, finished on its own; closing the last list leaves "הרשימות שלי" with a fresh one, not the old one-list screen', async () => {
  const { page, db, errors } = await openHousehold(HOUSEHOLDS[5]);
  await page.locator('.shop-add .input').fill('חלב, לחם');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 2);
  await page.click('.shop-listhead .back-btn');
  await page.click('.sl-new');
  await page.fill('#sl-name', 'לשבת');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shop-listhead h2:has-text("לשבת")');
  await page.locator('.shop-add .input').fill('יין לקידוש, חלות');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 2);
  await page.locator('.shop-item', { hasText: 'חלות' }).locator('input[type=checkbox]').check();
  await page.click('.shop-finish');
  await page.click('.trip-finish .btn-ghost');
  await page.waitForFunction(() => !document.querySelector('.trip-finish'));
  await page.click('.shop-listhead .back-btn');
  // One thing bought: said so, not "1 מוצרים".
  assert.match(await page.locator('.sl-trips .sl-chat').first().textContent(), /מוצר אחד/);
  // The other list was not touched.
  assert.match(await page.locator('.sl-main .sl-chat', { hasText: 'הרשימה שלי' }).textContent(), /0 מתוך 2/);
  // Close both lists, one after the other.
  for (const name of ['לשבת', 'הרשימה שלי']) {
    await page.locator('.sl-main .sl-chat', { hasText: name }).click();
    await page.waitForSelector('.shop-add');
    while (await page.locator('.shop-del').count()) { const n = await page.locator('.shop-del').count(); await page.locator('.shop-del').first().click(); await page.waitForFunction((k) => document.querySelectorAll('.shop-del').length < k, n); }
    await page.click('.shop-archive');
    await page.waitForSelector('.sl-main');
  }
  // Still "הרשימות שלי", with a new empty list to start from.
  await page.waitForSelector('.sl-main .sl-chat');
  assert.deepEqual((await page.locator('.sl-main .sl-chat b').allTextContents()), ['הרשימה שלי']);
  assert.equal(db.tables.shopping_lists.filter((l) => !l.archived_at).length, 1);
  assert.equal(await page.locator('.shop-head').count(), 0, 'not the old one-list screen');
  assert.deepEqual(errors, []);
  await page.close();
});

test('round 6: readable for everyone, light and dark: the list, the store, "save the shopping", the advisor\'s cart and the lists pass the accessibility check', async () => {
  const axe = async (page, where) => {
    await page.evaluate(AXE);
    const bad = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', ')));
    assert.deepEqual(bad, [], where);
  };
  for (const [idx, scheme] of [[8, 'light'], [4, 'dark']]) {
    const h = HOUSEHOLDS[idx];
    const { page, errors } = await openHousehold(h);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.locator('.shop-add .input').fill(h.line);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shop-item');
    await page.locator('.shop-item input[type=checkbox]').first().check();
    await axe(page, h.name + ' list, ' + scheme);
    await page.click('.store-go');
    await axe(page, h.name + ' store, ' + scheme);
    await page.keyboard.press('Escape');
    await page.click('.shop-finish');
    await page.waitForSelector('.trip-finish');
    await axe(page, h.name + ' save the shopping, ' + scheme);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.trip-finish'));
    await page.click('.adv-cta');
    await page.waitForSelector('.cart-builder');
    await axe(page, h.name + ' cart, ' + scheme);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.cart-builder'));
    await page.click('.shop-listhead .back-btn');
    await page.waitForSelector('.sl-chat');
    await axe(page, h.name + ' lists, ' + scheme);
    assert.deepEqual(errors, [], h.name);
    await page.close();
  }
});

test('round 7: a list pasted from WhatsApp into the add box: one item per line, beside what was typed', async () => {
  const { page, db, errors } = await openHousehold(HOUSEHOLDS[9]);
  const paste = (text) => page.evaluate((t) => {
    const el = document.querySelector('.shop-add .input');
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await page.locator('.shop-add .input').fill('אקונומיקה, ');
  await paste('רשימה לשבת:\n1. חלב 3%\n2. ביצים x2\n• לחם 🍞\n- עגבניות');
  assert.equal(await page.locator('.shop-add .input').inputValue(), 'אקונומיקה, חלב 3%, ביצים x2, לחם, עגבניות');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 5);
  assert.deepEqual(db.tables.shopping_items.map((i) => i.name).sort(), ['אקונומיקה', 'ביצים', 'חלב 3%', 'לחם', 'עגבניות'].sort());
  assert.deepEqual(errors, []);
  await page.close();
});

test('round 8: a very long name (one long word too) stays inside its tile in the store and its row in the lists, on the smallest phone', async () => {
  const { page, errors } = await openHousehold(HOUSEHOLDS[4]);
  const outside = () => page.evaluate(() => [...document.querySelectorAll('.store-n, .shop-name, .sl-mid b')].filter((e) => { const b = e.getBoundingClientRect(); const p = e.closest('.store-tile, .shop-item, .sl-chat, .sl-compare').getBoundingClientRect(); return b.right > p.right + 1 || b.left < p.left - 1; }).map((e) => e.textContent));
  await page.locator('.shop-add .input').fill('אבקתכביסהמרוכזתבמיוחדלמכונותחזיתיות, גבינה צהובה עמק 28% פרוסה דקה במיוחד מארז חסכוני משפחתי');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 2);
  assert.deepEqual(await outside(), [], 'the list');
  await page.click('.store-go');
  await page.waitForSelector('.store-tile .store-n');
  // (Escape is listened for once the screen has settled: body.store-on.)
  await page.waitForSelector('body.store-on');
  assert.deepEqual(await outside(), [], 'the store');
  assert.equal(await noSideways(page), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.store'));
  await page.click('.shop-listhead .back-btn');
  await page.click('.sl-new');
  await page.fill('#sl-name', 'רשימהארוכהמאודלחגהפסחשלכלהמשפחההמורחבתעםכלהדודים');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shop-add');
  await page.click('.shop-listhead .back-btn');
  await page.waitForSelector('.sl-chat');
  assert.deepEqual(await outside(), [], 'the lists');
  assert.equal(await noSideways(page), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('round 10: the advisor\'s cart for 0, 45 or no people says so instead of quietly making a cart for another number', async () => {
  const { page, errors } = await openHousehold(HOUSEHOLDS[10]);
  await page.click('.adv-cta');
  await page.waitForSelector('.cart-builder');
  await page.locator('.cb-kind', { hasText: 'אורחים' }).click();
  await page.locator('.cb-meal button', { hasText: 'חלבית' }).click();
  const go = page.locator('.cart-builder button.btn', { hasText: 'להכין את העגלה' });
  for (const bad of ['0', '45', '']) {
    await page.fill('.cb-people input', bad);
    assert.equal(await go.isDisabled(), true, JSON.stringify(bad));
    assert.match(await page.locator('#cb-people-bad').textContent(), /בין 1 ל-30/);
  }
  await page.fill('.cb-people input', '12');
  assert.equal(await page.locator('#cb-people-bad').count(), 0);
  await go.click();
  await page.waitForSelector('.cart-card .cart-num:not([disabled])', { timeout: 15000 });
  assert.equal(await page.locator('.cart-card .cart-num').inputValue(), '12', 'the cart is for the 12 typed');
  assert.deepEqual(errors, []);
  await page.close();
});

test('round 11: a list of only fresh vegetables: the comparison says why they are not compared, not "write simpler names"', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../fixtures/prices-sample.json', import.meta.url), 'utf8'));
  const { page, errors } = await openHousehold(HOUSEHOLDS[7], (d) => {
    d.tables.shopping_items = ['מלפפון', 'בצל'].map((name, i) => ({ id: 'v' + i, household_id: d.hid, name, qty: null, aisle: 'produce', done: false, created_at: '2026-11-26T08:00:00Z', cleared_at: null }));
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
    const chains = [...new Set(Object.values(catalog).flat().flatMap((p) => p.offers.map((o) => o.chain)))];
    d.tables.household_stores = chains.map((chain, i) => ({ household_id: d.hid, chain, chain_name: chain, store_id: String(i), name: 'סניף בדוי', city: 'כפר בלום', km: 2, kind: 'city' }));
  });
  await page.route('**/api/prices/reach**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"counts":[1,1,1,1,1,1,1,1,1,1,1]}' }));
  await page.route('**/rest/v1/rpc/price_search', (r) => {
    const qs = JSON.parse(r.request().postData()).p_queries;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qs.flatMap((q, i) => (catalog[q] || []).map((p) => ({ q: i + 1, ...p })))) });
  });
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  await page.waitForSelector('.pp-empty');
  assert.match(await page.locator('.pp-empty').textContent(), /רק מוצרים טריים.*נמכרים במשקל/);
  assert.doesNotMatch(await page.locator('.pp-empty').textContent(), /שמות פשוטים/);
  assert.deepEqual(errors, []);
  await page.close();
});
