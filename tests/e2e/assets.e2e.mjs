import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
import { summary } from '../../public/app/src/domain/assets.js';
import { money } from '../../public/app/src/domain/format.js';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const MARKET = { usdIls: 3.7, quotes: { SPY: { symbol: 'SPY', price: 500, currency: 'USD', changePct: 1.25 } } };

function withAssets(db) {
  db.tables.loans = [
    { id: 'l1', household_id: 'h1', direction: 'iowe', counterparty: 'הלוואת רכב', amount: 42000, note: '1,450 בחודש', settled: false },
    { id: 'l2', household_id: 'h1', direction: 'tome', counterparty: 'אחי', amount: 1500, settled: false },
    { id: 'l3', household_id: 'h1', direction: 'iowe', counterparty: 'ישנה', amount: 900, settled: true }
  ];
  db.tables.investments = [
    { id: 'i1', household_id: 'h1', name: 'S&P 500', asset_type: 'מניות/ETF', symbol: 'SPY', units: 2, currency: 'USD', cost: 3000, current_value: 3000 },
    { id: 'i2', household_id: 'h1', name: 'קרן השתלמות', asset_type: 'פנסיה/השתלמות', cost: 0, current_value: 80000 }
  ];
  db.tables.installments = [];
  db.tables.goals = [];
  return db;
}

async function open(hash, { width = 390, market = MARKET } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = withAssets(makeFakeDb());
  const errors = collectErrors(page);
  const quoteCalls = [];
  await mockSupabase(page, db);
  await page.route('**/api/market/quotes**', (r) => {
    quoteCalls.push(r.request().url());
    return market ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(market) }) : r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Market data unavailable"}' });
  });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  await page.waitForSelector('.hero');
  return { page, db, errors, quoteCalls };
}

test('daily view: net worth from accounts, investments, loans and cards; open loans only', async () => {
  const { page, db, errors } = await open('#/assets');
  const s = summary({ ...db.tables, accounts: db.tables.bank_accounts, cards: db.tables.credit_cards, txs: db.tables.transactions, market: MARKET, today: new Date() });
  const hero = await page.locator('.hero').textContent();
  assert.match(hero, /השווי הנקי/);
  assert.ok(hero.includes(money(s.net)), hero + ' vs ' + money(s.net));
  assert.ok(hero.includes(money(s.debts)));
  const loans = page.locator('section', { hasText: 'הלוואות וחובות' }).locator('.row');
  assert.equal(await loans.count(), 2);
  assert.match(await page.locator('section', { hasText: 'כרטיסי אשראי' }).textContent(), /ויזה 4821/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a loan can be added, then marked paid off', async () => {
  const { page, db } = await open('#/assets');
  await page.click('text=+ הלוואה');
  await page.fill('.sheet input[required] >> nth=0', 'הורים');
  await page.fill('.sheet input[inputmode="decimal"]', '10,000');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  const added = db.tables.loans.find((l) => l.counterparty === 'הורים');
  assert.equal(added.amount, 10000);
  assert.equal(added.direction, 'iowe');
  assert.equal(added.settled, false);
  await page.locator('.row', { hasText: 'הורים' }).click();
  await page.click('text=נפרע במלואו');
  await page.waitForTimeout(200);
  assert.equal(db.tables.loans.find((l) => l.counterparty === 'הורים').settled, true);
  assert.equal(await page.locator('.row', { hasText: 'הורים' }).count(), 0);
  await page.close();
});

test('a debt owed to us paid back each month: the app works out the payments, what is left, and the next one', async () => {
  const { page, db } = await open('#/assets');
  await page.click('text=+ הלוואה');
  await page.click('.sheet button:has-text("חייבים לנו")');
  await page.fill('.sheet input[required] >> nth=0', 'דני');
  await page.click('.sheet button:has-text("כל חודש")');
  await page.fill('.sheet input[inputmode="decimal"] >> nth=0', '5,000');
  await page.click('.sheet button:has-text("מספר תשלומים")');
  await page.fill('.sheet input[inputmode="numeric"]', '10');
  // Started two months ago, on the 1st: three payments came already.
  const t = new Date();
  const first = new Date(t.getFullYear(), t.getMonth() - 2, 1);
  const iso = first.getFullYear() + '-' + String(first.getMonth() + 1).padStart(2, '0') + '-01';
  await page.fill('.sheet input[type="date"]', iso);
  const preview = page.locator('.loan-preview');
  assert.match(await preview.textContent(), /10 תשלומים של ₪500/);
  assert.match(await preview.textContent(), /כבר שולמו 3, נשאר עכשיו ₪3,500/);
  assert.match(await preview.textContent(), /נספר בתחזית כהכנסה צפויה/);
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/loan-sheet.png' : '/dev/null' }).catch(() => {});
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  const added = db.tables.loans.find((l) => l.counterparty === 'דני');
  assert.deepEqual([added.direction, added.amount, added.monthly_amount, added.first_payment], ['tome', 5000, 500, iso]);
  const row = page.locator('.row', { hasText: 'דני' });
  assert.match(await row.textContent(), /\+₪3,500/);
  assert.match(await row.textContent(), /חייבים לנו · ₪500 בחודש/);
  assert.match(await row.locator(".row-sub2").textContent(), /^אמור להיכנס ₪500 ב-1\.\d+ · נשארו 7 תשלומים$/);
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/loan-row.png' : '/dev/null' }).catch(() => {});
  // Opened again: the plan is there to change.
  await row.click();
  assert.equal(await page.locator('.sheet input[inputmode="decimal"] >> nth=1').inputValue(), '500');
  await page.close();
});

test('the bank balance is edited from the account', async () => {
  const { page, db } = await open('#/assets');
  await page.locator('.row', { hasText: 'עו״ש' }).click();
  await page.fill('.sheet input[inputmode="decimal"]', '15,250');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  assert.equal(db.tables.bank_accounts[0].balance, 15250);
  assert.ok(db.tables.bank_accounts[0].balance_updated_at);
  await page.close();
});

test('long term: live price × units × USD rate, pension separately, a fund can be added', async () => {
  const { page, db, errors, quoteCalls } = await open('#/assets/long', { width: 1280 });
  assert.match(quoteCalls[0], /symbols=SPY/);
  const spy = page.locator('.row', { hasText: 'S&P 500' });
  assert.match(await spy.textContent(), /₪3,700/);
  assert.match(await spy.textContent(), /מחיר חי · היום \+1\.3%/);
  assert.match(await spy.textContent(), /רווח ₪700/);
  assert.match(await page.locator('.hero').textContent(), /₪83,700/);
  await page.click('text=+ קרן');
  await page.fill('.sheet input[required]', 'פנסיה מגדל');
  await page.fill('.sheet input[placeholder="מהדוח השנתי או מהאתר של הקרן"]', '210,000');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  const fund = db.tables.investments.find((i) => i.name === 'פנסיה מגדל');
  assert.equal(fund.asset_type, 'פנסיה/השתלמות');
  assert.equal(fund.current_value, 210000);
  assert.match(await page.locator('section.stack', { hasText: 'פנסיה והשתלמות' }).textContent(), /פנסיה מגדל/);
  assert.deepEqual(errors.filter((e) => !/502/.test(e)), []);
  await page.close();
});

test('without live prices the typed values are used and the screen says so', async () => {
  const { page } = await open('#/assets/long', { market: null });
  await page.waitForSelector('text=מחירים חיים לא זמינים כרגע');
  assert.match(await page.locator('.row', { hasText: 'S&P 500' }).textContent(), /₪3,000/);
  await page.close();
});
