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

const TODAY = new Date(2026, 10, 8, 10);

// (The shopping tab is the owner's for now: the tests open it as the owner;
// openRegular opens the regular view he can switch to, as families will see it.)
let regularView = false;
const openRegular = async (...a) => { regularView = true; try { return await open(...a); } finally { regularView = false; } };
async function open(width = 1280, setup = () => {}, email = OWNER) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  const db = makeFakeDb(TODAY);
  db.tables.shopping_items = [];
  db.tables.households = [{ id: db.hid, shop_area: null }];
  // The family's area is set (made-up), so the price tests start at the list.
  db.tables.household_area = [{ household_id: db.hid, city_code: '2610', city: 'בית שמש', hood: null }];
  // A branch near them at each made-up chain (a chain with no branch near
  // is not compared at all).
  db.tables.household_stores = ['x', 'y', 'mishnat-yosef', 'tiv-taam'].map((chain, i) => ({ household_id: db.hid, chain, chain_name: chain, store_id: String(i + 1), name: 'סניף בדוי', city: 'בית שמש', km: 1, kind: 'city' }));
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  // The chains' logos (our server fetches them from the chains' sites; no internet here).
  await page.route('**/api/chain-logo/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  await signIn(page, server.base);
  if (email) await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, email);
  // The regular view: what a family will see, tried by the owner (the switch on his board).
  if (regularView) await page.evaluate(() => localStorage.setItem('owner:shop-as-user', '1'));
  await page.goto(server.base + '/app/#/shop');
  await page.reload();
  // The owner sees "הרשימות שלי" first: into the (first) list.
  await page.waitForSelector('.shop-add, .sl-chat');
  if (!(await page.locator('.shop-add').count())) await page.locator('.sl-chat').first().click();
  await page.waitForSelector('.shop-add');
  return { page, db, errors };
}

test('shopping is a tab on the computer menu and on the phone bar, marked as a trial', async () => {
  const { page, errors } = await open(1280);
  assert.equal(await page.locator('.side-item[href="#/shop"]').count(), 1);
  assert.equal(await page.locator('.side-item[href="#/shop"][aria-current="page"]').count(), 1);
  assert.equal((await page.locator('.side-item[href="#/shop"] .nav-tag').textContent()).trim(), 'בהרצה');
  await page.close();
  const phone = await open(390);
  assert.equal(await phone.page.locator('.bottom-nav .nav-item[href="#/shop"]').count(), 1);
  assert.equal((await phone.page.locator('.bottom-nav .nav-item[href="#/shop"] .nav-tag').textContent()).trim(), 'בהרצה');
  await phone.page.close();
  assert.deepEqual(errors, []);
});

