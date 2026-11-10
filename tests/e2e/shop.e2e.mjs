import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const TODAY = new Date(2026, 10, 8, 10);

async function open(width = 1280, setup = () => {}, email = null) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  const db = makeFakeDb(TODAY);
  db.tables.shopping_items = [];
  db.tables.households = [{ id: db.hid, shop_area: null }];
  // The family's area is set (made-up), so the price tests start at the list.
  db.tables.household_area = [{ household_id: db.hid, city_code: '2610', city: 'בית שמש', hood: null }];
  db.tables.household_stores = [];
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  if (email) await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, email);
  await page.goto(server.base + '/app/#/shop');
  await page.reload();
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
  assert.match(await page.locator('.price-pref:not(.price-area)').textContent(), /בד"ץ העדה החרדית · הרב לנדא/);
  // Milk: the one with their certifier, though the other (another certifier) is cheaper.
  const milk = page.locator('.price-item', { hasText: 'חלב 3%' }).first();
  assert.match(await milk.textContent(), /נבחר אוטומטית.*חלב 3% בשקית.*✓ בד"ץ העדה החרדית · מתאים לכם.*סימנו 3 משפחות.*₪6\.20/);
  // Eggs: the certifier is not known, so the household chooses or marks what the package says.
  const eggs = page.locator('.price-item', { hasText: 'ביצים' }).first();
  assert.match(await eggs.textContent(), /בחרו מוצר.*כשרות לא ידועה/);
  await eggs.locator('.price-vote .chip:has-text("הרב לנדא")').click();
  for (let i = 0; i < 50 && !db.tables.kosher_votes.length; i++) await page.waitForTimeout(100);
  assert.deepEqual(db.tables.kosher_votes.map((v) => [v.barcode, v.cert, v.level]), [['2001', 'הרב לנדא', 'mehadrin']]);
  await page.waitForSelector('.price-item.is-auto:has-text("ביצים L 12")');
  // Coffee was not in our catalog: asked of the service once, then found.
  assert.deepEqual(calls.fetch[0].queries, ['קפה']);
  await page.waitForSelector('.price-item.is-auto:has-text("קפה נמס")', { timeout: 15000 });
  // The whole list at each chain, cheapest first (milk counted twice).
  const best = await page.locator('.price-chain.best').textContent();
  assert.match(best, /הכי זול₪48\.30רשת א/);
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
  assert.equal((await eggs.locator('.price-img.sign').first().textContent()).trim(), '🥛');
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
  await page.waitForSelector('.price-area:has-text("רמת בית שמש א, בית שמש")');
  assert.match(await page.locator('.price-area').textContent(), /סניף אחד עד 10 ק"מ/);
  assert.deepEqual(asked, [{ hid: db.hid, city_code: '2610', hood: 'רמת בית שמש א', max_km: 10 }]);
  // Only the chain with a branch near them, at that branch's price, with its name.
  const chains = page.locator('.price-chain');
  await page.waitForSelector('.price-chain.best:has-text("₪6.00")');
  assert.equal(await chains.count(), 1, 'the far chain is not compared');
  assert.match(await chains.first().textContent(), /רשת א.*סניף נחל דולב/);
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
  await item.locator('button:has-text("להחליף מוצר")').click();
  await item.locator('.price-opts li', { hasText: 'חלב 3% בשקית' }).locator('.price-pick').click();
  await page.waitForSelector('.price-item.is-chosen:has-text("חלב 3% בשקית")');
  assert.equal(db.tables.shopping_items[0].barcode, '1001');
  await page.close();
  assert.deepEqual(errors, []);
});

test('prices for everyone else: a "coming soon" preview with sample products, and "tell me when it opens"', async () => {
  const { page, errors } = await open(390, (d) => {
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

test('the advisor\'s week (the owner first): what the home buys again and the basics for the people at home, edited, then on the list', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.households = [{ id: d.hid, shop_area: null, people: 4 }];
    d.tables.shopping_items = [
      { id: 'o1', household_id: d.hid, name: 'במבה', qty: null, aisle: 'dry', done: true, created_at: '2026-11-01T08:00:00Z', cleared_at: '2026-11-01T10:00:00Z' },
      { id: 's1', household_id: d.hid, name: 'עגבניות', qty: null, aisle: 'produce', done: false, created_at: '2026-11-08T08:00:00Z', cleared_at: null }
    ];
  }, OWNER);
  await page.click('.adv-cta');
  await page.waitForSelector('.adv-rows li');
  const first = await page.locator('.adv-rows li').first().textContent();
  assert.match(first, /במבה.*קונים בדרך כלל/);
  assert.equal(await page.locator('.adv-rows li', { hasText: 'עגבניות' }).count(), 0, 'already on the list');
  assert.equal(await page.locator('.adv-rows li', { hasText: 'לחם' }).locator('.adv-qty').inputValue(), '×2');
  // Six at home: bigger amounts.
  await page.click('.adv-people button[aria-label="עוד אחד"]');
  await page.click('.adv-people button[aria-label="עוד אחד"]');
  assert.equal(await page.locator('.adv-rows li', { hasText: 'לחם' }).locator('.adv-qty').inputValue(), '×3');
  // Not the paper this week; more milk.
  await page.locator('.adv-rows li', { hasText: 'נייר טואלט' }).locator('input[type="checkbox"]').uncheck();
  await page.locator('.adv-rows li', { hasText: 'חלב 3%' }).locator('.adv-qty').fill('×8');
  const n = await page.locator('.adv-rows input[type="checkbox"]:checked').count();
  await page.click(`.adv-list button:has-text("להוסיף לרשימה (${n})")`);
  for (let i = 0; i < 50 && db.tables.shopping_items.length < 2 + n; i++) await page.waitForTimeout(100);
  const added = db.tables.shopping_items.slice(2);
  assert.equal(added.length, n);
  assert.ok(!added.some((x) => x.name === 'נייר טואלט'));
  assert.equal(added.find((x) => x.name === 'חלב 3%').qty, '×8');
  assert.equal(added.find((x) => x.name === 'חזה עוף').aisle, 'meat');
  assert.deepEqual(errors, []);
  await page.close();
});

test('people who are not the owner do not see the advisor\'s week yet', async () => {
  const { page } = await open(390);
  await page.waitForSelector('.shop-add');
  assert.equal(await page.locator('.adv-cta').count(), 0);
  await page.close();
});
