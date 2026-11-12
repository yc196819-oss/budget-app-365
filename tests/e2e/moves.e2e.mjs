import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

// Made-up household: a meal, ₪250 back from a friend by Bit, and ₪3,000
// out of an investment. Nothing changes until the household chooses.
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = new Date();
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const day = (n) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
const waitFor = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await new Promise((r) => setTimeout(r, 100)); };

async function open() {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  db.tables.transactions.push(
    { id: 'meal', household_id: db.hid, type: 'expense', amount: 500, description: 'מסעדה בדויה', tx_date: day(3), category_id: 'food', subcategory_id: 'cafe', nature: 'variable', spread: 'month' },
    { id: 'bit', household_id: db.hid, type: 'income', amount: 250, description: 'העברה ב BIT - יעל', tx_date: day(1), account_id: 'a1', source: 'import', nature: 'variable', spread: 'month' },
    { id: 'sale', household_id: db.hid, type: 'income', amount: 3000, description: 'מכירת ניירות ערך', tx_date: day(2), account_id: 'a1', source: 'import', nature: 'variable', spread: 'month' });
  db.tables.investments = [{ id: 'inv1', household_id: db.hid, name: 'קרן בדויה', current_value: 42000, cost: 30000 }];
  db.tables.dupe_ok = [];
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.att');
  return { page, db, errors };
}
const row = (db, id) => db.tables.transactions.find((t) => t.id === id);

test('Bit money in: asked, then saved as a refund of the meal (the meal counts less), and undone', async () => {
  const { page, db, errors } = await open();
  const att = page.locator('.att', { hasText: 'נכנסו מביט' });
  assert.match(await att.textContent(), /250/);
  await att.locator('button:has-text("לבחור")').click();
  await page.waitForSelector('.mv');
  assert.equal(row(db, 'bit').type, 'income', 'nothing changed by itself');
  assert.match(await page.locator('.mv-item.on').textContent(), /מסעדה בדויה/);
  assert.match(await page.locator('.mv-sub').textContent(), /ההוצאה תיספר ₪250 ולא ₪500/);
  await page.click('.mv button:has-text("לשמור")');
  await waitFor(() => row(db, 'bit').nature === 'refund');
  assert.deepEqual([row(db, 'bit').type, Number(row(db, 'bit').amount), row(db, 'bit').category_id], ['expense', -250, 'food']);
  await page.waitForSelector('.toast:has-text("נשמר כהחזר")');
  assert.equal(await page.locator('.att', { hasText: 'נכנסו מביט' }).count(), 0);
  // In the money list: shown as money back; undone from its details.
  await page.goto(server.base + '/app/#/money');
  const line = page.locator('.row', { hasText: 'העברה ב BIT' });
  await line.waitFor();
  assert.match(await line.textContent(), /החזר.*\+₪250/);
  await line.click();
  await page.click('.sheet button:has-text("לבטל")');
  await waitFor(() => row(db, 'bit').type === 'income');
  assert.deepEqual([row(db, 'bit').type, Number(row(db, 'bit').amount), row(db, 'bit').nature], ['income', 250, 'variable']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Bit "my own money" is a transfer; "income" is kept and not asked again', async () => {
  const { page, db, errors } = await open();
  await page.locator('.att', { hasText: 'נכנסו מביט' }).locator('button').click();
  await page.click('.mv-pick:has-text("כסף שלי מביט")');
  await page.click('.mv button:has-text("לשמור")');
  await waitFor(() => row(db, 'bit').type === 'transfer_in');
  assert.equal(row(db, 'bit').type, 'transfer_in');
  // The investment line: "a gain" keeps it income, and it is not asked again.
  await page.locator('.att', { hasText: 'מהשקעה' }).locator('button').click();
  await page.click('.mv-pick:has-text("רווח או דיבידנד")');
  await page.click('.mv button:has-text("לשמור")');
  await waitFor(() => db.tables.dupe_ok.length > 0);
  assert.deepEqual(db.tables.dupe_ok.map((r) => r.pair), ['a:sale']);
  assert.equal(row(db, 'sale').type, 'income');
  assert.equal(await page.locator('.att', { hasText: 'מהשקעה' }).count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a withdrawal from an investment: not income, and the investment is worth less', async () => {
  const { page, db, errors } = await open();
  await page.locator('.att', { hasText: 'מהשקעה' }).locator('button').click();
  await page.waitForSelector('.mv-item.on:has-text("קרן בדויה")');
  assert.match(await page.locator('.mv-sub').textContent(), /נוריד ₪3,000 משווי ההשקעה/);
  await page.click('.mv button:has-text("לשמור")');
  await waitFor(() => Number(db.tables.investments[0].current_value) === 39000);
  assert.equal(row(db, 'sale').type, 'transfer_in');
  assert.equal(Number(db.tables.investments[0].current_value), 39000);
  await page.waitForSelector('.toast:has-text("משיכה מההשקעה")');
  assert.deepEqual(errors, []);
  await page.close();
});