test('several items in one line with Enter, sorted by department, only the keyboard', async () => {
  const { page, db, errors } = await open();
  await page.locator('.shop-add .input').fill('חלב, 2 ביצים, לחם ועגבניות');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shop-item');
  assert.deepEqual((await page.locator('.shop-aisle').allTextContents()).map((t) => t.replace(/\d+$/, '')), ['ירקות ופירות', 'מאפים', 'מוצרי חלב']);
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
  // The screen marks it at once; the save reaches the database a moment later.
  for (let i = 0; i < 30 && !db.tables.shopping_items.find((x) => x.name === 'לחם').done; i++) await page.waitForTimeout(100);
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
  await page.click('.trip-finish .btn-ghost');
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
  const { page, db, errors } = await openRegular(1280, (d) => {
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
  const { page, errors } = await openRegular(1280);
  const intro = page.locator('.shop-intro');
  assert.match(await intro.textContent(), /עוזרים לכם לחסוך בסופר/);
  assert.equal(await intro.locator('.shop-benefits li').count(), 3);
  // No price promise in the intro: the comparison is shown only as "coming soon", with sample products.
  assert.doesNotMatch(await intro.textContent(), /הכי זול/);
  assert.match(await page.locator('.price-teaser').textContent(), /בקרוב.*דוגמה בלבד/s);
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

test('a trial: the tab says so, and "כתבו לנו" opens the feedback form', async () => {
  const { page, errors } = await open(1280);
  assert.match(await page.locator('.shop-trial').textContent(), /בהרצה: הטאב חדש ועוד משתפר, וייתכנו תקלות/);
  await page.locator('.shop-trial-talk').click();
  await page.waitForSelector('.sheet');
  assert.match(await page.locator('.sheet').textContent(), /תקל|רעיון/);
  assert.deepEqual(errors, []);
  await page.close();
});

const OWNER = 'budgetapp2852@gmail.com';

// Made-up products and prices for the price comparison.
const CATALOG = {
  'חלב 3%': [
    { barcode: '1001', name: 'חלב 3% בשקית', names: 'חלב 3% בשקית', maker: 'מחלבה א', qty: 1, unit: 'ליטר', offers: [{ chain: 'x', chain_name: 'רשת א', price: 6.2 }, { chain: 'y', chain_name: 'רשת ב', price: 6.6 }], kosher: { certs: { 'בד"ץ העדה החרדית': 3 } } },
    { barcode: '1002', name: 'חלב 3% קרטון', names: 'חלב 3% קרטון', maker: 'מחלבה ב', qty: 1, unit: 'ליטר', offers: [{ chain: 'y', chain_name: 'רשת ב', price: 5.5 }], kosher: { open: 'רבנות' } }
  ],
  'ביצים': [
    { barcode: '2001', name: 'ביצים L 12', names: 'ביצים L 12', maker: 'משק', qty: 12, unit: 'יחידות', offers: [{ chain: 'x', chain_name: 'רשת א', price: 14.9 }, { chain: 'y', chain_name: 'רשת ב', price: 13.9 }], kosher: {} }
  ]
};
async function priceRoutes(page, { found = {}, db } = {}) {
  const calls = { search: [], fetch: [] };
  const cat = JSON.parse(JSON.stringify(CATALOG));
  await page.route('**/rest/v1/rpc/price_search', (r) => {
    const qs = JSON.parse(r.request().postData()).p_queries;
    calls.search.push(qs);
    const rows = [];
    // The household's own marks count, as in the database.
    const mine = (code) => ((db && db.tables.kosher_votes) || []).filter((v) => v.barcode === code);
    qs.forEach((q, i) => (cat[q] || []).forEach((p) => {
      const certs = { ...(p.kosher.certs || {}) };
      mine(p.barcode).forEach((v) => { certs[v.cert] = (certs[v.cert] || 0) + 1; });
      rows.push({ q: i + 1, ...p, kosher: { ...p.kosher, certs, mine_cert: mine(p.barcode)[0]?.cert || null } });
    }));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  // No photos unless a test gives some.
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.route('**/api/prices/fetch', (r) => { calls.fetch.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"runId":"run123abc","asked":1}' }); });
  await page.route('**/api/prices/fetch/run123abc', (r) => { Object.assign(cat, found); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"done":true,"status":"SUCCEEDED","products":1,"offers":2}' }); });
  return { calls, cat };
}

test('prices: the household picks the certifiers it relies on once, then every item gets the cheapest product with one of them', async () => {
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.shopping_items = [
      { id: 's1', household_id: d.hid, name: 'חלב 3%', qty: '×2', aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null },
      { id: 's2', household_id: d.hid, name: 'ביצים', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:01:00Z', cleared_at: null },
      { id: 's3', household_id: d.hid, name: 'קפה', qty: null, aisle: 'dry', done: false, created_at: '2026-11-08T08:02:00Z', cleared_at: null }
    ];
    d.tables.price_prefs = [];
    d.tables.kosher_votes = [];
  }, OWNER);
  const { calls } = await priceRoutes(page, { db, found: { 'קפה': [{ barcode: '3001', name: 'קפה נמס 200 גרם', names: 'קפה נמס 200 גרם', maker: 'קלייה', qty: 200, unit: 'גרם', offers: [{ chain: 'x', chain_name: 'רשת א', price: 21 }], kosher: { owner_cert: 'הרב לנדא' } }] } });
  await page.click('.shop-prices-cta button');
  // First the kashrut question: which certifiers, several at once, saved for the household.
  const picker = page.locator('.price-certs');
  assert.equal(await picker.locator('button:has-text("לשמור")').isDisabled(), true, 'nothing picked yet');
  await picker.locator('.chip', { hasText: 'העדה החרדית' }).click();
  await picker.locator('.chip:has-text("הרב לנדא")').click();
  await picker.locator('button:has-text("לשמור (2)")').click();
  // The save goes out on the click; wait for it to land before checking.
  for (let i = 0; i < 50 && !db.tables.price_prefs.length; i++) await page.waitForTimeout(100);
  assert.deepEqual(db.tables.price_prefs[0].certs, ['בד"ץ העדה החרדית', 'הרב לנדא']);
  assert.equal(db.tables.price_prefs[0].kosher, 'mehadrin');
  await page.waitForSelector('.price-item');
  assert.deepEqual(calls.search[0], ['חלב 3%', 'ביצים', 'קפה'], 'the whole list in one search');
  assert.match(await page.locator('.price-pref:not(.price-area):not(.pp-clubs-row):not(.pp-shabbat-row)').textContent(), /בד"ץ העדה החרדית · הרב לנדא/);
  // Milk: the one with their certifier, though the other (another certifier) is cheaper.
  const milk = page.locator('.price-item', { hasText: 'חלב 3%' }).first();
  assert.match(await milk.textContent(), /חלב 3% בשקית.*בד"ץ העדה החרדית/);
  assert.equal(await milk.locator('.pp-tag.t-cert.fits').count(), 1, 'their certifier, marked as fitting');
  // Eggs: nobody marked the kashrut yet: priced, marked "not verified", and
  // the household can say what the package shows.
  const eggs = page.locator('.price-item', { hasText: 'ביצים' }).first();
  assert.match(await eggs.textContent(), /ביצים L 12.*כשרות לא אומתה/);
  assert.match(await page.locator('.pp-note-k').textContent(), /מוצר אחד.*לבדוק את החותמת/);
  await eggs.locator('.pp-row-h').click();
  assert.equal(await eggs.locator('.price-vote .chip').count(), 0, 'the certifiers stay closed until asked');
  assert.equal(await page.locator('.ask-fab').isVisible(), false, 'the advisor button does not cover the prices');
  await eggs.locator('.price-vote-open', { hasText: 'מה כתוב על האריזה' }).first().click();
  await eggs.locator('.price-vote .chip:has-text("הרב לנדא")').click();
  for (let i = 0; i < 50 && !db.tables.kosher_votes.length; i++) await page.waitForTimeout(100);
  assert.deepEqual(db.tables.kosher_votes.map((v) => [v.barcode, v.cert, v.level]), [['2001', 'הרב לנדא', 'mehadrin']]);
  await page.waitForSelector('.price-item.is-auto:has-text("ביצים L 12")');
  // Coffee was not in our catalog: asked of the service once, then found.
  assert.deepEqual(calls.fetch[0].queries, ['קפה']);
  await page.waitForSelector('.price-item.is-auto:has-text("קפה נמס")', { timeout: 15000 });
  // The whole list at each chain, cheapest first (milk counted twice).
  await page.waitForSelector('.pp-hero:has-text("₪48.30")');
  assert.match(await page.locator('.pp-hero').textContent(), /₪48\.30ברשת א.*הכי משתלם/);
  assert.match(await page.locator('.pp-bar').first().textContent(), /רשת א₪48\.30/);
  assert.match(await milk.textContent(), /₪12\.40.*2 × ₪6\.20/, 'two cartons: the line\'s total, and the price of one');
  // Another chain: its own total and what it has not got.
  await page.locator('.pp-bar', { hasText: 'רשת ב' }).click();
  assert.match(await page.locator('.pp-hero').textContent(), /ברשת ב/);
  assert.match(await page.locator('.price-item', { hasText: 'קפה' }).textContent(), /אין ברשת ב/);
  // The total of a chain that has not got everything says so, and what.
  assert.match(await page.locator('.pp-hero .pp-missing').textContent(), /בלי מוצר אחד שאין ברשת ב: קפה/);
  assert.match(await page.locator('.pp-bar', { hasText: 'רשת ב' }).textContent(), /בלי מוצר אחד/);
  assert.equal(await page.locator('.pp-bar', { hasText: 'רשת ב' }).locator('.pp-bar-gap').count(), 1, 'what the missing coffee would add, striped');
  await page.close();
  assert.deepEqual(errors, []);
});

test('prices: a product shows its photo from the open product database, or the sign of its department', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [
      { id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null },
      { id: 's2', household_id: d.hid, name: 'ביצים', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:01:00Z', cleared_at: null }
    ];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  await priceRoutes(page);
  const asked = [];
  // A 1x1 picture stands in for the database's photo.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://images.openfoodfacts.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/api/prices/images', (r) => {
    asked.push(JSON.parse(r.request().postData()).barcodes);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: { 1002: 'https://images.openfoodfacts.org/images/products/1002/front.200.jpg' } }) });
  });
  await page.click('.shop-prices-cta button');
  const milk = page.locator('.price-item', { hasText: 'חלב 3%' }).first();
  await milk.locator('.price-img img').waitFor();
  assert.match(await milk.locator('.price-img img').getAttribute('src'), /^https:\/\/images\.openfoodfacts\.org\//);
  // Eggs have no photo: the dairy sign instead.
  const eggs = page.locator('.price-item', { hasText: 'ביצים' }).first();
  assert.equal(await eggs.locator('.price-img.sign svg').count(), 1, 'a line icon, not an emoji');
  // Asked once, for what is on screen.
  assert.equal(asked.length, 1);
  assert.deepEqual([...asked[0]].sort(), ['1001', '1002', '2001']);
  await page.close();
  assert.deepEqual(errors, []);
});

test('prices: the family says only where it lives; the nearest branch at every chain is found, and its prices are used', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
    d.tables.household_area = [];
  }, OWNER);
  const asked = [];
  await page.route('**/rest/v1/rpc/price_search', (r) => {
    // As in the database: with the area set, each chain's offer says whether it is the near branch's.
    const local = db.tables.household_stores.length > 0;
    const offers = [{ chain: 'x', chain_name: 'רשת א', price: local ? 6.0 : 6.2, store: local ? 'סניף נחל דולב' : null, local }, { chain: 'y', chain_name: 'רשת ב', price: 5.5, store: null, local: false }];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ q: 1, barcode: '1001', name: 'חלב 3% בשקית', names: '', maker: 'מחלבה א', qty: 1, unit: 'ליטר', offers, kosher: {} }]) });
  });
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.route('**/api/prices/places**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ places: [{ code: '2610', name: 'בית שמש' }, { code: '9200', name: 'בית שאן' }] }) }));
  await page.route('**/api/prices/area', (r) => {
    const b = JSON.parse(r.request().postData());
    asked.push(b);
    db.tables.household_area = [{ household_id: b.hid, city_code: b.city_code, city: 'בית שמש', hood: b.hood, max_km: b.max_km }];
    db.tables.household_stores = [{ household_id: b.hid, chain: 'x', chain_name: 'רשת א', store_id: '7', name: 'סניף נחל דולב', city: 'בית שמש', km: 0, kind: 'hood' }];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ area: { city_code: b.city_code, city: 'בית שמש', hood: b.hood, max_km: b.max_km }, stores: db.tables.household_stores }) });
  });
  await page.click('.shop-prices-cta button');
  const pick = page.locator('.price-area-pick');
  await pick.waitFor();
  assert.equal(await pick.locator('.price-chain, .chip').count(), 0, 'no chain or branch to choose');
  await pick.locator('input[aria-label="יישוב"]').fill('בית ש');
  await pick.locator('.price-area-list button:has-text("בית שמש")').click();
  await pick.locator('input[aria-label="שכונה"]').fill('רמת בית שמש א');
  // How far they go: 25 km unless they say, in steps of 5.
  assert.match(await pick.textContent(), /25 ק"מ/);
  await pick.locator('input.price-km').fill('10');
  assert.match(await pick.textContent(), /10 ק"מ/);
  await pick.locator('button:has-text("למצוא סניפים קרובים")').click();
  await page.waitForSelector('.price-area:has-text("רמת בית שמש א, בית שמש")', { state: 'attached' });
  assert.match(await page.locator('.pp-set summary').textContent(), /בית שמש/, 'the folded settings line names the place');
  assert.match(await page.locator('.price-area').textContent(), /סניף אחד עד 10 ק"מ/);
  assert.deepEqual(asked, [{ hid: db.hid, city_code: '2610', hood: 'רמת בית שמש א', max_km: 10 }]);
  // Only the chain with a branch near them, at that branch's price, with its name.
  await page.waitForSelector('.pp-hero:has-text("₪6.00")');
  assert.equal(await page.locator('.pp-bar').count(), 1, 'the far chain is not compared');
  assert.match(await page.locator('.pp-hero').textContent(), /ברשת א.*סניף נחל דולב/);
  await page.close();
  assert.deepEqual(errors, []);
});

test('prices: "not now" leaves the general prices, and the area can be chosen later', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
    d.tables.household_area = [];
  }, OWNER);
  await priceRoutes(page);
  await page.click('.shop-prices-cta button');
  await page.locator('.price-area-pick button:has-text("לא עכשיו")').click();
  await page.waitForSelector('.price-item');
  assert.match(await page.locator('.price-area').textContent(), /מחירים כלליים.*לבחור אזור/);
  await page.close();
  assert.deepEqual(errors, []);
});

test('prices: changing the product for an item is remembered on the list', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  await priceRoutes(page);
  await page.click('.shop-prices-cta button');
  const item = page.locator('.price-item').first();
  await item.waitFor();
  assert.match(await item.textContent(), /חלב 3% קרטון/, 'no preference: the cheapest');
  await item.locator('.pp-row-h').click();
  await item.locator('.price-opts li', { hasText: 'חלב 3% בשקית' }).locator('.price-pick').click();
  await page.waitForSelector('.price-item.is-chosen:has-text("חלב 3% בשקית")');
  assert.equal(db.tables.shopping_items[0].barcode, '1001');
  await page.close();
  assert.deepEqual(errors, []);
});

