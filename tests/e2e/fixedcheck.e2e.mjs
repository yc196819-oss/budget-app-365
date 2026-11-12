import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

// Made-up household: cellular, two streaming services and two health
// insurances, every month; one of them went up this month.
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = new Date();
const iso = (back, d) => { const x = new Date(today.getFullYear(), today.getMonth() - back, Math.min(d, back === 0 ? today.getDate() : 28)); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

async function openFixed(width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = makeFakeDb();
  let n = 0;
  const add = (description, amount, back, extra = {}) => db.tables.transactions.push({ id: 'f' + (++n), household_id: db.hid, type: 'expense', amount, description, tx_date: iso(back, 1), category_id: 'home', nature: 'variable', spread: 'month', ...extra });
  for (const back of [0, 1, 2]) {
    add('פרטנר תקשורת', 136, back);
    add('NETFLIX.COM', 55, back);
    add('DISNEY PLUS', 33, back);
    add('הראל ביטוח בריאות', back === 0 ? 152 : 138, back);
    add('מגדל ביטוח בריאות', 118, back);
  }
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.fxc');
  return { page, db, errors };
}

test('the fixed costs check: a card with what is worth a look, the check itself, and "not now" until next month', async () => {
  const { page, errors } = await openFixed();
  const card = page.locator('.fxc');
  assert.match(await card.textContent(), /₪494 בחודש/);
  assert.match(await card.textContent(), /על סלולר, מנויים וביטוחים · ₪5,928 בשנה/);
  assert.match(await card.textContent(), /4 דברים ששווה לבדוק/);
  await page.click('.fxc-hint');
  await page.waitForSelector('.fx-kind');
  const sheet = await page.locator('.fx').textContent();
  assert.match(sheet, /הראל ביטוח בריאות עלה מ-₪138 ל-₪152/);
  assert.match(sheet, /2 שירותי סטרימינג \(₪88 בחודש\)/);
  assert.match(sheet, /הר הביטוח/);
  assert.equal(await page.locator('.fx a[href="https://harb.cma.gov.il/"]').count(), 1);
  assert.match(sheet, /לא מוכרים ביטוחים/);
  // "Using both": that question is answered, and not raised again.
  await page.click('.fx-ins:has-text("סטרימינג") button:has-text("משתמשים בכולם")');
  assert.equal(await page.locator('.fx-ins:has-text("סטרימינג")').count(), 0);
  await page.click('.sheet button[aria-label="סגירה"]');
  assert.match(await page.locator('.fxc').textContent(), /3 דברים ששווה לבדוק/);
  await page.click('.fxc button:has-text("לא עכשיו")');
  assert.equal(await page.locator('.fxc').count(), 0);
  await page.reload();
  await page.waitForSelector('.att, .hero, .home');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.fxc').count(), 0, 'set aside for this month');
  assert.deepEqual(errors, []);
  await page.close();
});
