import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open(hash, { db = makeFakeDb(), width = 390 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  return { page, db, errors };
}
const cardsSection = (page) => page.locator('section', { hasText: 'כרטיסי אשראי' });

test('a card is added with its last 4 digits, owner, billing day and limit', async () => {
  const { page, db, errors } = await open('#/assets');
  await page.waitForSelector('.hero');
  await page.click('text=+ כרטיס');
  await page.fill('.sheet input[required]', 'אמקס זהב');
  await page.fill('.sheet input[inputmode="numeric"][maxlength="4"]', '9912');
  await page.fill('.sheet input[placeholder="למשל 15,000"]', '12,000');
  assert.match(await page.locator('.sheet').textContent(), /לא שומרים כאן מספר כרטיס מלא/);
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  const card = db.tables.credit_cards.find((c) => c.name === 'אמקס זהב');
  assert.equal(card.last4, '9912');
  assert.equal(card.credit_limit, 12000);
  assert.equal(card.billing_day, 10);
  assert.equal(card.bank_account_id, 'a1');
  assert.equal(card.owner_user_id, 'u1');
  assert.equal(card.is_active, true);
  const row = cardsSection(page).locator('.row', { hasText: 'אמקס זהב' });
  assert.match(await row.textContent(), /••••9912/);
  assert.match(await row.textContent(), /נשארו ₪12,000 מתוך ₪12,000/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('only the last 4 digits can be typed; a wrong billing day blocks saving', async () => {
  const { page } = await open('#/assets');
  await page.waitForSelector('.hero');
  await page.click('text=+ כרטיס');
  const digits = page.locator('.sheet input[inputmode="numeric"][maxlength="4"]');
  await digits.fill('4580123412341234');
  assert.equal(await digits.inputValue(), '4580', 'a full number is cut to 4 digits, never stored');
  await page.fill('.sheet input[required]', 'כרטיס');
  await digits.fill('12');
  assert.ok(await page.locator('.sheet button[type="submit"]').isDisabled());
  await digits.fill('1234');
  await page.locator('.sheet label', { hasText: 'יום החיוב' }).locator('input').fill('31');
  assert.ok(await page.locator('.sheet button[type="submit"]').isDisabled());
  assert.match(await page.locator('.sheet').textContent(), /יום בין 1 ל-28/);
  await page.close();
});

test('editing a card sets its limit; the bar warns near the limit; removing archives it', async () => {
  const db = makeFakeDb();
  const { page } = await open('#/assets', { db });
  await page.waitForSelector('.hero');
  await cardsSection(page).locator('.row', { hasText: 'ויזה 4821' }).click();
  await page.fill('.sheet input[maxlength="4"]', '4821');
  await page.fill('.sheet input[placeholder="למשל 15,000"]', '1,000');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  assert.equal(db.tables.credit_cards[0].credit_limit, 1000);
  const row = cardsSection(page).locator('.row', { hasText: 'ויזה 4821' });
  assert.match(await row.textContent(), /חריגה של ₪[\d,]+ מהמסגרת/, 'the month\'s card purchases are over a ₪1,000 limit');
  assert.equal(await row.locator('[role="meter"]').count(), 1);
  await row.click();
  await page.click('text=להסיר את הכרטיס');
  await page.click('text=כן, להסיר');
  await page.waitForSelector('.toast:has-text("הכרטיס הוסר")');
  await page.waitForFunction(() => ![...document.querySelectorAll('section')].some((s) => s.textContent.includes('ויזה 4821')));
  assert.equal(db.tables.credit_cards[0].is_active, false, 'archived, not deleted: past purchases keep their card');
  assert.equal(db.tables.credit_cards.length, 1);
  assert.equal(await cardsSection(page).locator('.row').count(), 0);
  await page.close();
});

test('an expense records the card it was paid with; "not by card" leaves it out', async () => {
  const db = makeFakeDb();
  db.tables.credit_cards.push({ id: 'c2', household_id: 'h1', name: 'אמקס', last4: '9912', bank_account_id: 'a1', billing_day: 2 });
  const { page, errors } = await open('#/money', { db });
  await page.waitForSelector('.month-nav');
  await page.click('.nav-add');
  await page.waitForSelector('.sheet input.input');
  const chips = page.locator('.pay-chips');
  // Two cards and none used yet on this device: nothing is picked for you.
  assert.equal(await chips.locator('[aria-pressed="true"]').textContent(), 'לא בכרטיס');
  await chips.locator('button', { hasText: '••••9912' }).click();
  await page.fill('.sheet input.input', '120 מסעדה');
  await page.click('.sheet .btn:has-text("להוסיף")');
  await page.waitForSelector('.toast');
  const first = db.tables.transactions.find((t) => t.description === 'מסעדה');
  assert.equal(first.card_id, 'c2');
  assert.equal(first.account_id, 'a1');
  assert.equal(first.payment_method, 'credit');

  // Next time the same card is already chosen; switching to "not by card".
  await page.click('.nav-add');
  await page.waitForSelector('.sheet input.input');
  assert.match(await chips.locator('[aria-pressed="true"]').textContent(), /אמקס/);
  await chips.locator('text=לא בכרטיס').click();
  await page.fill('.sheet input.input', '30 חניה');
  await page.click('.sheet .btn:has-text("להוסיף")');
  await page.waitForFunction(() => document.querySelectorAll('.toast').length > 0);
  await page.waitForTimeout(150);
  const second = db.tables.transactions.find((t) => t.description === 'חניה');
  assert.equal(second.card_id, undefined);
  assert.equal(second.payment_method, undefined);
  assert.deepEqual(errors, []);
  await page.close();
});

test('income has no card choice', async () => {
  const { page } = await open('#/money');
  await page.waitForSelector('.month-nav');
  await page.click('.nav-add');
  await page.waitForSelector('.pay-chips');
  await page.click('.sheet .seg button:has-text("הכנסה")');
  assert.equal(await page.locator('.pay-chips').count(), 0);
  await page.close();
});