test('prices for everyone else: a "coming soon" preview with sample products, and "tell me when it opens"', async () => {
  const { page, errors } = await openRegular(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
  });
  const sent = [];
  await page.route('**/api/telemetry', (r) => { sent.push(r.request().postData()); return r.fulfill({ status: 204, body: '' }); });
  await page.waitForSelector('.price-teaser');
  assert.equal(await page.locator('.shop-prices-cta').count(), 0, 'no real comparison yet');
  assert.match(await page.locator('.price-teaser').textContent(), /בקרוב.*דוגמה בלבד/s);
  await page.click('.price-teaser button:has-text("תודיעו לי")');
  await page.waitForSelector('.price-teaser-ok');
  await page.reload();
  await page.waitForSelector('.price-teaser-ok');
  await page.close();
  assert.deepEqual(errors, []);
});

test('the advisor fills a cart (the owner first): a ready one for Shabbat, sized to the people, filled before your eyes, then on the list', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.households = [{ id: d.hid, shop_area: null, people: 4 }];
    d.tables.shopping_items = [
      { id: 'o1', household_id: d.hid, name: 'במבה', qty: null, aisle: 'dry', done: true, created_at: '2026-11-01T08:00:00Z', cleared_at: '2026-11-01T10:00:00Z' },
      { id: 's1', household_id: d.hid, name: 'עגבניות', qty: null, aisle: 'produce', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }
    ];
  }, OWNER);
  let asked = 0;
  await page.route('**/api/ai/shop-cart', (r) => { asked++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"list":null}' }); });
  await page.click('.adv-cta');
  const build = page.locator('.cart-builder button:has-text("להכין את העגלה")');
  assert.equal(await build.isDisabled(), true, 'what for, first');
  // Guests: dairy or meat is asked.
  await page.click('.cb-kind:has-text("ארוחה לאורחים")');
  assert.equal(await build.isDisabled(), true);
  await page.click('.cb-meal button:has-text("חלבית")');
  assert.equal(await build.isDisabled(), false);
  await page.click('.cb-kind:has-text("לשבת")');
  assert.equal(await page.locator('.cb-meal').count(), 0);
  assert.equal(await page.locator('.cart-builder input[aria-label="כמה אנשים"]').inputValue(), '4', 'the people at home');
  await page.locator('.cart-builder input[aria-label="כמה אנשים"]').fill('6');
  await build.click();
  await page.locator('.cart-fill').waitFor();
  await page.locator('.cart-card .cl-row').first().waitFor({ timeout: 10000 });
  assert.equal(asked, 0, 'no buying history yet: the ready cart, no AI');
  assert.match(await page.locator('.cart-title').textContent(), /סל לשבת/);
  assert.equal(await page.locator('.cl-row', { hasText: 'חלות' }).locator('.cart-q').textContent(), '4');
  assert.equal(await page.locator('.cl-row', { hasText: 'נרות שבת' }).locator('.cart-q').textContent(), '1 חבילה');
  await page.click('button[aria-label="להוציא נרות שבת"]');
  const n = Number((await page.locator('.cart-add').textContent()).match(/\((\d+)\)/)[1]);
  await page.click('.cart-add');
  await page.locator('.cart-done').waitFor();
  const added = db.tables.shopping_items.slice(2);
  assert.equal(added.length, n);
  assert.ok(!added.some((x) => x.name === 'נרות שבת'));
  assert.equal(added.find((x) => x.name === 'חלות').qty, '4');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a cart from a recipe link: read by the advisor, sized for the people, pantry things marked', async () => {
  const { page, db } = await open(390, (d) => { d.tables.households = [{ id: d.hid, shop_area: null, people: 6 }]; d.tables.shopping_items = []; }, OWNER);
  const sent = [];
  await page.route('**/api/ai/recipe', (r) => {
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recipe: { title: 'שקשוקה', servings: 4, items: [{ name: 'ביצים', qty: 6, unit: "יח'", aisle: 'dairy' }, { name: 'שמן זית', qty: 3, unit: 'כפות', pantry: true }] } }) });
  });
  await page.click('.adv-cta');
  await page.click('.cb-kind:has-text("ממתכון")');
  await page.locator('input[aria-label="קישור למתכון"]').fill('https://recipes.example.co.il/shakshuka');
  await page.click('.rcp button:has-text("לקרוא את המתכון")');
  await page.locator('.cart-card .cl-row').first().waitFor({ timeout: 10000 });
  assert.equal(sent[0].url, 'https://recipes.example.co.il/shakshuka');
  assert.match(await page.locator('.cart-title').textContent(), /שקשוקה/);
  assert.equal(await page.locator('.cl-row', { hasText: 'ביצים' }).locator('.cart-q').textContent(), "9 יח'");
  assert.match(await page.locator('.cl-row', { hasText: 'שמן זית' }).textContent(), /יש בבית/);
  await page.click('.cart-add');
  await page.locator('.cart-done').waitFor();
  assert.deepEqual(db.tables.shopping_items.map((i) => i.name), ['ביצים']);
  await page.close();
});

test('a recipe page shared from the phone opens the cart from a recipe, with its link', async () => {
  const { page } = await open(390, (d) => { d.tables.households = [{ id: d.hid, shop_area: null, people: 4 }]; d.tables.shopping_items = []; }, OWNER);
  await page.evaluate(async () => {
    const c = await caches.open('shared-files');
    await c.put('/shared/0', new Response('שקשוקה של סבתא\nhttps://recipes.example.co.il/shakshuka', { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-name': 'shared.txt', 'x-at': String(Date.now()) } }));
  });
  await page.goto(server.base + '/app/?action=shared');
  await page.locator('.cart-builder .rcp').waitFor({ timeout: 10000 });
  assert.match(await page.locator('textarea[aria-label="טקסט המתכון"]').inputValue(), /שקשוקה של סבתא[\s\S]*recipes\.example/);
  await page.close();
});

test('a home that has bought enough before: the advisor makes the ready cart its own', async () => {
  const bought = (id, name, day) => ({ id, household_id: 'h1', name, qty: null, aisle: 'dairy', done: true, created_at: day, cleared_at: day });
  const { page } = await open(390, (d) => {
    d.tables.households = [{ id: d.hid, shop_area: null, people: 3 }];
    d.tables.shopping_items = ['גבינה לבנה 5%', 'במבה', 'קפה טורקי', 'פיתות'].flatMap((n, i) => [bought('a' + i, n, '2026-11-01T10:00:00Z'), bought('b' + i, n, '2026-11-08T10:00:00Z')]);
  }, OWNER);
  const sent = [];
  await page.route('**/api/ai/shop-cart', (r) => {
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { title: 'סל לשבוע', people: 3, items: [{ name: 'גבינה לבנה 5%', qty: 3, unit: 'גביעים', aisle: 'dairy' }, { name: 'פיתות', qty: 2, unit: 'חבילות', aisle: 'bakery' }] } }) });
  });
  await page.click('.adv-cta');
  await page.click('.cb-kind:has-text("לשבוע")');
  await page.click('.cart-builder button:has-text("להכין את העגלה")');
  await page.locator('.cart-card .cl-row').first().waitFor({ timeout: 10000 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cart.title, 'סל לשבוע');
  assert.ok(sent[0].usual.some((u) => u.name === 'קפה טורקי' && u.times === 2));
  assert.deepEqual(await page.locator('.cart-card .cart-n').allTextContents(), ['פיתות', 'גבינה לבנה 5%']);
  await page.close();
});

