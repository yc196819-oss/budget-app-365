import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn } from './helpers.mjs';

// On a phone nothing may stick out sideways: the page would shift left and
// right under the finger, and a button can end up off the screen (the setup
// guide's "save" for the monthly income did).
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

for (const width of [360, 390]) {
  test('no screen is wider than a ' + width + 'px phone', async () => {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await mockSupabase(page, makeFakeDb());
    await signIn(page, server.base);
    const wide = [];
    for (const hash of ['#/home', '#/money', '#/money/cats', '#/money/report', '#/together', '#/plans', '#/assets']) {
      await page.goto(server.base + '/app/' + hash);
      await page.waitForSelector('main');
      await page.waitForTimeout(700);
      const off = await page.evaluate(() => {
        const W = window.innerWidth;
        return [...document.querySelectorAll('main *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); })
          .slice(0, 3).map((el) => el.tagName.toLowerCase() + ' "' + (el.textContent || '').trim().slice(0, 20) + '"');
      });
      if (off.length) wide.push(hash + ': ' + off.join(', '));
    }
    assert.deepEqual(wide, []);
    await page.close();
  });
}

test('a narrower computer screen: the menu shrinks to icons, the advisor waits behind a button; both can be changed and are remembered', async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.waitForSelector('.home');
  assert.ok(await page.locator('.shell.nav-mini.no-rail').count(), 'small menu, no advisor rail');
  assert.equal(await page.locator('.rail').count(), 0);
  // The screen keeps most of the width.
  const main = await page.locator('.shell-main').boundingBox();
  assert.ok(main.width > 900, 'main width ' + main.width);
  // The advisor opens from the button.
  await page.click('.ask-fab');
  await page.waitForSelector('.sheet[aria-label="היועץ"]');
  await page.click('.rail-pin');
  await page.waitForSelector('.rail');
  // The menu opens wide again.
  await page.click('.side-mini');
  assert.equal(await page.locator('.shell.nav-mini').count(), 0);
  await page.reload();
  await page.waitForSelector('.rail');
  assert.equal(await page.locator('.shell.nav-mini').count(), 0, 'remembered');
  await page.click('.rail-hide');
  assert.equal(await page.locator('.rail').count(), 0);
  await page.close();
});

test('a wide computer screen keeps both the menu and the advisor open', async () => {
  const page = await browser.newPage({ viewport: { width: 1536, height: 860 } });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.waitForSelector('.rail');
  assert.equal(await page.locator('.shell.nav-mini').count(), 0);
  await page.close();
});
