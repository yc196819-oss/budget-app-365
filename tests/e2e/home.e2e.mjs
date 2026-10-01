import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
import { monthPlan, cashNow } from '../../public/app/src/domain/home.js';
import { money } from '../../public/app/src/domain/format.js';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open(width = 390, db = makeFakeDb()) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const calls = [];
  const errors = collectErrors(page);
  await mockSupabase(page, db, calls);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero, .empty');
  return { page, db, calls, errors };
}

test('the hero shows what is left of this month\'s budget, computed from the data', async () => {
  const db = makeFakeDb();
  const { page, errors } = await open(390, db);
  const plan = monthPlan({ txs: db.tables.transactions, budgets: db.tables.category_budgets, today: new Date() });
  const text = await page.locator('.hero').textContent();
  assert.match(text, plan.remaining < 0 ? /חרגתם מהתקציב/ : /נשאר להוציא החודש/);
  assert.ok(text.includes(money(plan.remaining)), text);
  assert.ok(text.includes('מתוך ' + money(plan.budget)));
  assert.match(text, /בקצב הזה/);
  await page.click('.hero');
  await page.waitForSelector('.sheet');
  assert.equal(await page.locator('.sheet h2').textContent(), 'החודש במספרים');
  assert.match(await page.locator('.sheet').textContent(), /צפוי בסוף החודש/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sheet').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('free cash: the balance minus card charges not yet taken, and the balance can be updated', async () => {
  const db = makeFakeDb();
  const { page, calls } = await open(390, db);
  const cash = cashNow(db.tables.bank_accounts, db.tables.credit_cards, db.tables.transactions, new Date());
  const card = page.locator('.cash');
  assert.match(await card.textContent(), /כסף פנוי בחשבון/);
  assert.ok((await card.textContent()).includes(money(cash.free)));
  assert.ok(cash.pending > 0);
  await page.click('text=לעדכן יתרה');
  await page.fill('input[aria-label="יתרה בעו״ש"]', '20,500');
  await page.click('.cash button[type="submit"]');
  await page.waitForSelector('text=כסף פנוי בחשבון');
  assert.equal(db.tables.bank_accounts[0].balance, 20500);
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.table === 'bank_accounts'));
  assert.ok((await page.locator('.cash').textContent()).includes(money(20500 - cash.pending)));
  await page.close();
});

test('"where did the money go" opens the categories view of the money tab', async () => {
  const { page } = await open();
  await page.click('.where');
  await page.waitForSelector('.month-nav');
  assert.equal(await page.locator('.tabs button[aria-pressed="true"]').textContent(), 'קטגוריות');
  await page.close();
});

test('attention: an over-budget category and a suspected double charge, each with one action', async () => {
  const db = makeFakeDb();
  const t = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  db.tables.category_budgets.find((b) => b.category_id === 'car').monthly_amount = 100;
  const day = iso(t);
  db.tables.transactions.push(
    { id: 'd1', household_id: 'h1', type: 'expense', amount: 333, description: 'פז אילת', tx_date: day, category_id: 'car', nature: 'variable', spread: 'month', created_at: day + 'T09:00:00Z' },
    { id: 'd2', household_id: 'h1', type: 'expense', amount: 333, description: 'פז', tx_date: day, category_id: 'car', nature: 'variable', spread: 'month', created_at: day + 'T10:00:00Z' }
  );
  const { page } = await open(390, db);
  const att = page.locator('.att');
  const all = await att.allTextContents();
  assert.ok(all.some((s) => /חריגה ברכב/.test(s)), all.join(' | '));
  assert.ok(all.some((s) => /חיוב כפול ב/.test(s)), all.join(' | '));
  assert.ok(all.length <= 3);
  await att.filter({ hasText: 'חיוב כפול' }).locator('.att-btn').click();
  await page.waitForSelector('.sheet');
  assert.equal(await page.locator('.sheet h2').textContent(), 'פרטי תנועה');
  await page.close();
});

test('a household with no transactions gets one clear way in: upload a statement', async () => {
  const db = makeFakeDb();
  db.tables.transactions = [];
  const { page, errors } = await open(390, db);
  assert.match(await page.locator('.empty').textContent(), /עוד אין תנועות/);
  await page.click('.empty >> text=העלאת פירוט כרטיס');
  assert.equal(await page.locator('.sheet h2').textContent(), 'העלאת פירוט כרטיס');
  assert.deepEqual(errors, []);
  await page.close();
});

test('desktop: two columns, no errors, and missing accounts tables do not break the screen', async () => {
  const db = makeFakeDb();
  const { page, errors } = await open(1280, db);
  const main = await page.locator('.home-main').boundingBox();
  const side = await page.locator('.home-side').boundingBox();
  assert.ok(Math.abs(main.y - side.y) < 2 && main.x > side.x, 'side by side, main on the right');
  assert.deepEqual(errors, []);
  await page.close();

  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db2 = makeFakeDb();
  await mockSupabase(page2, db2);
  await page2.route('**/rest/v1/bank_accounts**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"relation does not exist"}' }));
  await signIn(page2, server.base);
  await page2.goto(server.base + '/app/#/home');
  await page2.waitForSelector('.hero');
  assert.equal(await page2.locator('.cash').count(), 0);
  await page2.close();
});