test('in the store (the owner first): big tiles by department, a tap marks bought and back, the screen kept on, finishing from there', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shopping_items = [
      { id: 'a1', household_id: d.hid, name: 'עגבניות', aisle: 'produce', qty: '1 ק"ג', done: false, created_at: '2026-11-07T10:00:00Z' },
      { id: 'a2', household_id: d.hid, name: 'חלב', aisle: 'dairy', done: false, created_at: '2026-11-07T10:00:00Z' },
      { id: 'a3', household_id: d.hid, name: 'לחם', aisle: 'bakery', done: false, created_at: '2026-11-07T10:00:00Z' }
    ];
  });
  // A made-up wake lock, to see that the screen is asked to stay on and let go.
  await page.evaluate(() => {
    window.__lock = { asked: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__lock.asked++; return { release: async () => { window.__lock.released++; } }; } } });
  });
  await page.click('.store-go');
  await page.waitForSelector('.store');
  await page.waitForFunction(() => window.__lock.asked === 1);
  assert.deepEqual(await page.locator('.store-aisle h2').evaluateAll((h) => h.map((x) => x.firstChild.textContent.trim())), ['ירקות ופירות', 'מאפים', 'מוצרי חלב']);
  assert.match(await page.locator('.store-tile', { hasText: 'עגבניות' }).textContent(), /1 ק"ג/);
  assert.match(await page.locator('.store-title').textContent(), /נקנו 0 מתוך 3/);
  // Big enough for a thumb in a shop.
  const box = await page.locator('.store-tile').first().boundingBox();
  assert.ok(box.height >= 70 && box.width >= 150, JSON.stringify(box));
  await page.locator('.store-tile', { hasText: 'חלב' }).click();
  await page.waitForSelector('.store-tile.done');
  assert.match(await page.locator('.store-title').textContent(), /נקנו 1 מתוך 3/);
  for (let i = 0; i < 30 && !db.tables.shopping_items.find((x) => x.id === 'a2').done; i++) await page.waitForTimeout(100);
  assert.equal(db.tables.shopping_items.find((x) => x.id === 'a2').done, true);
  // A second tap takes it back.
  await page.locator('.store-tile', { hasText: 'חלב' }).click();
  await page.waitForFunction(() => !document.querySelector('.store-tile.done'));
  await page.locator('.store-tile', { hasText: 'חלב' }).click();
  await page.locator('.store-tile', { hasText: 'לחם' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.store-tile.done').length === 2);
  // Hiding what was bought leaves what is still to find.
  await page.click('.store-hide');
  await page.waitForSelector('.store-hide.on');
  assert.deepEqual(await page.locator('.store-tile .store-n').allTextContents(), ['עגבניות']);
  await page.click('.store-hide');
  // Finishing from the store: the screen lets go, and the trip is saved.
  await page.click('.store-foot .btn');
  await page.waitForFunction(() => !document.querySelector('.store'));
  await page.waitForFunction(() => window.__lock.released === 1);
  await page.waitForSelector('.trip-finish');
  await page.click('.trip-finish .btn-ghost');
  await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 1);
  assert.deepEqual(await page.locator('.shop-item .shop-name').allTextContents(), ['עגבניות']);
  assert.ok(db.tables.shopping_items.find((x) => x.id === 'a3').cleared_at);
  assert.equal(db.tables.shop_trips.length, 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('finishing a shopping saves a trip: the bought leave, the rest stay, a typed total is an expense of the supermarket, and the history shows it', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shopping_items = [
      { id: 'f1', household_id: d.hid, name: 'אורז', aisle: 'dry', done: true, created_at: '2026-11-07T10:00:00Z' },
      { id: 'f2', household_id: d.hid, name: 'קפה', aisle: 'dry', done: true, created_at: '2026-11-07T10:00:00Z' },
      { id: 'f3', household_id: d.hid, name: 'קשיו', aisle: 'dry', done: false, created_at: '2026-11-07T10:00:00Z' }
    ];
  });
  const before = db.tables.transactions.length;
  await page.click('.shop-finish');
  await page.waitForSelector('.trip-finish');
  assert.match(await page.locator('.trip-box.ok').textContent(), /2/);
  assert.match(await page.locator('.trip-box.left').textContent(), /1/);
  assert.match(await page.locator('.trip-why').textContent(), /נוכל לחסוך לכם יותר/);
  await page.selectOption('.trip-finish select', 'x');
  await page.fill('.trip-finish input[aria-label="כמה שילמתם"]', '250');
  await page.click('.trip-finish .btn-ghost');
  await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 1);
  const trip = db.tables.shop_trips[0];
  assert.equal(trip.chain, 'x');
  assert.equal(trip.bought, 2);
  assert.equal(trip.left_over, 1);
  assert.deepEqual(db.tables.shopping_items.filter((i) => i.trip_id === trip.id).map((i) => i.id).sort(), ['f1', 'f2']);
  // The total is an expense of the supermarket, waiting for the card's charge.
  assert.equal(db.tables.transactions.length, before + 1);
  const tx = db.tables.transactions.find((t) => t.id === trip.tx_id);
  assert.equal(tx.source, 'shop');
  assert.equal(Number(tx.amount), 250);
  assert.equal(tx.subcategory_id, 'super');
  // The history: what is left, and the trip without a receipt.
  await page.click('.trips-card');
  await page.waitForSelector('.trip-row');
  assert.match(await page.locator('.trip-left').textContent(), /נשאר להשלים · 1/);
  assert.match(await page.locator('.trip-row').textContent(), /2 מוצרים · 1 נשארו/);
  assert.match(await page.locator('.trip-row').textContent(), /בלי קבלה/);
  await page.click('.trip-row');
  await page.waitForSelector('.trip-nudge');
  await page.waitForFunction(() => document.querySelectorAll('.trip-view .chip').length === 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a receipt with barcodes: found by barcode (not by a similar name), deals shown, kilo prices, and the sums are over the same products', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shop_trips = [{ id: 'tr1', household_id: d.hid, finished_at: '2026-11-07T12:00:00Z', chain: 'x', chain_name: 'רשת א', bought: 2, left_over: 0, receipt_id: null, tx_id: null, total: null }];
  });
  await priceRoutes(page, { db });
  const asked = { codes: null, names: [] };
  const off = (price, promos = []) => ({ chain: 'x', chain_name: 'רשת א', price, promos });
  await page.route('**/rest/v1/rpc/price_by_barcodes', (r) => {
    asked.codes = JSON.parse(r.request().postData()).p_barcodes;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { barcode: '7290000000011', name: 'מיץ ענבים טבעי 1 ליטר', names: '', qty: 1, unit: 'ליטר', offers: [off(11.9)] },
      { barcode: '7290000000028', name: 'ג\'ל כביסה 5 ליטר', names: '', qty: 5, unit: 'ליטר', offers: [off(39.9, [{ text: '2 ב-64', unit_price: 32, need: 2, everyone: true }])] }
    ]) });
  });
  await page.route('**/rest/v1/rpc/price_search', (r) => {
    const qs = JSON.parse(r.request().postData()).p_queries;
    asked.names.push(...qs);
    const rows = [];
    qs.forEach((q, k) => { if (/דג/.test(q)) rows.push({ q: k + 1, barcode: '2001', name: 'דג פילה', names: '', qty: 1, unit: 'ק"ג', kosher: {}, offers: [off(59.9)] }); });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route('**/api/receipts/scan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store: 'רשת א', date: '2026-11-07', total: 200, items: [
    { name: 'מיץ ענבים', code: '7290000000011', qty: 1, price: 9.6 },
    { name: 'ג\'ל כביסה', code: '7290000000028', qty: 1, price: 32 },
    { name: 'דג פילה', code: '8611', qty: 1.5, price: 90, unit_price: 60, weighed: true },
    { name: 'שקית', qty: 1, price: 0.6 }
  ] }) }));
  await page.click('.trips-card');
  await page.click('.trip-row');
  await page.waitForSelector('.trip-nudge');
  await page.setInputFiles('.trip-nudge input[type=file]', { name: 'r.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await page.waitForSelector('.trip-table');
  // The barcodes were asked; by name only what they did not find.
  assert.deepEqual(asked.codes.sort(), ['7290000000011', '7290000000028', '8611']);
  assert.ok(!asked.names.some((n) => /מיץ|כביסה/.test(n)), 'nothing found by barcode is searched by name');
  assert.match(await page.locator('.trip-table tr', { hasText: 'ג\'ל כביסה' }).textContent(), /במבצע · 2 ב-64.*32\.00.*39\.90/);
  assert.match(await page.locator('.trip-table tr', { hasText: 'מיץ ענבים' }).textContent(), /זול מאצלנו.*9\.60.*11\.90/);
  assert.match(await page.locator('.trip-table tr', { hasText: 'דג פילה' }).textContent(), /לפי שם.*60\.00\s*לק"ג.*59\.90\s*לק"ג/);
  assert.equal(await page.locator('.trip-table tr.st-check').count(), 0);
  assert.match(await page.locator('.trip-sum').textContent(), /3\/4\s*מוצרים הושוו/);
  // 9.60 + 32 + 60×1.5 = 131.60 paid; 11.90 + 39.90 + 59.90×1.5 = 141.65 regular.
  assert.match(await page.locator('.trip-fair').textContent(), /על 3 המוצרים שהושוו שילמתם ₪131\.60.*₪141\.65.*חסכתם ₪10\.05/);
  assert.equal(db.tables.shop_receipts[0].items[0].code, '7290000000011', 'the barcodes are kept with the receipt');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a receipt for a trip: its prices against ours at the same chain, a big gap marked to check, and its total becomes the expense', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shop_trips = [{ id: 'tr1', household_id: d.hid, finished_at: '2026-11-07T12:00:00Z', chain: 'x', chain_name: 'רשת א', bought: 2, left_over: 0, receipt_id: null, tx_id: null, total: null }];
    d.tables.shopping_items = [{ id: 'g1', household_id: d.hid, name: 'חלב', aisle: 'dairy', done: true, created_at: '2026-11-06T10:00:00Z', cleared_at: '2026-11-07T12:00:00Z', trip_id: 'tr1' }];
  });
  await priceRoutes(page, { db });
  await page.route('**/api/receipts/scan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store: 'רשת א', date: '2026-11-07', total: 26.1, items: [{ name: 'חלב 3%', qty: 1, price: 6.2 }, { name: 'ביצים', qty: 1, price: 19.9 }] }) }));
  const before = db.tables.transactions.length;
  await page.click('.trips-card');
  await page.click('.trip-row');
  await page.waitForSelector('.trip-nudge');
  await page.setInputFiles('.trip-nudge input[type=file]', { name: 'r.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await page.waitForSelector('.trip-table');
  assert.match(await page.locator('.trip-table tr.st-check').textContent(), /ביצים.*19\.90.*14\.90/);
  assert.match(await page.locator('.trip-table tr.st-ok').textContent(), /חלב/);
  assert.match(await page.locator('.trip-sum .warn').textContent(), /1\s*לבדוק/);
  // Saved with the trip, and its total is the trip's expense.
  assert.equal(db.tables.shop_receipts[0].trip_id, 'tr1');
  assert.equal(db.tables.shop_trips[0].receipt_id, db.tables.shop_receipts[0].id);
  assert.equal(db.tables.transactions.length, before + 1);
  assert.equal(Number(db.tables.transactions.find((t) => t.source === 'shop').amount), 26.1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a thing not bought three trips in a row is offered to take off the list', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shop_trips = ['01', '03', '05'].map((day, i) => ({ id: 'q' + i, household_id: d.hid, finished_at: '2026-11-' + day + 'T12:00:00Z', chain: null, chain_name: null, bought: 1, left_over: 1 }));
    d.tables.shopping_items = [
      { id: 'h1', household_id: d.hid, name: 'ציפורן להבדלה', aisle: 'dry', done: false, created_at: '2026-10-25T10:00:00Z' },
      { id: 'h2', household_id: d.hid, name: 'חלב', aisle: 'dairy', done: false, created_at: '2026-11-04T10:00:00Z' }
    ];
  });
  await page.click('.trips-card');
  await page.waitForSelector('.trip-stale');
  assert.match(await page.locator('.trip-stale').textContent(), /"ציפורן להבדלה" לא נקנה 3 קניות ברצף/);
  await page.click('.trip-stale button');
  await page.waitForFunction(() => !document.querySelector('.trip-stale'));
  assert.deepEqual(db.tables.shopping_items.map((i) => i.id), ['h2']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a shopping expense and the card\'s line of the same business: both shown on the home screen, and only the household decides', async () => {
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.transactions.push(
      { id: 'sh1', household_id: d.hid, type: 'expense', amount: 600, description: 'רשת א', tx_date: '2026-11-05', source: 'shop', category_id: 'food', subcategory_id: 'super', created_at: '2026-11-05T10:00:00Z' },
      { id: 'cd1', household_id: d.hid, type: 'expense', amount: 612.4, description: 'רשת א סניף העיר', tx_date: '2026-11-06', source: 'import', card_id: 'c1', category_id: 'food', subcategory_id: 'super', created_at: '2026-11-06T10:00:00Z' }
    );
  });
  await page.goto(server.base + '/app/#/');
  await page.waitForSelector('.shoptwin');
  const text = await page.locator('.shoptwin').textContent();
  assert.match(text, /אולי אותה קנייה נרשמה פעמיים/);
  assert.match(text, /600/);
  assert.match(text, /612\.4/);
  // "Two different purchases": nothing is removed, and it is not asked again.
  await page.click('.shoptwin .btn-ghost');
  await page.waitForFunction(() => !document.querySelector('.shoptwin'));
  assert.ok(db.tables.transactions.find((t) => t.id === 'sh1'));
  await page.reload();
  await page.waitForSelector('.hero, .calm-hero, main');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.shoptwin').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the same purchase: the shopping expense goes and the card\'s charge stays', async () => {
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.transactions.push(
      { id: 'sh2', household_id: d.hid, type: 'expense', amount: 600, description: 'רשת א', tx_date: '2026-11-05', source: 'shop', category_id: 'food', created_at: '2026-11-05T10:00:00Z' },
      { id: 'cd2', household_id: d.hid, type: 'expense', amount: 612.4, description: 'רשת א', tx_date: '2026-11-05', source: 'import', card_id: 'c1', category_id: 'food', created_at: '2026-11-05T10:00:00Z' }
    );
  });
  await page.goto(server.base + '/app/#/');
  await page.waitForSelector('.shoptwin');
  await page.click('.shoptwin .btn:not(.btn-ghost)');
  await page.waitForFunction(() => !document.querySelector('.shoptwin'));
  assert.equal(db.tables.transactions.find((t) => t.id === 'sh2'), undefined);
  assert.ok(db.tables.transactions.find((t) => t.id === 'cd2'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('the store mode: Escape and ✕ leave it, and a phone with no wake lock still works', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 'b1', household_id: d.hid, name: 'אורז', aisle: 'dry', done: false, created_at: '2026-11-07T10:00:00Z' }];
  });
  await page.evaluate(() => { Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }); });
  await page.click('.store-go');
  await page.waitForSelector('.store');
  // Ready for keys once the screen has taken over the page.
  await page.waitForFunction(() => document.body.classList.contains('store-on'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.store'));
  await page.click('.store-go');
  await page.click('.store-x');
  await page.waitForFunction(() => !document.querySelector('.store'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('people who are not the owner do not see the advisor\'s week yet', async () => {
  const { page } = await openRegular(390);
  await page.waitForSelector('.shop-add');
  assert.equal(await page.locator('.adv-cta').count(), 0);
  await page.close();
});

test('a receipt photo: read, checked by the family, saved; the list learns what they buy and the comparison shows what they paid', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
    d.tables.shop_receipts = [];
  }, OWNER);
  await priceRoutes(page);
  const sent = [];
  // Made-up receipt.
  await page.route('**/api/receipts/scan', (r) => {
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store: 'סופר לדוגמה', date: '2026-11-06', total: 31.7, items: [
      { name: 'חלב 3% בשקית 1 ליטר', qty: 2, price: 11.8 }, { name: 'לחם אחיד פרוס', qty: 1, price: 7.4 }, { name: 'שוקולד מריר', qty: 1, price: 12.5 }] }) });
  });
  const card = page.locator('.rcpt-card');
  await card.waitFor();
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await card.locator('input[type=file]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  const sheet = page.locator('.sheet', { hasText: 'מה קראנו מהקבלה' });
  await sheet.waitFor();
  assert.equal(sent[0].mimeType, 'image/jpeg', 'made smaller on the device, as a JPEG');
  assert.equal(sent[0].hid, db.hid);
  assert.match(await sheet.textContent(), /סופר לדוגמה.*6\.11\.26.*חלב 3% בשקית 1 ליטר.*×2.*₪11\.80/s);
  // The chocolate was a gift: not part of what this home buys.
  await sheet.locator('label', { hasText: 'שוקולד' }).locator('input').uncheck();
  assert.match(await sheet.locator('.rcpt-sum').textContent(), /2 שורות.*₪19\.20/);
  await sheet.locator('button:has-text("לשמור 2 מוצרים")').click();
  await page.waitForSelector('.toast:has-text("נשמרו 2 מוצרים")');
  const learned = db.tables.shopping_items.filter((i) => i.cleared_at);
  assert.deepEqual(learned.map((i) => [i.name, i.qty, i.done]), [['חלב 3% בשקית', '×2', true], ['לחם אחיד פרוס', null, true]]);
  assert.ok(learned.every((i) => i.cleared_at.startsWith('2026-11-06')), 'bought on the receipt\'s date');
  assert.equal(db.tables.shop_receipts.length, 1);
  assert.equal(db.tables.shop_receipts[0].items.length, 2);
  // "What you usually buy" knows the bread now (the milk is on the list already).
  await page.waitForSelector('.chips .chip:has-text("לחם אחיד פרוס")');
  assert.match(await card.textContent(), /קבלה אחת.*סופר לדוגמה/);
  // And the price comparison: what they paid for milk, per unit.
  await page.click('.shop-prices-cta button');
  const milk = page.locator('.price-item', { hasText: 'חלב 3%' }).first();
  await milk.waitFor();
  assert.match(await milk.locator('.pp-tag.t-paid').textContent(), /שילמתם ₪5\.90 בסופר לדוגמה/);
  await page.close();
  assert.deepEqual(errors, []);
});

