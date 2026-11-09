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
  await page.waitForSelector('.hero, .empty, .setup-guide');
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
  // Escape is heard once the sheet has taken focus (its effect runs after paint).
  await page.waitForFunction(() => document.activeElement && document.activeElement.closest('.sheet'));
  await page.keyboard.press('Escape');
  // The sheet closes on the next render; wait for it rather than racing it.
  await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 3000 });
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
  await att.filter({ hasText: 'חיוב כפול' }).locator('.att-btn').first().click();
  await page.waitForSelector('.sheet');
  assert.equal(await page.locator('.sheet h2').textContent(), 'פרטי תנועה');
  await page.close();
});

test('a suspected double charge: "both are real" keeps both lines and the question goes away for good', async () => {
  const db = makeFakeDb();
  const t = new Date();
  const day = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  db.tables.transactions.push(
    { id: 'r1', household_id: 'h1', type: 'expense', amount: 12, description: 'רכבת דמו', tx_date: day, category_id: 'car', nature: 'variable', spread: 'month', created_at: day + 'T09:00:00Z' },
    { id: 'r2', household_id: 'h1', type: 'expense', amount: 12, description: 'רכבת דמו', tx_date: day, category_id: 'car', nature: 'variable', spread: 'month', created_at: day + 'T18:00:00Z' }
  );
  const { page } = await open(390, db);
  const card = page.locator('.att', { hasText: 'חיוב כפול ברכבת דמו' });
  await card.locator('.att-btn2').click();
  await page.waitForSelector('.toast');
  assert.equal(await page.locator('.att', { hasText: 'חיוב כפול ברכבת דמו' }).count(), 0);
  assert.equal(db.tables.transactions.filter((x) => x.id === 'r1' || x.id === 'r2').length, 2, 'nothing deleted');
  assert.deepEqual(db.tables.dupe_ok.map((r) => [r.household_id, r.pair]), [['h1', 'r1|r2']], 'saved for the whole household');
  // Another device of the household (nothing saved on it) is not asked either.
  await page.evaluate(() => localStorage.removeItem('dupe:ok:h1'));
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.att', { hasText: 'חיוב כפול ברכבת דמו' }).count(), 0, 'remembered');
  await page.close();
});

test('a household with no transactions gets the setup guide, opened at the statement', async () => {
  const db = makeFakeDb();
  db.tables.transactions = [];
  const { page, errors } = await open(390, db);
  const guide = page.locator('.setup-guide');
  assert.match(await guide.textContent(), /בואו נסדר לכם את התמונה/);
  assert.match(await guide.locator('.guide-step.open').textContent(), /מעלים פירוטי אשראי של 6 חודשים/);
  await guide.locator('text=להעלות פירוט').click();
  assert.equal(await page.locator('.sheet h2').textContent(), 'העלאת פירוט');
  assert.deepEqual(errors, []);
  await page.close();
});

test('desktop: two columns, no errors, and missing accounts tables do not break the screen', async () => {
  const db = makeFakeDb();
  const { page, errors } = await open(1280, db);
  // Layout position (offsetTop/Left), not the box on screen: the entry
  // animation still moves the columns for a moment after the page shows.
  const [main, side] = await page.evaluate(() => ['.home-main', '.home-side'].map((q) => { const el = document.querySelector(q); return { x: el.offsetLeft, y: el.offsetTop }; }));
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

test('while the data loads, a picture is drawn instead of a blank page', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  await mockSupabase(page, db);
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/rest/v1/transactions*', async (r) => { await gate; return r.fallback(); });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.splash svg');
  assert.equal(await page.locator('.loading[role="status"]').count(), 1);
  assert.equal(await page.locator('.splash-word').textContent(), 'התקציב שלנו');
  release();
  await page.waitForSelector('.hero');
  assert.equal(await page.locator('.loading').count(), 0);
  await page.close();
});

test('the month number counts up and lands exactly on the amount; with reduced motion it shows at once', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero-num .countup');
  const final = await page.locator('.hero-num .sr-only').textContent();
  assert.match(final, /₪\d/);
  await page.waitForFunction(() => document.querySelector('.hero-num [aria-hidden="true"]').textContent === document.querySelector('.hero-num .sr-only').textContent);
  await page.close();

  const still = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  await mockSupabase(still, makeFakeDb());
  await signIn(still, server.base);
  await still.goto(server.base + '/app/#/home');
  await still.waitForSelector('.hero-num .countup');
  assert.equal(await still.locator('.hero-num [aria-hidden="true"]').textContent(), await still.locator('.hero-num .sr-only').textContent());
  assert.equal(await still.evaluate(() => getComputedStyle(document.querySelector('.hero')).animationName), 'none');
  await still.close();
});


test('the opening picture takes turns: house, plant, wallet, one per opening', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await mockSupabase(page, makeFakeDb());
  let release;
  let gate = new Promise((r) => { release = r; });
  await page.route('**/rest/v1/transactions*', async (r) => { await gate; return r.fallback(); });
  await signIn(page, server.base);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cache:')).forEach((k) => localStorage.removeItem(k)));
    await page.goto(server.base + '/app/?n=' + i + '#/home');
    await page.waitForSelector('.splash svg');
    seen.push(await page.locator('.splash').getAttribute('data-art'));
  }
  assert.deepEqual([...new Set(seen)].sort(), ['house', 'plant', 'wallet']);
  release();
  await page.close();
});

test('with reduced motion the finished picture shows at once', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await mockSupabase(page, makeFakeDb());
  await page.route('**/rest/v1/transactions*', () => new Promise(() => {}));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.splash svg');
  const off = await page.locator('.splash .sp-line').first().evaluate((el) => getComputedStyle(el).strokeDashoffset);
  assert.ok(['0', '0px'].includes(off), 'line already drawn: ' + off);
  assert.equal(await page.locator('.splash-word').evaluate((el) => getComputedStyle(el).opacity), '1');
  await context.close();
});
