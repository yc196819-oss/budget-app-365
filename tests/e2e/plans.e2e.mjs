import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// A fixed "today", so holidays and quarters are always the same.
async function open(today, hash = '#/plans', width = 390, setup = () => {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.clock.setFixedTime(today);
  const db = makeFakeDb(today);
  db.tables.goals = [];
  db.tables.installments = [];
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  await page.waitForSelector(hash.startsWith('#/plans') ? '.tabs' : '.hero');
  return { page, db, errors };
}

const DEC1 = new Date(2026, 11, 1, 10);
const JAN5 = new Date(2027, 0, 5, 10);

test('the coming months: a verdict, six months with their lines, bars', async () => {
  const { page, errors } = await open(DEC1);
  assert.ok(await page.locator('.verdict b').count());
  assert.equal(await page.locator('.fc-month').count(), 6);
  assert.equal(await page.locator('.fc-col').count(), 6);
  assert.match(await page.locator('.fc-month').first().textContent(), /דצמבר 2026/);
  // The balance is known (fake bank account), so it is the balance at month end.
  assert.match(await page.locator('.fc-month').first().textContent(), /בסוף החודש יישאר/);
  await page.locator('.fc-month').nth(1).locator('.row').click();
  const lines = await page.locator('.fc-lines').textContent();
  assert.match(lines, /הכנסות \(ממוצע 3 חודשים\)/);
  assert.match(lines, /הוצאות קבועות/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a holiday plan is saved as a dated goal and replaces the estimate in the forecast', async () => {
  const { page, db } = await open(DEC1);
  const card = page.locator('.plan-card', { hasText: 'חנוכה' });
  assert.match(await card.textContent(), /חנוכה מתחיל בעוד 4 ימים/);
  await card.click();
  await page.waitForSelector('.sheet');
  await page.click('button[aria-label="להוסיף 50 למתנות לילדים"]');
  await page.click('.sheet button:has-text("לשמור את התוכנית")');
  await page.waitForSelector('.toast');
  const g = db.tables.goals.find((x) => x.name === 'חנוכה 2026');
  assert.ok(g, 'goal saved');
  assert.equal(g.target_date, '2026-12-05');
  assert.equal(g.target_amount, 450 + 200 + 500);
  assert.equal(g.household_id, 'h1');
  assert.deepEqual(g.plan_items.map((p) => p.name), ['מתנות לילדים', 'סופגניות ואירוח', 'בילויים בחופשה']);
  assert.match(await page.locator('.plan-card', { hasText: 'חנוכה' }).textContent(), /תכננתם ₪1,150/);
  await page.locator('.fc-month').first().locator('.row').click();
  assert.match(await page.locator('.fc-lines').textContent(), /מתוכנן: חנוכה 2026/);
  await page.close();
});

test('the quarterly check-in: from home, saved as dated goals, then it goes away', async () => {
  const { page, db } = await open(JAN5, '#/home');
  const card = page.locator('.plan-card', { hasText: 'בדיקה רבעונית' });
  assert.match(await card.textContent(), /ינואר, פברואר, מרץ/);
  await card.click();
  await page.click('.sheet .chip:has-text("טיפול או תיקון ברכב")');
  await page.click('.sheet .chip:has-text("₪2,500")');
  await page.click('.sheet .chip:has-text("פברואר")');
  await page.click('text=להוסיף לרשימה');
  await page.click('text=לשמור 1 הוצאות לתחזית');
  await page.waitForSelector('.toast');
  const g = db.tables.goals.find((x) => x.name === 'טיפול או תיקון ברכב · פברואר');
  assert.equal(g.target_date, '2027-02-15');
  assert.equal(g.target_amount, 2500);
  assert.equal(await page.locator('.plan-card', { hasText: 'בדיקה רבעונית' }).count(), 0);
  // It counts in February's forecast.
  await page.goto(server.base + '/app/#/plans');
  await page.waitForSelector('.fc-month');
  await page.locator('.fc-month', { hasText: 'פברואר 2027' }).locator('.row').click();
  assert.match(await page.locator('.fc-lines').textContent(), /מתוכנן: טיפול או תיקון ברכב · פברואר/);
  await page.close();
});

test('what if: a big purchase moves the bars, shows the before, and can be cleared', async () => {
  const { page } = await open(DEC1);
  await page.click('.whatif .chip:has-text("קנייה גדולה")');
  await page.click('.whatif .chip:has-text("₪40,000")');
  await page.click('.whatif .chip:has-text("ינואר")');
  await page.click('.whatif button:has-text("לבדוק")');
  assert.match(await page.locator('.whatif-result').textContent(), /בלי זה/);
  assert.ok(await page.locator('.fc-ghost').count() > 0);
  await page.click('text=לנקות את הבדיקה');
  assert.equal(await page.locator('.fc-ghost').count(), 0);
  await page.close();
});

test('budget: change a category budget in steps of 100 (upsert, no duplicates)', async () => {
  const { page, db } = await open(DEC1, '#/plans/budget');
  assert.equal(await page.locator('.tabs button[aria-pressed="true"]').textContent(), 'תקציב ויעדים');
  await page.locator('.budget-row', { hasText: 'אוכל' }).locator('.row').click();
  await page.click('button[aria-label="להעלות ב-100"]');
  await page.waitForFunction(() => document.querySelector('.budget-edit b').textContent.includes('3,100'));
  const food = db.tables.category_budgets.filter((b) => b.category_id === 'food');
  assert.equal(food.length, 1);
  assert.equal(food[0].monthly_amount, 3100);
  await page.close();
});

test('goals: add money to a goal, and delete it', async () => {
  const { page, db } = await open(DEC1, '#/plans/budget', 1280, (d) => {
    d.tables.goals.push({ id: 'g1', household_id: 'h1', name: 'קרן חירום', icon: '🛟', target_amount: 30000, saved_amount: 6000, target_date: null, plan_items: [] });
  });
  const goal = page.locator('.goal', { hasText: 'קרן חירום' });
  assert.match(await goal.textContent(), /20%/);
  await goal.locator('.goal-head').click();
  await page.fill('input[aria-label="כמה הפרשתם לקרן חירום"]', '1,500');
  await page.click('.goal button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.goal').textContent.includes('25%'));
  assert.equal(db.tables.goals[0].saved_amount, 7500);
  await page.click('.goal >> text=למחוק');
  await page.waitForSelector('text=עוד אין יעדים');
  assert.equal(db.tables.goals.length, 0);
  await page.close();
});