test('a photo that is not a receipt says so, and nothing is saved', async () => {
  const { page, db, errors } = await open(390, (d) => { d.tables.shop_receipts = []; }, OWNER);
  await page.route('**/api/receipts/scan', (r) => r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'זו לא נראית כמו קבלה. נסו לצלם את הקבלה עצמה, ישר ובאור טוב.' }) }));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.rcpt-card input[type=file]').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.rcpt-card [role=alert]:has-text("לא נראית כמו קבלה")');
  assert.equal(db.tables.shop_receipts.length, 0);
  assert.equal(await page.locator('.sheet').count(), 0);
  await page.close();
  // The failed request itself is logged by the browser; nothing else.
  assert.deepEqual(errors.filter((e) => !/422/.test(e)), []);
});

test('receipts are for the owner for now: others do not see the card', async () => {
  const { page, errors } = await openRegular(390);
  await page.waitForSelector('.price-teaser');
  assert.equal(await page.locator('.rcpt-card').count(), 0);
  await page.close();
  assert.deepEqual(errors, []);
});

test('a chain that sells once a week: marked in the comparison, and the cheapest always-open chain is named', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  // Made-up prices.
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ q: 1, barcode: '1001', name: 'חלב 3% בשקית', names: '', qty: 1, unit: 'ליטר', kosher: {},
    offers: [{ chain: 'mishnat-yosef', chain_name: 'משנת יוסף', price: 5.1 }, { chain: 'x', chain_name: 'רשת א', price: 6.2 }, { chain: 'y', chain_name: 'רשת ב', price: 5.9 }] }]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  const hero = page.locator('.pp-hero');
  await hero.waitFor();
  assert.match(await hero.textContent(), /₪5\.10במשנת יוסף.*פעם בשבוע.*בחנות שפתוחה כל יום: הכי משתלם ברשת ב, ₪5\.90/);
  assert.match(await page.locator('.pp-bar', { hasText: 'משנת יוסף' }).textContent(), /מכירה פעם בשבוע/);
  assert.equal(await hero.locator('.pp-weekly a').getAttribute('href'), 'https://mishnatyosef.org/');
  assert.equal(await hero.locator('.pp-weekly a').getAttribute('target'), '_blank');
  await hero.locator('.pp-always').click();
  assert.match(await hero.textContent(), /₪5\.90ברשת ב/);
  assert.equal(await hero.locator('.pp-weekly').count(), 0);
  await page.close();
  assert.deepEqual(errors, []);
});

