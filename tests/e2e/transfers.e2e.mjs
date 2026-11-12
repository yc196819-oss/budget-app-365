import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

// Made-up household with two bank accounts: 2,000 left one and came into the
// other the next day. Only the household's "yes" marks them.
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = new Date();
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const day = (n) => iso(new Date(today.getFullYear(), today.getMonth(), Math.max(1, today.getDate() - n)));

async function open(width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = makeFakeDb();
  db.tables.bank_accounts.push({ id: 'a2', household_id: db.hid, name: 'חיסכון בבנק השני', balance: 5000 });
  db.tables.transactions.push(
    { id: 'tout', household_id: db.hid, type: 'expense', amount: 2000, description: 'העברה לחשבון אחר', tx_date: day(2), account_id: 'a1', source: 'import', nature: 'variable', spread: 'month' },
    { id: 'tin', household_id: db.hid, type: 'income', amount: 2000, description: 'הפקדה מחשבון', tx_date: day(1), account_id: 'a2', source: 'import', nature: 'variable', spread: 'month' }
  );
  db.tables.dupe_ok = [];
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.att');
  return { page, db, errors };
}
const waitFor = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await new Promise((r) => setTimeout(r, 100)); };

test('a transfer between own accounts: asked on home, marked only on "yes", not counted, and undone', async () => {
  const { page, db, errors } = await open();
  const att = page.locator('.att', { hasText: 'העברה בין החשבונות שלכם' });
  assert.equal(await att.count(), 1);
  assert.match(await att.textContent(), /2,000/);
  await att.locator('button:has-text("לבדוק")').click();
  await page.waitForSelector('.tr-pair');
  const pair = await page.locator('.tr-pair').textContent();
  assert.match(pair, /עו״ש/);
  assert.match(pair, /חיסכון בבנק השני/);
  assert.match(pair, /יום אחד אחר כך/);
  // Nothing was marked by itself.
  assert.deepEqual(db.tables.transactions.filter((t) => t.id === 'tout' || t.id === 'tin').map((t) => t.type), ['expense', 'income']);
  await page.click('.tr-pair button:has-text("כן, זו העברה שלי")');
  await waitFor(() => db.tables.transactions.find((t) => t.id === 'tin').type === 'transfer_in' && db.tables.transactions.find((t) => t.id === 'tout').type === 'transfer_out');
  assert.equal(db.tables.transactions.find((t) => t.id === 'tout').type, 'transfer_out');
  assert.equal(db.tables.transactions.find((t) => t.id === 'tin').type, 'transfer_in');
  await page.waitForSelector('.tr-empty');
  // Listed as marked, with an undo.
  await page.click('.tr-marked-btn');
  assert.match(await page.locator('.tr-marked').textContent(), /2,000.*עו״ש ← חיסכון בבנק השני/);
  await page.click('.sheet .icon-btn[aria-label="סגירה"], .sheet button[aria-label="סגירה"]');
  assert.equal(await page.locator('.att', { hasText: 'העברה בין החשבונות שלכם' }).count(), 0);
  // The money list says it is not counted, and opens the same list.
  await page.goto(server.base + '/app/#/money');
  await page.waitForSelector('.tr-money-link');
  assert.match(await page.locator('.tr-money-link').textContent(), /2 תנועות הן העברות/);
  assert.equal(await page.locator('.tx-row:has-text("העברה לחשבון אחר"), [class*="tx"]:has-text("הפקדה מחשבון")').count(), 0, 'not in the list of spending');
  await page.click('.tr-money-link');
  await page.click('.tr-marked-btn');
  await page.click('.tr-marked button:has-text("לבטל")');
  await waitFor(() => db.tables.transactions.find((t) => t.id === 'tin').type === 'income' && db.tables.transactions.find((t) => t.id === 'tout').type === 'expense');
  assert.equal(db.tables.transactions.find((t) => t.id === 'tout').type, 'expense');
  assert.deepEqual(errors, []);
  await page.close();
});

test('"no, these are ordinary" is kept for the household and not asked again', async () => {
  const { page, db, errors } = await open();
  await page.locator('.att', { hasText: 'העברה בין החשבונות שלכם' }).locator('button:has-text("לבדוק")').click();
  await page.click('.tr-pair button:has-text("לא, אלה תנועות רגילות")');
  await waitFor(() => (db.tables.dupe_ok || []).length > 0);
  assert.deepEqual(db.tables.dupe_ok.map((r) => r.pair), ['t:tin|tout']);
  assert.equal(db.tables.transactions.find((t) => t.id === 'tout').type, 'expense');
  await page.waitForSelector('.tr-empty');
  await page.click('.sheet button[aria-label="סגירה"]');
  assert.equal(await page.locator('.att', { hasText: 'העברה בין החשבונות שלכם' }).count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('one line of a bank account can be marked by hand from its details', async () => {
  const { page, db, errors } = await open();
  await page.goto(server.base + '/app/#/money');
  await page.waitForSelector('text=העברה לחשבון אחר');
  await page.click('text=העברה לחשבון אחר');
  await page.waitForSelector('.tx-own-move');
  await page.click('.tx-own-move');
  await waitFor(() => db.tables.transactions.find((t) => t.id === 'tout').type === 'transfer_out');
  assert.equal(db.tables.transactions.find((t) => t.id === 'tout').type, 'transfer_out');
  assert.equal(db.tables.transactions.find((t) => t.id === 'tin').type, 'income', 'only the line chosen');
  await page.waitForSelector('.toast:has-text("סומן כהעברה")');
  // A card purchase has no such button.
  await page.click('text=שופרסל דיל >> nth=0');
  await page.waitForSelector('.sheet:has-text("פרטי תנועה")');
  assert.equal(await page.locator('.tx-own-move').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});
