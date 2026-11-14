import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const TODAY = new Date(2026, 10, 14, 10);
// The app's public contact address, which is also the owner's (as in the other tests).
const OWNER = 'budgetapp2852@gmail.com';

// Made-up apartments of a made-up family.
const RENTED = { id: 'p1', household_id: 'h1', name: 'הדירה בבית שמש', city: 'בית שמש', home: false, rented: true, value: 1650000, rent: 6000, costs: { arnona: 380, vaad: 150 }, mortgage: { balance: 820000, rate: 4.6, payment: 4700, months: null }, created_at: '2026-11-01T10:00:00Z' };
const HOME = { id: 'p2', household_id: 'h1', name: 'הבית שלנו', city: 'ירושלים', home: true, rented: false, value: 2800000, rent: null, costs: { arnona: 650 }, mortgage: { balance: 650000, rate: 5, payment: 2600, months: null }, created_at: '2026-11-02T10:00:00Z' };

async function open({ email = OWNER, width = 390, setup = () => {}, missing = false, hash = '#/assets/homes', scheme = 'light' } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const db = makeFakeDb(TODAY);
  db.tables.properties = [];
  setup(db);
  const errors = collectErrors(page);
  const calls = [];
  await mockSupabase(page, db, calls);
  if (missing) await page.route('**/rest/v1/properties**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST205","message":"no table"}' }));
  await page.route('**/api/market/quotes**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"usdIls":3.7,"quotes":{}}' }));
  await signIn(page, server.base);
  if (email) await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, email);
  await page.goto(server.base + '/app/' + hash);
  await page.reload();
  await page.locator('.tabs[role=group]').first().waitFor({ timeout: 8000 }).catch(async (e) => { console.log('BODY:', (await page.locator('body').innerText()).slice(0, 600)); throw e; });
  return { page, db, errors, calls };
}