test('deals: one anyone gets is in the total, a club deal is only shown, and the policy is written', async () => {
  let db;
  const { page, errors } = await open(390, (d) => {
    db = d;
    d.tables.shopping_items = [
      { id: 's1', household_id: d.hid, name: 'קרקרים', qty: '×2', aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null },
      { id: 's2', household_id: d.hid, name: 'במבה', qty: null, aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }
    ];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  // Made-up prices and deals.
  const end = '2026-12-05T21:59:00Z';
  const deal = { everyone: true, coupon: false, min_buy: 0, ends_at: end };
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { q: 1, barcode: '5001', name: 'קרקרים 300 גרם', names: '', qty: 300, unit: 'גרם', kosher: {}, offers: [
      { chain: 'x', chain_name: 'רשת א', price: 9.9, promos: [{ ...deal, need: 2, unit_price: 7.5 }] }, { chain: 'y', chain_name: 'רשת ב', price: 8.9 }] },
    { q: 2, barcode: '5002', name: 'במבה 80 גרם', names: '', qty: 80, unit: 'גרם', kosher: {}, offers: [
      { chain: 'x', chain_name: 'רשת א', price: 4.5, promos: [{ ...deal, everyone: false, club: 'club', need: 1, unit_price: 2.5 }] }, { chain: 'y', chain_name: 'רשת ב', price: 4.9 }] }
  ]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  const hero = page.locator('.pp-hero');
  await hero.waitFor();
  // Chain A: two crackers for ₪15 (anyone gets it) and Bamba at ₪4.50 (the club price is not counted): ₪19.50.
  assert.match(await hero.textContent(), /₪19\.50ברשת א.*כולל ₪4\.80 הנחה במבצעים/);
  const crackers = page.locator('.price-item', { hasText: 'קרקרים' }).first();
  assert.match(await crackers.textContent(), /מבצע: 2 ב-₪15 · עד 5\.12/);
  assert.match(await crackers.textContent(), /₪15\.00₪19\.80/, 'the line in the deal, the regular price struck out');
  assert.match(await page.locator('.price-item', { hasText: 'במבה' }).first().textContent(), /מבצע ₪2\.50 למועדון בלבד \(לא בסכום\)/);
  assert.match(await page.locator('.price-note').textContent(), /מבצע נכלל בסכום כשכל אחד מקבל אותו, או כשהוא של מועדון/);
  // "I'm in the club": saved for the household, and the club deal counts.
  assert.match(await page.locator('.price-pref', { hasText: 'מועדונים' }).textContent(), /לא סימנתם/);
  await page.locator('.pp-club-ask button', { hasText: 'אני במועדון של רשת א' }).click();
  await page.waitForSelector('.pp-hero:has-text("₪17.50")');
  assert.deepEqual(db.tables.price_prefs[0].clubs, ['x:club']);
  assert.match(await page.locator('.price-pref', { hasText: 'מועדונים' }).textContent(), /רשת א/);
  assert.equal(await page.locator('.pp-club-ask').count(), 0);
  // And from the list of chains: off again.
  await page.locator('.pp-set summary').click();
  await page.locator('.price-pref', { hasText: 'מועדונים' }).locator('button', { hasText: 'לשנות' }).click();
  await page.locator('.pp-club-list li', { hasText: 'רשת א' }).locator('.chip', { hasText: 'מועדון' }).click();
  await page.locator('.pp-clubs .btn-primary').click();
  await page.waitForSelector('.pp-hero:has-text("₪19.50")');
  assert.deepEqual(db.tables.price_prefs[0].clubs, []);
  await page.close();
  assert.deepEqual(errors, []);
});

test('a Haredi kashrut: a chain open on Shabbat is not in the comparison until the family brings it back', async () => {
  let db;
  const { page, errors } = await open(390, (d) => {
    db = d;
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'mehadrin', certs: ['הרב לנדא'] }];
  }, OWNER);
  // Made-up prices: the chain open on Shabbat is the cheapest.
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ q: 1, barcode: '1001', name: 'חלב 3% בשקית', names: '', qty: 1, unit: 'ליטר', kosher: { owner_cert: 'הרב לנדא' },
    offers: [{ chain: 'tiv-taam', chain_name: 'טיב טעם', price: 5.1 }, { chain: 'x', chain_name: 'רשת א', price: 6.2 }] }]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  const hero = page.locator('.pp-hero');
  await hero.waitFor();
  assert.match(await hero.textContent(), /₪6\.20ברשת א/);
  assert.equal(await page.locator('.pp-bar', { hasText: 'טיב טעם' }).count(), 0);
  assert.match(await page.locator('.pp-set summary').textContent(), /הגדרות ההשוואה.*הרב לנדא/, 'the settings folded into one line');
  await page.locator('.pp-set summary').click();
  await page.locator('.pp-shabbat-row .chip', { hasText: 'טיב טעם' }).click();
  await page.waitForSelector('.pp-hero:has-text("₪5.10")');
  assert.deepEqual(db.tables.price_prefs[0].chains_shown, ['tiv-taam']);
  await page.close();
  assert.deepEqual(errors, []);
});

test('two chains: when splitting the list between two saves enough, the hero says how and what goes where', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [
      { id: 's1', household_id: d.hid, name: 'קפה', qty: null, aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null },
      { id: 's2', household_id: d.hid, name: 'שמן זית', qty: null, aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }
    ];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  // Made-up prices: coffee is cheap at A, olive oil at B.
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { q: 1, barcode: '6001', name: 'קפה 200 גרם', names: '', qty: 200, unit: 'גרם', kosher: {}, offers: [{ chain: 'x', chain_name: 'רשת א', price: 20 }, { chain: 'y', chain_name: 'רשת ב', price: 40 }] },
    { q: 2, barcode: '6002', name: 'שמן זית 750 מ"ל', names: '', qty: 750, unit: 'מ"ל', kosher: {}, offers: [{ chain: 'x', chain_name: 'רשת א', price: 50 }, { chain: 'y', chain_name: 'רשת ב', price: 25 }] }
  ]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  const two = page.locator('.pp-two');
  await two.waitFor();
  assert.match(await two.locator('summary').textContent(), /בשתי רשתות: ₪45\.00, עוד ₪20\.00 פחות/);
  await two.locator('summary').click();
  assert.match(await two.textContent(), /ברשת א: קפה.*ברשת ב: כל השאר/, 'the cheapest single chain is B; only the coffee moves to A');
  // The chosen chain's list, ready to send to whoever goes shopping.
  const wa = decodeURIComponent(await page.locator('.pp-send a').getAttribute('href'));
  assert.match(wa, /רשימה לקנייה ברשת ב.*☐ קפה: קפה 200 גרם · ₪40\.00.*☐ שמן זית: שמן זית 750 מ"ל · ₪25\.00/s);
  await page.close();
  assert.deepEqual(errors, []);
});

