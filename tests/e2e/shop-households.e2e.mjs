import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser } from './helpers.mjs';
import { HOUSEHOLDS, openHousehold as openIn } from './households.mjs';

// The Shabbat testing rounds: 15 made-up households (households.mjs) going
// through the shopping tab, one test per round.
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
