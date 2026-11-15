import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// A friend's first days (made-up data of the same kind): card statements
// only, so no income; Bit payments without a category; no budget yet.
function firstUpload(db) {
  const day = new Date().toISOString().slice(0, 10);
  db.tables.transactions = db.tables.transactions.filter((t) => t.type !== 'income');
  db.tables.category_budgets = [];
  for (let i = 0; i < 3; i++) db.tables.transactions.push({ id: 'bit' + i, household_id: 'h1', type: 'expense', amount: 40 + i * 10, description: 'BIT', tx_date: day, category_id: null, created_by: 'u1', nature: 'variable', spread: 'month', created_at: day + 'T10:00:00Z' });
  db.tables.transactions.push({ id: 'shop1', household_id: 'h1', type: 'expense', amount: 99, description: 'חנות בדויה', tx_date: day, category_id: null, created_by: 'u1', nature: 'variable', spread: 'month', created_at: day + 'T10:00:00Z' });
  return db;
}
async function open(hash) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = collectErrors(page);
  const db = firstUpload(makeFakeDb());
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  await page.reload();
  return { page, db, errors };
}

test('no income yet: the money screen says why, and how to add it', async () => {
  const { page, errors } = await open('#/money');
  const hint = page.locator('.income-hint');
  await hint.waitFor();
  assert.match(await hint.textContent(), /נכנסות לחשבון הבנק/);
  await hint.locator('button:has-text("להוסיף הכנסה")').click();
  // The add sheet opens on income.
  await page.locator('text=הוספת הכנסה').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('a Bit payment: its category alone (not every Bit payment), then on to the next line without a category', async () => {
  const { page, db, errors } = await open('#/money');
  await page.locator('.list').first().waitFor();
  await page.locator('text=BIT').first().click();
  const sheet = page.locator('.sheet, [role=dialog]').first();
  await sheet.locator('text=פרטי תנועה').waitFor();
  assert.equal(await sheet.locator('text=לשנות גם ב-').count(), 0, 'no "change the others too"');
  assert.equal(await sheet.locator('text=כל הקניות ב').count(), 0);
  await sheet.locator('.chip', { hasText: 'אוכל' }).first().click();
  await page.waitForTimeout(400);
  assert.equal(db.tables.transactions.filter((t) => t.description === 'BIT' && t.category_id).length, 1, 'only this Bit payment');
  // On to the next line still without a category.
  const next = sheet.locator('.tx-next');
  assert.match(await next.textContent(), /נשארו 3/);
  await next.click();
  await page.locator('.tx-next:has-text("נשארו 2")').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('no budget yet: the home screen offers to set one by what is really spent', async () => {
  const { page, errors } = await open('#/home');
  const card = page.locator('.hero-budget');
  await card.waitFor();
  await card.locator('button:has-text("לקבוע תקציב")').click();
  await page.waitForFunction(() => /#\/plans/.test(location.hash));
  assert.deepEqual(errors, []);
  await page.close();
});