test('an area with no branch of any chain near it: no far chain is compared, and the distance can be widened', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
    d.tables.household_area = [{ household_id: d.hid, city_code: '2610', city: 'בית שמש', hood: null, max_km: 10 }];
    d.tables.household_stores = [];
  }, OWNER);
  await priceRoutes(page);
  await page.click('.shop-prices-cta button');
  const empty = page.locator('.pp-empty');
  await empty.waitFor();
  assert.match(await empty.textContent(), /אין סניף של אף רשת עד 10 ק"מ מבית שמש/);
  assert.equal(await page.locator('.pp-bar').count(), 0, 'no far chain');
  await empty.locator('button', { hasText: 'להגדיל את המרחק' }).click();
  await page.locator('.price-area-pick').waitFor();
  await page.close();
  assert.deepEqual(errors, []);
});

// The comparison only the owner sees: deals, a club deal, two chains, the
// settings open, in light and dark: WCAG 2 AA (as the a11y test does for
// the other screens).
for (const scheme of ['light', 'dark']) {
  test('the full price comparison passes WCAG 2 AA (' + scheme + ')', async () => {
    const { page, errors } = await open(390, (d) => {
      d.tables.shopping_items = [
        { id: 's1', household_id: d.hid, name: 'קרקרים', qty: '×2', aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null },
        { id: 's2', household_id: d.hid, name: 'במבה', qty: null, aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null },
        { id: 's3', household_id: d.hid, name: 'שמן זית', qty: null, aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }
      ];
      d.tables.price_prefs = [{ household_id: d.hid, kosher: 'mehadrin', certs: ['הרב לנדא'] }];
    }, OWNER);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const deal = { everyone: true, coupon: false, min_buy: 0, ends_at: '2026-12-05T21:59:00Z' };
    await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { q: 1, barcode: '5001', name: 'קרקרים 300 גרם', names: '', qty: 300, unit: 'גרם', kosher: { owner_cert: 'הרב לנדא' }, offers: [{ chain: 'x', chain_name: 'רשת א', price: 9.9, promos: [{ ...deal, need: 2, unit_price: 7.5 }] }, { chain: 'y', chain_name: 'רשת ב', price: 8.9 }] },
      { q: 2, barcode: '5002', name: 'במבה 80 גרם', names: '', qty: 80, unit: 'גרם', kosher: {}, offers: [{ chain: 'x', chain_name: 'רשת א', price: 4.5, promos: [{ ...deal, everyone: false, club: 'club', need: 1, unit_price: 2.5 }] }, { chain: 'y', chain_name: 'רשת ב', price: 4.9 }] },
      { q: 3, barcode: '5003', name: 'שמן זית 750 מ"ל', names: '', qty: 750, unit: 'מ"ל', kosher: {}, offers: [{ chain: 'x', chain_name: 'רשת א', price: 50 }, { chain: 'y', chain_name: 'רשת ב', price: 25 }] }
    ]) }));
    await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
    await page.click('.shop-prices-cta button');
    await page.locator('.pp-hero').waitFor();
    await page.locator('.pp-set summary').click();
    await page.locator('.price-item', { hasText: 'קרקרים' }).first().locator('.pp-row-h').click();
    // (Run through the test tool: the site's security policy rightly refuses
    // an injected script tag.)
    await page.evaluate(AXE);
    await page.waitForTimeout(700);
    const v = await page.evaluate(async () => (await window.axe.run(document.querySelector('.price-panel'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] })).violations.map((x) => x.id + ': ' + x.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' ' + (n.failureSummary || '').split('\n').slice(1, 2).join('')).join(' | ')));
    assert.deepEqual(v, []);
    await page.close();
    assert.deepEqual(errors, []);
  });
}

test('a long list (90 items, a family before a holiday): searched in parts of up to 15, and every item gets its prices', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = Array.from({ length: 90 }, (_, i) => ({ id: 's' + i, household_id: d.hid, name: i === 0 ? 'חלב 3%' : 'מוצר ' + i, qty: null, aisle: 'other', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }));
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  const { calls, cat } = await priceRoutes(page);
  // Made-up products, one for each item.
  for (let i = 1; i < 90; i++) cat['מוצר ' + i] = [{ barcode: String(9000 + i), name: 'מוצר ' + i + ' 1 ק"ג', names: '', qty: 1, unit: 'ק"ג', offers: [{ chain: 'x', chain_name: 'רשת א', price: 10 }, { chain: 'y', chain_name: 'רשת ב', price: 11 }], kosher: {} }];
  await page.click('.shop-prices-cta button');
  await page.locator('.pp-hero').waitFor();
  await page.waitForTimeout(1500);
  assert.equal(calls.search.length, 6, 'six parts, and the list searched once (not again when the area arrives)');
  assert.ok(calls.search.every((q) => q.length <= 15));
  assert.equal(calls.search.flat().length, 90, 'each item once');
  assert.match(await page.locator('.price-count').textContent(), /יש מחיר: 90 מתוך 90/);
  await page.close();
  assert.deepEqual(errors, []);
});

test('online and in the shop are two prices: the chain online is compared on its own, with its delivery counted', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: '×20', aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  // Made-up prices: online is cheaper a carton, but there is the delivery.
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ q: 1, barcode: '1001', name: 'חלב 3% בשקית', names: '', qty: 1, unit: 'ליטר', kosher: {},
    offers: [{ chain: 'x-online', chain_name: 'רשת א אונליין', price: 3.4 }, { chain: 'x', chain_name: 'רשת א', price: 6.2 }, { chain: 'y', chain_name: 'רשת ב', price: 5.9 }] }]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  const hero = page.locator('.pp-hero');
  await hero.waitFor();
  // 20 × ₪3.40 + ₪35.90 delivery = ₪103.90, against 20 × ₪5.90 = ₪118 in the shop.
  assert.match(await hero.textContent(), /₪103\.90ברשת א אונליין.*משלוח בערך ₪35\.90.*לא אימתנו את מחיר המשלוח.*בחנות: הכי משתלם ברשת ב, ₪118\.00/, 'a made-up chain: its delivery price is said as about');
  assert.match(await page.locator('.pp-bar', { hasText: 'רשת א אונליין' }).textContent(), /אונליין · כולל משלוח.*כולל משלוח בערך ₪35\.90/);
  assert.equal(await page.locator('.pp-bar').count(), 3, 'the shop and the online shop: two bars, and the other chain');
  await page.close();
  assert.deepEqual(errors, []);
});

test('comparison first: a card at the top of the tab opens the list compared; each online shop with its own delivery, smallest order, order link and product search', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: '×10', aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  // Made-up prices at two real online shops (their terms are the chains' own).
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ q: 1, barcode: '1001', name: 'חלב 3% בשקית', names: '', qty: 1, unit: 'ליטר', kosher: {},
    offers: [{ chain: 'super-sapir-online', chain_name: 'סופר ספיר אונליין', price: 3 }, { chain: 'rami-levy-online', chain_name: 'רמי לוי אונליין', price: 4 }, { chain: 'x', chain_name: 'רשת א', price: 9 }] }]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const logos = [];
  await page.route('**/api/chain-logo/**', (r) => { logos.push(r.request().url().split('/').pop()); return r.fulfill({ status: 200, contentType: 'image/png', body: png }); });
  // Back to "הרשימות שלי": the comparison is the first thing there.
  await page.click('.shop-listhead .back-btn');
  const card = page.locator('.sl-compare');
  await card.waitFor();
  assert.match(await card.textContent(), /כמה "הרשימה שלי" תעלה\?.*מוצר אחד/);
  await card.click();
  const hero = page.locator('.pp-hero');
  await hero.waitFor();
  // 10 × ₪3 + about ₪35.90 at Super Sapir (by area), under its ₪200 minimum.
  assert.match(await hero.textContent(), /₪65\.90בסופר ספיר אונליין/);
  assert.match(await page.locator('.pp-ship').textContent(), /משלוח בערך ₪35\.90 · מינימום להזמנה ₪200\.00הרשימה מתחת למינימום/);
  assert.equal(await page.locator('.pp-order').getAttribute('href'), 'https://www.supersapir.co.il/');
  assert.match(await page.locator('.pp-bar', { hasText: 'סופר ספיר' }).textContent(), /מתחת למינימום ₪200\.00/);
  // Rami Levy online: its own fee, said for sure.
  await page.locator('.pp-bar', { hasText: 'רמי לוי' }).click();
  assert.match(await page.locator('.pp-ship').textContent(), /^משלוח ₪35\.90$/);
  assert.equal(await page.locator('.pp-order').getAttribute('href'), 'https://www.rami-levy.co.il/he');
  // A product, searched on that chain's site.
  await page.click('.pp-row-h');
  assert.equal(await page.locator('.pp-find').getAttribute('href'), 'https://www.rami-levy.co.il/he/online/search?q=' + encodeURIComponent('חלב 3% בשקית'));
  // Logos from our own address, for the chains we have; a made-up chain keeps its letter.
  await page.waitForFunction(() => document.querySelectorAll('.pp-logo img').length === 2);
  assert.deepEqual([...new Set(logos)].sort(), ['rami-levy', 'super-sapir']);
  assert.equal((await page.locator('.pp-bar', { hasText: 'רשת א' }).locator('.pp-logo-l').textContent()).trim(), 'ר');
  // Back to the lists: the comparison closes.
  await page.click('.shop-listhead .back-btn');
  await page.locator('.sl-compare').waitFor();
  await page.locator('.sl-chat').first().click();
  await page.waitForSelector('.shop-add');
  assert.equal(await page.locator('.price-panel').count(), 0);
  await page.close();
  assert.deepEqual(errors, []);
});

