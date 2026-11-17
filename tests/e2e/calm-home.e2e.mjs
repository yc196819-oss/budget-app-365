import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const OWNER = 'budgetapp2852@gmail.com';
const TODAY = new Date(2026, 10, 15, 11);

async function open({ email = OWNER, setup = () => {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.setFixedTime(TODAY);
  const db = makeFakeDb(TODAY);
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  if (email) await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, email);
  await page.goto(server.base + '/app/#/home');
  await page.reload();
  await page.waitForSelector('.hero');
  return { page, db, errors: () => errors.filter((x) => !/status of 503/.test(x)) };
}

test('the calm home (owner): the number first, one next step, the rest on request, and back to the old home', async () => {
  const { page, errors } = await open({ setup: (db) => db.tables.transactions.push({ id: 'x1', household_id: db.hid, type: 'expense', amount: 120, description: 'חנות בדויה', tx_date: '2026-11-12', category_id: null }) });
  await page.waitForSelector('.home.calm');
  const order = await page.evaluate(() => [...document.querySelectorAll('.home.calm .home-main > *')].map((e) => e.className.split(' ')[0] || e.tagName));
  assert.ok(order.indexOf('hero') < order.indexOf('card'), 'the number before the cards: ' + order.join(','));
  const next = page.locator('.next-step');
  assert.match(await next.textContent(), /הצעד הבא/);
  assert.match(await next.textContent(), /תנועה אחת מחכה לקטגוריה/);
  // Not asked twice: the same line is not under "needs attention" too.
  assert.equal(await page.locator('.att', { hasText: 'בלי קטגוריה' }).count(), 0);
  assert.equal(await page.locator('.setup-guide').count(), 1, 'only the next step, not the whole list');
  await next.locator('text=עוד דברים לסדר').click();
  const sheet = page.locator('.sheet[aria-label="דברים לסדר"]');
  await sheet.waitFor();
  assert.ok(await sheet.locator('.setup-guide').count(), 'the full list is there');
  await sheet.locator('button[aria-label="סגירה"]').click();
  // The old home stays one tap away (for comparing).
  await page.click('text=למסך הבית הקודם');
  await page.waitForSelector('.home-main');
  assert.equal(await page.locator('.home.calm').count(), 0);
  await page.click('text=לנסות את מסך הבית החדש');
  await page.waitForSelector('.home.calm');
  assert.deepEqual(errors(), []);
  await page.close();
});

test('the calm home on the first day: choosing banks and cards and uploading is the first thing', async () => {
  const { page, errors } = await open({ setup: (db) => { db.tables.transactions = []; db.tables.bank_accounts = [{ id: 'a0', household_id: db.hid, name: 'חשבון ראשי', balance: 0 }]; db.tables.credit_cards = []; } });
  const first = page.locator('.first-day');
  await first.waitFor();
  assert.match(await first.textContent(), /בואו נכניס את המספרים האמיתיים/);
  await first.locator('text=לבחור בנק וכרטיסים ולהעלות').click();
  await page.waitForSelector('.pic-picker');
  await page.click('.sheet button[aria-label="סגירה"]');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  await first.locator('text=יש לי כבר קובץ: להעלות עכשיו').click();
  await page.waitForSelector('.sheet input[type="file"]', { state: 'attached' });
  assert.deepEqual(errors(), []);
  await page.close();
});

test('everyone gets the calm home, with the balance update and install on screen, and a way back', async () => {
  const { page, errors } = await open({ email: null });
  await page.waitForSelector('.home.calm .home-main');
  assert.equal(await page.locator('.home.calm .cash').count(), 1, 'the balance card is on the screen');
  await page.locator('text=למסך הבית הקודם').click();
  await page.waitForSelector('.home:not(.calm)');
  await page.locator('text=לנסות את מסך הבית החדש').click();
  await page.waitForSelector('.home.calm');
  assert.deepEqual(errors(), []);
  await page.close();
});

test('a recurring payment that got dearer: the old price, the new one and the year, and "ידוע לי" hides it for the household', async () => {
  const { page, db, errors } = await open({ setup: (d) => {
    d.tables.dupe_ok = [];
    // Everything else in order, so this is what needs attention.
    d.tables.transactions = d.tables.transactions.filter((t) => t.tx_date < '2026-08-01' || t.type === 'income' || t.category_id);
    for (const [m, a] of [['08', 180], ['09', 180], ['10', 180], ['11', 202]]) d.tables.transactions.push({ id: 'ins' + m, household_id: d.hid, type: 'expense', amount: a, description: 'ביטוח בדוי', tx_date: '2026-' + m + '-04', category_id: 'home', nature: 'fixed' });
  } });
  const card = page.locator('.att-rise');
  await card.waitFor();
  const text = await card.textContent();
  assert.match(text, /ביטוח בדוי התייקר/);
  assert.match(text, /\+12%/);
  assert.match(text, /₪180.*₪202/);
  assert.match(text, /₪264 יותר בשנה/);
  await card.locator('text=ידוע לי').click();
  await page.waitForFunction(() => !document.querySelector('.att-rise'));
  for (let i = 0; i < 30 && !db.tables.dupe_ok.length; i++) await page.waitForTimeout(100);
  assert.deepEqual(db.tables.dupe_ok.map((r) => r.pair), ['rise:ins11']);
  assert.deepEqual(errors(), []);
  await page.close();
});
