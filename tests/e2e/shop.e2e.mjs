import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const TODAY = new Date(2026, 10, 8, 10);

async function open(width = 1280, setup = () => {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  const db = makeFakeDb(TODAY);
  db.tables.shopping_items = [];
  db.tables.households = [{ id: db.hid, shop_area: null }];
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/shop');
  await page.waitForSelector('.shop-add');
  return { page, db, errors };
}

test('shopping is a tab on the computer menu and on the phone bar, marked new', async () => {
  const { page, errors } = await open(1280);
  assert.equal(await page.locator('.side-item[href="#/shop"]').count(), 1);
  assert.equal(await page.locator('.side-item[href="#/shop"][aria-current="page"]').count(), 1);
  assert.equal((await page.locator('.side-item[href="#/shop"] .nav-tag').textContent()).trim(), 'חדש');
  await page.close();
  const phone = await open(390);
  assert.equal(await phone.page.locator('.bottom-nav .nav-item[href="#/shop"]').count(), 1);
  assert.equal((await phone.page.locator('.bottom-nav .nav-item[href="#/shop"] .nav-tag').textContent()).trim(), 'חדש');
  await phone.page.close();
  assert.deepEqual(errors, []);
});

test('several items in one line with Enter, sorted by department, only the keyboard', async () => {
  const { page, db, errors } = await open();
  await page.locator('.shop-add .input').fill('חלב, 2 ביצים, לחם ועגבניות');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shop-item');
  assert.deepEqual(await page.locator('.shop-aisle').allTextContents(), ['ירקות ופירות', 'מאפים', 'מוצרי חלב']);
  assert.equal(await page.locator('.shop-item').count(), 4);
  assert.match(await page.locator('.shop-item', { hasText: 'ביצים' }).textContent(), /×2/);
  assert.equal(db.tables.shopping_items.length, 4);
  // The box is empty again and still focused, ready for the next item.
  assert.equal(await page.locator('.shop-add .input').inputValue(), '');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('input')), true);
  // The same item twice is not added again.
  await page.keyboard.type('חלב');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast');
  assert.equal(db.tables.shopping_items.length, 4);
  // Check an item with the keyboard: Tab to its box, Space.
  await page.locator('.shop-item', { hasText: 'לחם' }).locator('input[type=checkbox]').focus();
  await page.keyboard.press('Space');
  await page.waitForSelector('.shop-item.done');
  assert.equal(db.tables.shopping_items.find((i) => i.name === 'לחם').done, true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('finishing a shopping remembers it: the previous list and what you usually buy', async () => {
  const at = (d) => '2026-11-0' + d + 'T10:00:00Z';
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.shopping_items = [
      { id: 's1', household_id: d.hid, name: 'אורז', aisle: 'dry', done: true, created_at: at(1), cleared_at: at(2) },
      { id: 's2', household_id: d.hid, name: 'קפה', aisle: 'dry', done: true, created_at: at(1), cleared_at: at(2) },
      { id: 's3', household_id: d.hid, name: 'חלב', aisle: 'dairy', done: true, created_at: at(7) },
      { id: 's4', household_id: d.hid, name: 'שמפו', aisle: 'care', done: false, created_at: at(7) }
    ];
  });
  // Before finishing, the last finished shopping is offered back.
  const prev = page.locator('.shop-side .card', { hasText: 'הרשימה מהפעם הקודמת' });
  assert.match(await prev.textContent(), /אורז, קפה/);
  await page.locator('.shop-finish').click();
  await page.waitForFunction(() => !document.querySelector('.shop-finish'));
  // What was bought left the list; what was not stays for next time.
  assert.deepEqual(await page.locator('.shop-item .shop-name').allTextContents(), ['שמפו']);
  assert.ok(db.tables.shopping_items.find((i) => i.id === 's3').cleared_at);
  assert.equal(db.tables.shopping_items.find((i) => i.id === 's1').cleared_at, at(2), 'an older shopping is not touched');
  assert.match(await prev.textContent(), /חלב/);
  // One click brings it back to the list.
  await prev.locator('button').click();
  await page.waitForSelector('.shop-item >> text=חלב');
  // A chip from what you usually buy adds one item.
  await page.locator('.shop-side .chip', { hasText: 'אורז' }).click();
  await page.waitForSelector('.shop-item >> text=אורז');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the food budget beside the list, the area is saved, and sharing by email first, WhatsApp last', async () => {
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב', qty: '×2', aisle: 'dairy', done: false, created_at: '2026-11-07T10:00:00Z' }];
  });
  assert.match(await page.locator('.shop-budget').textContent(), /נשאר לסופר החודש/);
  assert.match(await page.locator('.shop-budget').textContent(), /מתוך ₪3,000 לאוכל|עברתם את התקציב לאוכל/);
  await page.locator('.shop-area .input').fill('בית שמש');
  await page.locator('.shop-area button').click();
  await page.waitForSelector('.toast');
  assert.equal(db.tables.households[0].shop_area, 'בית שמש');
  const mail = await page.locator('.shop-tools a').first().getAttribute('href');
  assert.match(decodeURIComponent(mail), /^mailto:\?subject=רשימת קניות&body=מוצרי חלב:\n☐ חלב \(×2\)/);
  // WhatsApp too, but last: most people here share by email or print.
  const tools = await page.locator('.shop-tools > *').allTextContents();
  assert.deepEqual(tools.map((t) => t.trim()), ['לשלוח במייל', 'להעתיק', 'להדפיס', 'וואטסאפ']);
  assert.match(decodeURIComponent(await page.locator('.shop-tools a', { hasText: 'וואטסאפ' }).getAttribute('href')), /^https:\/\/wa\.me\/\?text=רשימת קניות\n\nמוצרי חלב:\n☐ חלב \(×2\)/);
  // The printed page holds the list.
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.shop-print').isVisible(), true);
  assert.match(await page.locator('.shop-print').textContent(), /חלב \(×2\)/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the first time, what the tab is for: saving at the supermarket; "הבנתי" hides it for good, "מה זה?" brings it back', async () => {
  const { page, errors } = await open(1280);
  const intro = page.locator('.shop-intro');
  assert.match(await intro.textContent(), /עוזרים לכם לחסוך בסופר/);
  assert.equal(await intro.locator('.shop-benefits li').count(), 4);
  assert.match(await intro.textContent(), /בקרוב: איפה הכי זול באזור/);
  await intro.locator('.shop-intro-ok').click();
  assert.equal(await page.locator('.shop-intro').count(), 0);
  await page.reload();
  await page.waitForSelector('.shop-add');
  assert.equal(await page.locator('.shop-intro').count(), 0, 'stays hidden');
  await page.locator('.shop-what').click();
  assert.equal(await page.locator('.shop-intro').count(), 1);
  // Beside the list: how much a week keeps the food budget.
  assert.match(await page.locator('.shop-week').textContent(), /כדי לעמוד בתקציב: עד ₪[\d,]+ לשבוע עד סוף החודש/);
  assert.deepEqual(errors, []);
  await page.close();
});
