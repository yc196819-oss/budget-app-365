import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
import { makeXlsx } from '../fixtures/zip.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = new Date();
const ym = (k) => { const d = new Date(today.getFullYear(), today.getMonth() - k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const dd = (k, day) => { const d = new Date(today.getFullYear(), today.getMonth() - k, day); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };

async function open(width, setup) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = makeFakeDb();
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await page.route('**/api/ai/import', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"transactions":[]}' }));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.pic-card');
  return { page, db, errors };
}

test('first time: choose the bank and card companies by their logos, with the days reminders need', async () => {
  const { page, db, errors } = await open(390, (d) => { d.tables.bank_accounts = []; d.tables.credit_cards = []; d.tables.imports = []; });
  assert.match(await page.locator('.pic-card').textContent(), /איפה הכסף שלכם/);
  await page.click('.pic-card');
  await page.waitForSelector('.pic-picker');
  assert.equal(await page.locator('.pic-grid').first().locator('.pic-pick').count(), 11);
  assert.equal(await page.locator('.pic-grid').nth(1).locator('.pic-pick').count(), 5);
  await page.click('.pic-pick:has(img[alt="לאומי"])');
  await page.click('.pic-pick:has(img[alt="מקס"])');
  await page.waitForFunction(() => document.querySelectorAll('.pic-pick.on').length === 2);
  assert.deepEqual(db.tables.bank_accounts.map((a) => [a.provider, a.name]), [['leumi', 'לאומי']]);
  assert.deepEqual(db.tables.credit_cards.map((c) => [c.provider, c.billing_day]), [['max', 10]]);
  // The same company again: not added twice.
  await page.click('.pic-pick:has(img[alt="מקס"])');
  await page.waitForSelector('.toast:has-text("כבר ברשימה")');
  assert.equal(db.tables.credit_cards.length, 1);
  // The details for reminders: the card's billing day and digits, the salary day.
  const card = page.locator('.pic-details li', { hasText: 'מקס' });
  await card.locator('select').selectOption('2');
  await card.locator('input').fill('4821');
  await card.locator('input').blur();
  await page.locator('.pic-details li', { hasText: 'לאומי' }).locator('select').selectOption('10');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  assert.equal(db.tables.credit_cards[0].billing_day, 2);
  assert.equal(db.tables.credit_cards[0].last4, '4821');
  assert.equal(db.tables.bank_accounts[0].salary_day, 10);
  await page.click('.pic-picker button:has-text("סיימתי")');
  await page.waitForSelector('.pic-history');
  // Nothing uploaded for them yet: a reminder for each, with the site one tap away.
  assert.equal(await page.locator('.pic-task').count(), 2);
  const link = page.locator('.pic-task a.btn', { hasText: 'לאתר של לאומי' });
  assert.equal(await link.getAttribute('href'), 'https://www.leumi.co.il/');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.match(await link.getAttribute('rel'), /noopener/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the ring and 6 months: what is uploaded, what is missing, and an upload from a missing month checks the file', async () => {
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'עו״ש', bank_name: 'לאומי', provider: 'leumi', salary_day: 10, balance: 12000 }];
    d.tables.credit_cards = [{ id: 'c1', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 1, last4: '4821' }];
    d.tables.imports = [{ id: 'b1', household_id: d.hid, source_kind: 'bank', source_id: 'a1', date_from: ym(1) + '-01', date_to: ym(1) + '-28' }];
  });
  // The bank's last month is in; the card's statement of this month is not.
  assert.match(await page.locator('.pic-card').textContent(), /50%.*חסר פירוט אחד/);
  await page.click('.pic-card');
  await page.waitForSelector('.pic-history');
  assert.equal(await page.locator('.pic-hero .pic-ring b').textContent(), '50%');
  assert.equal(await page.locator('.pic-tr').count(), 3, 'a header and two accounts');
  const bank = page.locator('.pic-tr').nth(1);
  assert.equal(await bank.locator('.pic-dot.is-ok').count(), 1);
  assert.equal(await bank.locator('.pic-dot.is-waiting').count(), 1, 'this month is not over');
  // Each logo opens the company's own site in a new tab.
  assert.equal(await bank.locator('a.logo-link').getAttribute('href'), 'https://www.leumi.co.il/');
  // Upload from the card's missing month: the sheet knows which card it is for.
  await page.locator('.pic-tr').nth(2).locator('button.pic-dot').last().click();
  await page.waitForSelector('.sheet:has-text("העלאת פירוט: מקס")');
  const xlsx = makeXlsx([['פירוט עסקאות לכרטיס 4821'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'],
    [dd(1, 3), 'מסעדה בדויה', '80.00', '80.00'], [dd(1, 20), 'חנות בדויה', '120.00', '120.00'], ['', 'סה"כ', '', '200.00']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'max.xlsx', mimeType: '', buffer: xlsx });
  await page.waitForSelector('.import-checks');
  const checks = await page.locator('.import-checks li').allTextContents();
  assert.match(checks[0], /זה פירוט של מקס \(כרטיס 4821\)/);
  assert.match(checks.join(' '), /2 תנועות, סה״כ ₪200/);
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  const imp = db.tables.imports.find((f) => f.source_id === 'c1');
  assert.ok(imp, 'the file is kept as the card\'s');
  assert.equal(imp.source_kind, 'card');
  assert.ok(db.tables.transactions.filter((t) => t.import_id === imp.id).every((t) => t.card_id === 'c1'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('a bank file is kept as the bank account\'s, and a card file chosen for the bank is flagged', async () => {
  const { page, db } = await open(390, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'עו״ש', provider: 'leumi', balance: 1 }];
    d.tables.credit_cards = [];
    d.tables.imports = [];
  });
  await page.click('.pic-card');
  await page.waitForSelector('.pic-task');
  await page.click('.pic-task button:has-text("להעלות")');
  const xlsx = makeXlsx([['פירוט עסקאות לכרטיס 4821'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'], [dd(1, 3), 'מסעדה בדויה', '80.00', '80.00'], ['', 'סה"כ', '', '80.00']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'x.xlsx', mimeType: '', buffer: xlsx });
  await page.waitForSelector('.import-checks');
  assert.match(await page.locator('.import-checks li.bad').first().textContent(), /נראה כמו פירוט של כרטיס/);
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  const imp = db.tables.imports.find((f) => f.source_id === 'a1');
  assert.equal(imp.source_kind, 'bank');
  assert.ok(db.tables.transactions.filter((t) => t.import_id === imp.id).every((t) => t.account_id === 'a1'));
  await page.close();
});

test('a new household with nothing uploaded yet sees the card too', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  db.tables.transactions = [];
  db.tables.bank_accounts = []; db.tables.credit_cards = []; db.tables.imports = [];
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.pic-card');
  assert.match(await page.locator('.pic-card').textContent(), /איפה הכסף שלכם/);
  await page.close();
});
