import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// The app's own mailbox (the owner): lists in the conversation are his for now.
const OWNER = 'budgetapp2852@gmail.com';
const LIST = { title: 'רשימה לשבת', people: 6, kosher: 'מהדרין', items: [
  { name: 'עגבניות', qty: 1.5, unit: 'ק"ג', aisle: 'produce' },
  { name: 'חלות', qty: 4, unit: '', aisle: 'bakery' },
  { name: 'יין לקידוש', qty: 2, unit: 'בקבוקים', aisle: 'drinks' },
  { name: 'נרות שבת', qty: 1, unit: 'חבילה', aisle: 'other', scale: false },
  { name: 'ביצים', qty: 12, unit: '', aisle: 'dairy' }
] };

async function open({ email = OWNER } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  db.tables.shopping_items = [
    // Bought before (from a receipt and the list), and one already on the list.
    { id: 's1', household_id: db.hid, name: 'חלות', qty: '2', aisle: 'bakery', done: true, done_at: '2026-11-06T12:00:00Z', cleared_at: '2026-11-06T12:00:00Z', created_at: '2026-11-05T12:00:00Z' },
    { id: 's2', household_id: db.hid, name: 'חלות', qty: '2', aisle: 'bakery', done: true, done_at: '2026-11-13T12:00:00Z', cleared_at: '2026-11-13T12:00:00Z', created_at: '2026-11-12T12:00:00Z' },
    { id: 's3', household_id: db.hid, name: 'ביצים', qty: null, aisle: 'dairy', done: false, done_at: null, cleared_at: null, created_at: '2026-11-15T12:00:00Z' }
  ];
  db.tables.shop_receipts = [{ id: 'r1', household_id: db.hid, store: 'סופר בדוי', bought_on: '2026-11-13', total: 40, items: [{ name: 'חלות', price: 12.9 }], created_at: '2026-11-13T12:00:00Z' }];
  const errors = collectErrors(page);
  const asked = [];
  await mockSupabase(page, db);
  await page.route('**/api/ai/advice-chat-stream', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    const body = ['הכנתי רשימה לשבת ל-6 נפשות.', '\n@@רשימה: ' + JSON.stringify(LIST), '\n@@הצעות: בלי בשר?'].map((d) => 'data: ' + JSON.stringify({ delta: d }) + '\n\n').join('') + 'data: {"done":true}\n\n';
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await signIn(page, server.base);
  if (email) await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, email);
  await page.goto(server.base + '/app/#/home');
  await page.reload();
  await page.waitForSelector('.hero');
  await page.click('.ask-fab');
  await page.fill('[aria-label="שאלה ליועץ"]', 'תכין לי רשימה לשבת, אנחנו 6, כשר למהדרין');
  await page.click('.adv-compose button[type="submit"]');
  return { page, db, asked, errors };
}

test('the advisor writes a list: sized to the people, built on what this home buys, added to "קניות" on one tap', async () => {
  const { page, db, asked, errors } = await open();
  const card = page.locator('.sl');
  await card.waitFor();
  // What it was built on: the purchases (receipts too), the list, the people.
  const shop = asked[0].summary.shopping;
  assert.deepEqual(shop.usual[0], { name: 'חלות', times: 2, qty: '2', lastPrice: 12.9 });
  assert.deepEqual(shop.onList, ['ביצים']);
  assert.equal(Object.keys(asked[0].summary)[0], 'shopping', 'first, so a long summary keeps it');
  assert.match(await card.locator('.sl-h').textContent(), /רשימה לשבת.*כשר: מהדרין/);
  assert.doesNotMatch(await page.locator('.adv-msg.ai').last().textContent(), /@@|"items"/);
  // Six people, then three: the amounts follow; the candles stay one package.
  const q = async () => card.locator('.sl-q').allTextContents();
  // (Eggs are on the list already: no amount shown for them.)
  assert.deepEqual(await q(), ['1.5 ק"ג', '4', '2 בקבוקים', '1 חבילה']);
  await card.locator('button[aria-label="פחות"]').click();
  await card.locator('button[aria-label="פחות"]').click();
  await card.locator('button[aria-label="פחות"]').click();
  assert.deepEqual(await q(), ['750 גרם', '2', '1 בקבוק', '1 חבילה']);
  // Already on the list: shown, not checkable, not added again.
  assert.equal(await card.locator('input[aria-label="ביצים"]').isDisabled(), true);
  assert.match(await card.locator('.sl-have').textContent(), /ביצים/);
  await card.locator('input[aria-label="נרות שבת"]').uncheck();
  await card.locator('button:has-text("להוסיף ל")').click();
  await card.locator('.sl-done').waitFor();
  const added = db.tables.shopping_items.filter((i) => !['s1', 's2', 's3'].includes(i.id)).map((i) => [i.name, i.qty, i.aisle]);
  assert.deepEqual(added, [['עגבניות', '750 גרם', 'produce'], ['חלות', '2', 'bakery'], ['יין לקידוש', '1 בקבוק', 'drinks']]);
  assert.match(await card.locator('.sl-done').textContent(), /נוספו 3 פריטים/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the cost: asked of the chains on a tap; with no prices found, says so', async () => {
  const { page } = await open();
  const card = page.locator('.sl');
  await card.waitFor();
  await card.locator('button:has-text("כמה זה יעלה")').click();
  await card.locator('.sl-cost').waitFor();
  await page.waitForFunction(() => !/בודק מחירים/.test(document.querySelector('.sl-cost').textContent));
  assert.match(await card.locator('.sl-cost').textContent(), /לא מצאנו מחירים|בערך/);
  await page.close();
});

test('everyone else: no shopping data is sent to the advisor yet', async () => {
  const { page, asked } = await open({ email: null });
  await page.waitForSelector('.adv-msg.ai:not(:has(.adv-thinking))');
  assert.equal(asked[0].summary.shopping, undefined);
  await page.close();
});