test('a regular family sees no apartments view, and the table is never asked for', async () => {
  const { page, errors, calls } = await open({ email: 'yossi@example.com' });
  await page.locator('text=חשבונות').first().waitFor();
  assert.equal(await page.locator('text=דירות ומשכנתא').count(), 0);
  // Even with the view's address typed, the daily view opens.
  assert.ok(await page.locator('text=כרטיסי אשראי').count() > 0);
  assert.equal(calls.filter((c) => c.table === 'properties').length, 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the owner adds an apartment: the rent found in the account, the month, the mortgage and when it ends', async () => {
  const { page, db, errors } = await open({
    setup: (d) => {
      // Rent from the same made-up tenant, four months in a row.
      for (const m of ['07', '08', '09', '10']) d.tables.transactions.push({ id: 'r' + m, household_id: 'h1', type: 'income', amount: 5200, description: 'העברה מ כהן משה', tx_date: '2026-' + m + '-03', category_id: null, created_at: '2026-' + m + '-03T10:00:00Z' });
    }
  });
  await page.locator('[role=tab]:has-text("דירות ומשכנתא"), button:has-text("דירות ומשכנתא")').first().waitFor();
  await page.locator('text=הוסיפו דירה נוספת').waitFor();
  await page.click('button:has-text("+ דירה")');
  const sheet = page.locator('.prop-form');
  await sheet.locator('label:has-text("שם") input').fill('הדירה בביתר');
  await sheet.locator('label:has-text("שווי") input').fill('1,450,000');
  // The rent, from the account: one tap.
  await sheet.locator('.prop-found .chip', { hasText: 'כהן משה' }).click();
  assert.equal(await sheet.locator('label:has-text("שכר דירה") input').inputValue(), '5200');
  await sheet.locator('label:has-text("ארנונה") input').fill('300');
  await sheet.locator('label:has-text("כמה נשאר לשלם") input').fill('900,000');
  await sheet.locator('label:has-text("ריבית") input').fill('5.1');
  // Without the payment, the months left (the payment is worked out).
  await sheet.locator('label:has-text("כמה חודשים") input').fill('300');
  await sheet.locator('button[type=submit]').click();
  await page.locator('.prop-card').waitFor();
  const row = db.tables.properties[0];
  assert.equal(row.name, 'הדירה בביתר');
  assert.equal(row.rent, 5200);
  assert.equal(row.rent_payer, 'העברה מ כהן משה');
  assert.deepEqual(row.mortgage, { balance: 900000, rate: 5.1, payment: null, months: 300 });
  const card = await page.locator('.prop-card').textContent();
  // ₪900,000 at 5.1% over 300 months: about ₪5,314 a month, ending 10/2051 or 11/2051.
  assert.match(card, /החזר משכנתא−₪5,31\d/);
  assert.match(card, /נגמרת(10|11)\/2051/);
  assert.match(card, /נשאר בכיס בחודש−₪4\d\d/);
  assert.match(card, /תשואה: 4\.3%/);
  // The hero: what is theirs, and what is left on the mortgage.
  assert.match(await page.locator('.hero').textContent(), /₪550,000/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('paying back a sum: the two ways, with the interest each saves', async () => {
  const { page, errors } = await open({ setup: (d) => { d.tables.properties = [RENTED]; } });
  await page.locator('.prop-card').waitFor();
  await page.locator('.prop-prepay summary').click();
  await page.locator('.prop-prepay input').fill('100,000');
  const opts = await page.locator('.prop-options').textContent();
  assert.match(opts, /לקצר את התקופה/);
  assert.match(opts, /מוקדם יותר/);
  assert.match(opts, /ההחזר יורד ב-₪\d/);
  assert.match(opts, /עמלת פירעון מוקדם/);
  // Over the tax-exempt ceiling: said, as something to check (no advice).
  assert.match(await page.locator('.prop-note').first().textContent(), /רואה חשבון/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the home mortgage counts too, and a payment below the interest is said plainly', async () => {
  const { page, errors } = await open({ setup: (d) => { d.tables.properties = [HOME]; } });
  await page.locator('.prop-card').waitFor();
  const card = await page.locator('.prop-card').textContent();
  assert.match(card, /עולה לכם בחודש₪3,250/);
  assert.doesNotMatch(card, /שכירות נכנסת/);
  assert.match(card, /לא מכסה אפילו את הריבית/);
  assert.equal(await page.locator('.prop-prepay').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('editing and deleting an apartment', async () => {
  const { page, db, errors } = await open({ setup: (d) => { d.tables.properties = [RENTED]; } });
  await page.locator('.prop-card').waitFor();
  await page.click('button[aria-label="עריכה: הדירה בבית שמש"]');
  await page.locator('.prop-form label:has-text("שכר דירה") input').fill('5,400');
  await page.locator('.prop-form button[type=submit]').click();
  await page.locator('.prop-card:has-text("+₪5,400")').waitFor();
  assert.equal(db.tables.properties[0].rent, 5400);
  await page.click('button[aria-label="עריכה: הדירה בבית שמש"]');
  await page.click('.prop-form button:has-text("למחוק")');
  await page.locator('text=הוסיפו דירה נוספת').waitFor();
  assert.equal(db.tables.properties.length, 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('before the table exists, the view says so instead of failing', async () => {
  const { page } = await open({ missing: true });
  await page.locator('text=supabase_properties.sql').waitFor();
  await page.close();
});

for (const scheme of ['light', 'dark']) {
  test('the apartments view passes WCAG AA (' + scheme + ', phone)', async () => {
    const { page, errors } = await open({ scheme, setup: (d) => { d.tables.properties = [RENTED, HOME]; } });
    await page.locator('.prop-card').first().waitFor();
    await page.locator('.prop-prepay summary').first().click();
    await page.locator('.prop-prepay input').first().fill('50000');
    await page.evaluate(AXE);
    await page.waitForTimeout(500);
    const v = await page.evaluate(async () => (await window.axe.run(document.querySelector('main') || document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] })).violations.map((x) => x.id + ': ' + x.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' ' + (n.failureSummary || '').split('\n').slice(1, 2).join('')).join(' | ')));
    assert.deepEqual(v, []);
    // Nothing wider than the phone.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('an apartment run through its own bank account: the rent and costs come from there', async () => {
  const { page, db, errors } = await open({
    setup: (d) => {
      d.tables.bank_accounts.push({ id: 'a2', household_id: 'h1', name: 'חשבון הדירה', bank_name: 'בנק בדוי', balance: 3000, balance_updated_at: '2026-11-10T08:00:00Z' });
      for (const m of ['08', '09', '10']) {
        d.tables.transactions.push({ id: 'ar' + m, household_id: 'h1', account_id: 'a2', type: 'income', amount: 5200, description: 'העברה מ כהן משה', tx_date: '2026-' + m + '-03', category_id: null, created_at: '2026-' + m + '-03T10:00:00Z' });
        d.tables.transactions.push({ id: 'aa' + m, household_id: 'h1', account_id: 'a2', type: 'expense', amount: 380, description: 'ארנונה', tx_date: '2026-' + m + '-05', category_id: null, created_at: '2026-' + m + '-05T10:00:00Z' });
        d.tables.transactions.push({ id: 'am' + m, household_id: 'h1', account_id: 'a2', type: 'expense', amount: 4700, description: 'הלוואה לדיור', tx_date: '2026-' + m + '-10', category_id: null, created_at: '2026-' + m + '-10T10:00:00Z' });
      }
    }
  });
  await page.click('button:has-text("+ דירה")');
  const sheet = page.locator('.prop-form');
  await sheet.locator('label:has-text("שם") input').fill('הדירה בבית שמש');
  await sheet.locator('label:has-text("שווי") input').fill('1,650,000');
  await sheet.locator('label:has-text("חשבון בנק נפרד") select').selectOption('a2');
  assert.match(await sheet.locator('.prop-note').textContent(), /נכנסים ₪5,200, יוצאים ₪380 בחודש, ועוד ₪4,700 החזר משכנתא/);
  await sheet.locator('label:has-text("כמה נשאר לשלם") input').fill('820,000');
  await sheet.locator('label:has-text("ריבית") input').fill('4.6');
  await sheet.locator('label:has-text("החזר חודשי") input').fill('4,700');
  await sheet.locator('button[type=submit]').click();
  await page.locator('.prop-card').waitFor();
  assert.equal(db.tables.properties[0].account_id, 'a2');
  const card = await page.locator('.prop-card').textContent();
  assert.match(card, /לפי חשבון הדירה: ממוצע של 3 החודשים האחרונים/);
  assert.match(card, /שכירות נכנסת\+₪5,200/);
  assert.match(card, /הוצאות בחשבון \(בלי המשכנתא\)−₪380/);
  assert.match(card, /נשאר בכיס בחודש₪120/);
  assert.deepEqual(errors, []);
  await page.close();
});