test('no shop near the family but chains online: only those, and it says why', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב 3%', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
    d.tables.household_area = [{ household_id: d.hid, city_code: '2610', city: 'בית שמש', hood: null, max_km: 10 }];
    d.tables.household_stores = [];
  }, OWNER);
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ q: 1, barcode: '1001', name: 'חלב 3% בשקית', names: '', qty: 1, unit: 'ליטר', kosher: {},
    offers: [{ chain: 'x-online', chain_name: 'רשת א אונליין', price: 5.4 }, { chain: 'x', chain_name: 'רשת א', price: 6.2 }] }]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  const hero = page.locator('.pp-hero');
  await hero.waitFor();
  assert.match(await hero.textContent(), /אין חנות של אף רשת עד 10 ק"מ מבית שמש, ולכן מוצגות רק רשתות אונליין/);
  assert.equal(await page.locator('.pp-bar').count(), 1, 'the far shop is not compared');
  await page.close();
  assert.deepEqual(errors, []);
});

test('a chain with a shop and an online shop is one chain in the clubs list, and its club counts in both', async () => {
  let db;
  const { page, errors } = await open(390, (d) => {
    db = d;
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'במבה', qty: null, aisle: 'dry', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
    d.tables.price_prefs = [{ household_id: d.hid, kosher: 'any' }];
  }, OWNER);
  const club = { everyone: false, club: 'club', coupon: false, min_buy: 0, need: 1, unit_price: 2 };
  await page.route('**/rest/v1/rpc/price_search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ q: 1, barcode: '5002', name: 'במבה 80 גרם', names: '', qty: 80, unit: 'גרם', kosher: {},
    offers: [{ chain: 'x', chain_name: 'רשת א', price: 4.5, promos: [club] }, { chain: 'x-online', chain_name: 'רשת א אונליין', price: 4.2, promos: [club] }, { chain: 'y', chain_name: 'רשת ב', price: 4.9 }] }]) }));
  await page.route('**/api/prices/images', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":{}}' }));
  await page.click('.shop-prices-cta button');
  await page.locator('.pp-hero').waitFor();
  await page.locator('.pp-set summary').click();
  await page.locator('.pp-clubs-row button').click();
  const names = await page.locator('.pp-club-list li > span').allTextContents();
  assert.deepEqual(names.filter((n) => n.startsWith('רשת א')), ['רשת א'], 'one chain, not its shop and online shop apart');
  await page.locator('.pp-club-list li', { hasText: 'רשת א' }).locator('.chip', { hasText: 'מועדון' }).click();
  await page.locator('.pp-clubs .btn-primary').click();
  await page.waitForSelector('.pp-hero:has-text("₪2.00")');
  assert.deepEqual(db.tables.price_prefs[0].clubs, ['x:club']);
  assert.match(await page.locator('.pp-bar', { hasText: 'רשת א אונליין' }).textContent(), /₪37\.90/, 'the club deal online too: ₪2 and the delivery');
  await page.close();
  assert.deepEqual(errors, []);
});

test('the owner can try the shopping tab as a regular family sees it, and come back', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 's1', household_id: d.hid, name: 'חלב', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
  }, OWNER);
  // As the owner: the price comparison is there.
  await page.locator('.shop-prices-cta').waitFor();
  assert.equal(await page.locator('.price-teaser').count(), 0);
  await page.click('button[aria-label^="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.click('.admin-hub-btn:has-text("מחירי סופר")');
  const card = page.locator('.admin-asuser');
  await card.locator('input[type=checkbox]').check();
  assert.match(await card.textContent(), /פעיל/);
  await card.locator('a:has-text("לפתוח את טאב הקניות")').click();
  // As a family sees it: no comparison, no advisor, the "soon" teaser, and a note to come back.
  await page.locator('.shop-asuser').waitFor();
  assert.equal(await page.locator('.shop-prices-cta').count(), 0);
  assert.equal(await page.locator('.adv-cta').count(), 0);
  assert.equal(await page.locator('.price-teaser').count(), 1);
  await page.click('.shop-asuser button:has-text("לחזור לתצוגת הבעלים")');
  await page.locator('.shop-prices-cta').waitFor();
  assert.equal(await page.locator('.shop-asuser').count(), 0);
  // (The owner board's own numbers are not served here: the test server has no database.)
  assert.deepEqual(errors.filter((e) => !/status of 503/.test(e)), []);
  await page.close();
});

test('a regular family has no shopping tab for now: not in the menu, and its address opens the home screen', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  const errors = collectErrors(page);
  await mockSupabase(page, makeFakeDb(TODAY));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/shop');
  await page.reload();
  await page.locator('.bottom-nav').waitFor();
  assert.equal(await page.locator('.bottom-nav .nav-item[href="#/shop"]').count(), 0);
  assert.equal(await page.locator('.shop-add').count(), 0);
  assert.equal((await page.locator('.topbar h1').textContent()).trim(), 'בית');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the owner\'s partner (in his household) gets the whole shopping tab in her own account', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  const errors = collectErrors(page);
  const db = makeFakeDb(TODAY);
  db.tables.shopping_items = [{ id: 's1', household_id: db.hid, name: 'חלב', qty: null, aisle: 'dairy', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }];
  db.tables.households = [{ id: db.hid, shop_area: null }];
  db.tables.household_area = [{ household_id: db.hid, city_code: '2610', city: 'בית שמש', hood: null }];
  db.tables.household_stores = [];
  await mockSupabase(page, db);
  // The server says she shares a household with the owner.
  await page.route('**/api/shop/access', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"shop":true}' }));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/shop');
  await page.reload();
  // The same lists as the owner ("הרשימות שלי"), and into one.
  await page.locator('.sl-chat').first().click();
  await page.locator('.shop-add').waitFor();
  assert.equal(await page.locator('.bottom-nav .nav-item[href="#/shop"]').count(), 1);
  // The full version: the comparison and the advisor, not the "soon" preview.
  await page.locator('.shop-prices-cta').waitFor();
  assert.equal(await page.locator('.adv-cta').count(), 1);
  assert.equal(await page.locator('.price-teaser').count(), 0);
  // And nothing of the owner's board.
  await page.click('button[aria-label^="פרופיל והגדרות"]');
  assert.equal(await page.locator('text=לוח בעלים').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('"הרשימות שלי": the lists like chats; a new list opens, items go into it, and back shows both with what is in them', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.shopping_items = [{ id: 'k1', household_id: d.hid, name: 'חלב', aisle: 'dairy', done: false, created_at: '2026-11-07T10:00:00Z' }];
  });
  // Opened into the first list (made for what was already on it).
  assert.equal(db.tables.shopping_lists.length, 1);
  assert.equal(await page.locator('.shop-listhead h2').textContent(), 'הרשימה שלי');
  await page.click('.shop-listhead .back-btn');
  await page.waitForSelector('.sl-chat');
  assert.match(await page.locator('.sl-chat').first().textContent(), /הרשימה שלי.*חלב.*0 מתוך 1/);
  await page.click('.sl-new');
  await page.fill('#sl-name', 'לשבת');
  await page.click('.sl-new-form .btn');
  await page.waitForSelector('.shop-listhead');
  assert.equal(await page.locator('.shop-listhead h2').textContent(), 'לשבת');
  assert.equal(await page.locator('.shop-item').count(), 0, 'a new list is empty');
  await page.locator('.shop-add .input').fill('חלות, יין');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 2);
  const shabbat = db.tables.shopping_lists.find((l) => l.name === 'לשבת');
  assert.deepEqual(db.tables.shopping_items.filter((i) => i.list_id === shabbat.id).map((i) => i.name).sort(), ['חלות', 'יין']);
  await page.click('.shop-listhead .back-btn');
  await page.waitForFunction(() => document.querySelectorAll('.sl-chat').length === 2);
  const rows = await page.locator('.sl-chat').allTextContents();
  assert.ok(rows.some((r) => /לשבת.*חלות, יין/.test(r)) && rows.some((r) => /הרשימה שלי.*חלב/.test(r)), rows.join(' | '));
  // A list with things on it is not closed.
  await page.locator('.sl-chat', { hasText: 'הרשימה שלי' }).click();
  await page.click('.shop-archive');
  await page.waitForSelector('.toast');
  assert.ok(!db.tables.shopping_lists.find((l) => l.name === 'הרשימה שלי').archived_at);
  assert.deepEqual(errors, []);
  await page.close();
});
