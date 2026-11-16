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

async function open({ email = OWNER, catalog = {} } = {}) {
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
  // The chains' prices: by the list's names (none unless a test gives some).
  await page.route('**/rest/v1/rpc/price_search', (r) => {
    const qs = JSON.parse(r.request().postData()).p_queries;
    const rows = [];
    qs.forEach((q, i) => Object.entries(catalog).forEach(([k, ps]) => { if (q.includes(k)) ps.forEach((p) => rows.push({ q: i + 1, ...p })); }));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
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

test('the advisor writes a list as a cart: filled before your eyes, sized to the people, built on what this home buys, added on one tap', async () => {
  const { page, db, asked, errors } = await open();
  const card = page.locator('.cart-card');
  await card.waitFor();
  // The advisor fills the cart first, then the list shows.
  await card.locator('.cart-fill').waitFor();
  await card.locator('.cl-row').first().waitFor();
  assert.equal(await card.locator('.cart-fill').count(), 0);
  // What it was built on: the purchases (receipts too), the list, the people.
  const shop = asked[0].summary.shopping;
  assert.deepEqual(shop.usual[0], { name: 'חלות', times: 2, qty: '2', lastPrice: 12.9 });
  assert.deepEqual(shop.onList, ['ביצים']);
  assert.equal(Object.keys(asked[0].summary)[0], 'shopping', 'first, so a long summary keeps it');
  assert.match(await card.locator('.cart-title').textContent(), /רשימה לשבת.*כשר: מהדרין/);
  assert.doesNotMatch(await page.locator('.adv-msg.ai').last().textContent(), /@@|"items"/);
  // Eggs are on the list already: not in the cart, said once.
  assert.equal(await card.locator('.cl-row', { hasText: 'ביצים' }).count(), 0);
  assert.match(await card.locator('.cart-have').textContent(), /ביצים/);
  // No price next to a line until a chain is opened.
  assert.equal(await card.locator('.cart-p').count(), 0);
  // Six people, then three (typed in): the amounts follow; the candles stay one package.
  const q = async () => card.locator('.cart-q').allTextContents();
  assert.deepEqual(await q(), ['1.5 ק"ג', '4', '2 בקבוקים', '1 חבילה']);
  const ppl = card.locator('input[aria-label="כמה אנשים"]');
  assert.equal(await ppl.inputValue(), '6');
  await ppl.fill('3');
  assert.deepEqual(await q(), ['750 גרם', '2', '1 בקבוק', '1 חבילה']);
  await ppl.fill('12');
  assert.deepEqual(await q(), ['3 ק"ג', '8', '4 בקבוקים', '1 חבילה']);
  // Nonsense is not taken.
  await ppl.fill('0');
  assert.deepEqual(await q(), ['3 ק"ג', '8', '4 בקבוקים', '1 חבילה']);
  await ppl.fill('3');
  // Out of the cart, back, and out again.
  await card.locator('button[aria-label="להוציא נרות שבת"]').click();
  assert.match(await card.locator('.cl-row.gone').textContent(), /נרות שבת.*להחזיר/);
  await card.locator('.cl-row.gone .cart-back').click();
  assert.equal(await card.locator('.cl-row.gone').count(), 0);
  await card.locator('button[aria-label="להוציא נרות שבת"]').click();
  assert.match(await card.locator('.cart-add').textContent(), /\(3\)/);
  await card.locator('.cart-add').click();
  await card.locator('.cart-done').waitFor();
  const added = db.tables.shopping_items.filter((i) => !['s1', 's2', 's3'].includes(i.id)).map((i) => [i.name, i.qty, i.aisle]);
  assert.deepEqual(added, [['עגבניות', '750 גרם', 'produce'], ['חלות', '2', 'bakery'], ['יין לקידוש', '1 בקבוק', 'drinks']]);
  assert.match(await card.locator('.cart-done').textContent(), /נוספו 3 פריטים/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the cheapest chain at the bottom; opening it shows each line\'s price, and the other chains', async () => {
  // (Vegetables are sold by the kilo; the rest by the unit.)
  const offer = (name, a, b, unit = 'יחידות') => [{ barcode: name, name, names: name, qty: 1, unit, offers: [{ chain: 'x', chain_name: 'רשת א', price: a }, { chain: 'y', chain_name: 'רשת ב', price: b }], kosher: {} }];
  const cat = { 'עגבני': offer('עגבניות', 6, 7, 'ק"ג'), 'חלה': offer('חלה', 10, 9), 'יין': offer('יין לקידוש', 30, 32), 'נרות': offer('נרות שבת', 12, 12) };
  const { page } = await open({ catalog: cat });
  const card = page.locator('.cart-card');
  await card.locator('.cl-row').first().waitFor();
  await page.waitForFunction(() => /הכי זול/.test(document.querySelector('.cart-sum').textContent));
  const sum = async () => (await card.locator('.cart-sum').textContent()).replace(/\s+/g, ' ');
  const before = await sum();
  assert.match(before, /הכי זול: רשת א.*≈ ₪\s?\d/);
  assert.equal(await card.locator('.cart-p').count(), 0);
  await card.locator('.cart-sum').click();
  assert.equal(await card.locator('.cart-p').count(), 4, 'a price for each line');
  assert.equal(await card.locator('.cart-chains button').count(), 2);
  assert.equal(await card.locator('.cart-chains button[aria-selected="true"]').textContent().then((t) => /רשת א/.test(t)), true);
  await card.locator('.cart-chains button', { hasText: 'רשת ב' }).click();
  assert.equal(await card.locator('.cart-chains button[aria-selected="true"]').textContent().then((t) => /רשת ב/.test(t)), true);
  // Taking a line out changes the cost.
  await card.locator('button[aria-label="להוציא יין לקידוש"]').click();
  await page.waitForFunction((b) => document.querySelector('.cart-sum').textContent.replace(/\s+/g, ' ') !== b, before);
  await page.close();
});

test('with no prices found the cart says so, and still adds', async () => {
  const { page } = await open();
  const card = page.locator('.cart-card');
  await card.locator('.cl-row').first().waitFor();
  await page.waitForFunction(() => !/בודק מחירים/.test(document.querySelector('.cart-sum').textContent));
  assert.match(await card.locator('.cart-sum').textContent(), /לא מצאנו מחירים/);
  assert.equal(await card.locator('.cart-add').isDisabled(), false);
  await page.close();
});

test('everyone else: no shopping data is sent to the advisor yet', async () => {
  const { page, asked } = await open({ email: null });
  await page.waitForSelector('.adv-msg.ai:not(:has(.adv-thinking))');
  assert.equal(asked[0].summary.shopping, undefined);
  await page.close();
});
