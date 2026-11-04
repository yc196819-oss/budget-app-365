import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function openMoney(width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const db = makeFakeDb();
  const calls = [];
  const errors = collectErrors(page);
  await mockSupabase(page, db, calls);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/money');
  await page.waitForSelector('.month-nav');
  return { page, db, calls, errors };
}

test('loads only a bounded date range, page by page (not the whole history)', async () => {
  const { page, calls, errors } = await openMoney();
  const txCalls = calls.filter((c) => c.table === 'transactions' && c.method === 'GET');
  assert.ok(txCalls.length >= 1);
  assert.match(txCalls[0].query, /tx_date=gte\./);
  assert.match(txCalls[0].query, /limit=1000/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('month navigation: arrows, the 12-month strip and the year view', async () => {
  const { page, errors } = await openMoney();
  const title = () => page.locator('.month-nav b').textContent();
  const now = await title();
  await page.click('button[aria-label="החודש הקודם"]');
  assert.notEqual(await title(), now);
  assert.equal(await page.locator('button[aria-label="החודש הבא"]').isDisabled(), false);
  await page.locator('.strip button').first().click();
  assert.equal(await page.locator('button[aria-label="החודש הקודם"]').isDisabled(), true);
  await page.click('text=12 החודשים האחרונים');
  assert.equal(await page.locator('.month-nav').count(), 0);
  assert.equal(await page.locator('.group-head').count(), 2);
  await page.click('text=להציג עוד 3 חודשים');
  assert.equal(await page.locator('.group-head').count(), 5);
  assert.deepEqual(errors, []);
  await page.close();
});

test('search across the whole year shows a total', async () => {
  const { page } = await openMoney();
  await page.click('text=12 החודשים האחרונים');
  await page.fill('input[type="search"]', 'סונול');
  const summary = await page.locator('text=/נמצאו \\d+ תנועות/').textContent();
  assert.match(summary, /נמצאו 12 תנועות/);
  await page.close();
});

test('changing a category applies to the same merchant and can be undone', async () => {
  const { page, db } = await openMoney();
  // The previous month is always a full month of data, whatever today's date is.
  await page.click('button[aria-label="החודש הקודם"]');
  await page.locator('.row', { hasText: 'ארומה' }).first().click();
  await page.waitForSelector('.sheet');
  assert.ok(await page.locator('text=/לשנות גם ב-\\d+ התנועות האחרות של ארומה/').count());
  await page.locator('.sheet .chip', { hasText: 'רכב' }).click();
  await page.waitForSelector('.toast');
  const moved = db.tables.transactions.filter((t) => t.description === 'ארומה' && t.category_id === 'car').length;
  const all = db.tables.transactions.filter((t) => t.description === 'ארומה').length;
  assert.equal(moved, all);
  await page.click('.toast button');
  await page.waitForTimeout(300);
  assert.equal(db.tables.transactions.filter((t) => t.description === 'ארומה' && t.category_id === 'car').length, 0);
  assert.equal(db.tables.transactions.filter((t) => t.description === 'ארומה' && t.subcategory_id === 'cafe').length, all);
  await page.close();
});

test('delete hides at once, undo brings it back, nothing is deleted in the database', async () => {
  const { page, db } = await openMoney();
  const before = db.tables.transactions.length;
  const rows = await page.locator('.list .row').count();
  await page.locator('.list .row').first().click();
  await page.click('text=מחיקת התנועה');
  assert.equal(await page.locator('.list .row').count(), rows - 1);
  await page.click('.toast button');
  assert.equal(await page.locator('.list .row').count(), rows);
  await page.waitForTimeout(5500);
  assert.equal(db.tables.transactions.length, before);
  await page.close();
});

test('delete without undo removes it from the database after the undo window', async () => {
  const { page, db } = await openMoney();
  const before = db.tables.transactions.length;
  await page.locator('.list .row').first().click();
  await page.click('text=מחיקת התנועה');
  await page.waitForTimeout(5600);
  assert.equal(db.tables.transactions.length, before - 1);
  await page.close();
});

test('quick add: free text, category guessed from the merchant, Enter adds', async () => {
  const { page, db } = await openMoney();
  await page.click('.nav-add');
  await page.fill('.sheet input.input', '52 ארומה');
  assert.ok(await page.locator('text=כמו בפעם הקודמת').count());
  await page.press('.sheet input.input', 'Enter');
  await page.waitForSelector('.toast');
  const added = db.tables.transactions.find((t) => String(t.id).startsWith('new'));
  assert.equal(added.amount, 52);
  assert.equal(added.description, 'ארומה');
  assert.equal(added.category_id, 'food');
  assert.equal(added.subcategory_id, 'cafe');
  assert.equal(added.household_id, 'h1');
  assert.ok(await page.locator('.row', { hasText: 'ארומה' }).first().textContent());
  await page.close();
});

test('one-tap add from the most frequent merchants', async () => {
  const { page, db } = await openMoney();
  await page.click('.nav-add');
  const quick = page.locator('.sheet button.chip', { hasText: 'ארומה' });
  assert.ok(await quick.count());
  await quick.first().click();
  await page.waitForSelector('.toast');
  assert.ok(db.tables.transactions.some((t) => String(t.id).startsWith('new') && t.description === 'ארומה'));
  await page.close();
});

test('categories view: spending vs budget, and the 12-month detail', async () => {
  const { page, errors } = await openMoney();
  await page.click('button[aria-label="החודש הקודם"]');
  await page.click('.tabs >> text=קטגוריות');
  const food = page.locator('.list .row', { hasText: 'אוכל' });
  assert.match(await food.textContent(), /מתוך ₪3,000/);
  await food.click();
  await page.waitForSelector('.sheet');
  assert.match(await page.locator('.sheet').textContent(), /12 החודשים האחרונים/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('yearly report on desktop, no errors', async () => {
  const { page, errors } = await openMoney(1440);
  await page.click('text=12 החודשים האחרונים');
  await page.click('.tabs >> text=דוח');
  assert.match(await page.locator('main').textContent(), /כמה נשאר בסוף כל חודש/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a category of my own, right from a transaction: it is created and the transaction moves into it', async () => {
  const { page, db, errors } = await openMoney();
  await page.click('button[aria-label="החודש הקודם"]');
  await page.locator('.row', { hasText: 'ארומה' }).first().click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet button.chip-add', { hasText: '+ קטגוריה חדשה' }).click();
  await page.fill('.sheet input[aria-label="שם הקטגוריה"]', 'בתי קפה');
  await page.locator('.sheet .icon-pick button', { hasText: '🍔' }).click();
  await page.locator('.sheet .new-category button:has-text("להוסיף")').click();
  await page.waitForSelector('.toast:has-text("עודכנו")');
  const cat = db.tables.categories.find((c) => c.name === 'בתי קפה');
  assert.ok(cat, 'saved');
  assert.equal(cat.icon, '🍔');
  assert.equal(cat.kind, 'expense');
  assert.equal(cat.household_id, 'h1');
  assert.ok(db.tables.transactions.filter((t) => t.description === 'ארומה').every((t) => t.category_id === cat.id), 'the transaction (and its merchant) moved in');
  // The same name again picks the one that exists, instead of a twin.
  await page.locator('.sheet button.chip-add', { hasText: '+ קטגוריה חדשה' }).click();
  await page.fill('.sheet input[aria-label="שם הקטגוריה"]', ' בתי  קפה ');
  await page.locator('.sheet .new-category button:has-text("להוסיף")').click();
  await page.waitForSelector('.toast:has-text("נבחרה הקטגוריה הקיימת")');
  assert.equal(db.tables.categories.filter((c) => c.name === 'בתי קפה').length, 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('managing categories: add one, add a sub-category, rename; one with no spending shows too', async () => {
  const { page, db, errors } = await openMoney();
  await page.locator('[role=tab]:has-text("קטגוריות"), button:has-text("קטגוריות")').first().click();
  await page.click('button.manage-cats');
  await page.waitForSelector('.manage-categories');
  await page.locator('.manage-categories > button.chip-add', { hasText: '+ קטגוריה חדשה' }).click();
  await page.fill('.manage-categories input[aria-label="שם הקטגוריה"]', 'חיות מחמד');
  await page.locator('.manage-categories .new-category button:has-text("להוסיף")').click();
  await page.locator('.manage-row', { hasText: 'חיות מחמד' }).waitFor();
  const pets = db.tables.categories.find((c) => c.name === 'חיות מחמד');
  assert.ok(pets);
  const row = page.locator('.manage-row', { hasText: 'חיות מחמד' });
  await row.locator('button.chip-add', { hasText: '+ תת-קטגוריה' }).click();
  await row.locator('input[aria-label="שם הקטגוריה"]').fill('וטרינר');
  await row.locator('.new-category button:has-text("להוסיף")').click();
  await row.locator('text=וטרינר').waitFor();
  assert.equal(db.tables.categories.find((c) => c.name === 'וטרינר').parent_id, pets.id);
  await row.locator('button[aria-label="לשנות שם: חיות מחמד"]').click();
  await page.locator('input[aria-label="שם חדש לחיות מחמד"]').fill('הכלב');
  await page.locator('.rename-form button:has-text("לשמור")').click();
  await page.locator('.manage-row', { hasText: 'הכלב' }).waitFor();
  assert.equal(db.tables.categories.find((c) => c.id === pets.id).name, 'הכלב');
  // A name that is too short is explained, not saved.
  await page.locator('.manage-categories > button.chip-add').click();
  await page.fill('.manage-categories input[aria-label="שם הקטגוריה"]', 'א');
  assert.ok(await page.locator('.manage-categories .new-category button:has-text("להוסיף")').isDisabled());
  assert.deepEqual(errors, []);
  await page.close();
});

test('after a change: "always file it like this?" makes a rule, listed in categories, where it can be changed or deleted', async () => {
  const { page, db } = await openMoney();
  await page.click('button[aria-label="החודש הקודם"]');
  await page.locator('.row', { hasText: 'ארומה' }).first().click();
  await page.locator('.sheet .chip', { hasText: 'רכב' }).click();
  const ask = page.locator('.rule-ask');
  await ask.waitFor();
  assert.match(await ask.textContent(), /לסווג תמיד את ארומה כ"רכב"\?/);
  await ask.locator('button:has-text("כן, תמיד")').click();
  await page.waitForSelector('.rule-saved');
  assert.deepEqual(db.tables.category_rules.map((r) => [r.match, r.category_id, r.type, r.household_id]), [['ארומה', 'car', 'expense', 'h1']]);
  // "Only this time" saves nothing.
  await page.locator('.sheet .chip', { hasText: 'אוכל' }).first().click();
  await page.locator('.rule-ask button:has-text("רק הפעם")').click();
  assert.equal(db.tables.category_rules.length, 1);
  await page.click('.sheet button[aria-label="סגירה"]');
  // The list, in managing categories.
  await page.locator('[role=tab]:has-text("קטגוריות"), button:has-text("קטגוריות")').first().click();
  await page.click('button.manage-cats');
  const row = page.locator('.rule-row', { hasText: 'ארומה' });
  await row.waitFor();
  assert.match(await row.textContent(), /← רכב/);
  await row.locator('.rule-del').click();
  await row.locator('.rule-del:has-text("בטוח?")').click();
  await page.waitForSelector('text=הכלל נמחק');
  assert.equal(db.tables.category_rules.length, 0);
  await page.close();
});

test('deleting a category: its transactions, budget and rules move to the chosen one; an empty sub-category goes at once', async () => {
  const { page, db, errors } = await openMoney();
  db.tables.category_rules = [{ id: 'r1', household_id: 'h1', type: 'expense', match: 'סונול', label: 'סונול', category_id: 'car', subcategory_id: null, created_by: 'u1', created_at: '2026-10-01' }];
  const carTx = db.tables.transactions.filter((t) => t.category_id === 'car').map((t) => t.id);
  await page.locator('[role=tab]:has-text("קטגוריות"), button:has-text("קטגוריות")').first().click();
  await page.click('button.manage-cats');
  await page.waitForSelector('.manage-categories');
  await page.click('button[aria-label="למחוק: רכב"]');
  const box = page.locator('.cat-delete');
  await box.locator('select[aria-label="לאן להעביר"]').waitFor();
  const text = await box.textContent();
  assert.match(text, new RegExp(carTx.length + ' תנועות'));
  assert.match(text, /תקציב חודשי/);
  assert.match(text, /כלל סיווג אחד/);
  // Nothing happens until a category is chosen.
  assert.ok(await box.locator('button:has-text("להעביר ולמחוק")').isDisabled());
  await box.locator('select[aria-label="לאן להעביר"]').selectOption({ label: 'בית ודיור' });
  await box.locator('button:has-text("להעביר ולמחוק")').click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="למחוק: רכב"]'));
  const t = db.tables;
  assert.ok(!t.categories.some((c) => c.id === 'car'));
  assert.ok(carTx.every((id) => t.transactions.find((x) => x.id === id).category_id === 'home'));
  assert.equal(t.category_rules[0].category_id, 'home');
  // The car budget (900) is added to the target's.
  assert.equal(t.category_budgets.find((b) => b.category_id === 'home').monthly_amount, 900);

  // A sub-category: its lines stay in the parent.
  await page.click('button[aria-label="למחוק: מסעדות ואוכל בחוץ"]');
  await page.locator('.cat-delete:has-text("יישארו באוכל")').waitFor();
  await page.click('.cat-delete button:has-text("כן, למחוק")');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="למחוק: מסעדות ואוכל בחוץ"]'));
  assert.ok(!t.categories.some((c) => c.id === 'cafe'));
  assert.ok(t.transactions.filter((x) => x.description === 'ארומה').every((x) => x.category_id === 'food'));
  // Cancel leaves everything as it was.
  await page.click('button[aria-label="למחוק: בית ודיור"]');
  await page.click('.cat-delete button:has-text("ביטול")');
  assert.equal(await page.locator('.cat-delete').count(), 0);
  assert.ok(t.categories.some((c) => c.id === 'home'));
  assert.deepEqual(errors, []);
  await page.close();
});
