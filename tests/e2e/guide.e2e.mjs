import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

async function open(db) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  await page.route('**/api/telemetry', (r) => r.fulfill({ status: 204, body: '' }));
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  return { page, errors };
}

function withLoose(db) {
  db.tables.households = [{ id: 'h1', income_expectations: [] }];
  const d = iso(new Date());
  db.tables.transactions.push(
    { id: 'l1', household_id: 'h1', type: 'expense', amount: 6500, description: 'לטובת: משכנתא', tx_date: d, category_id: null, source: 'pdf', created_at: '2026-11-01T18:14:44Z' },
    { id: 'l2', household_id: 'h1', type: 'expense', amount: 1000, description: 'תרומה לעמותה', tx_date: d, category_id: null, source: 'pdf', created_at: '2026-11-01T18:14:44Z' },
    { id: 'l3', household_id: 'h1', type: 'expense', amount: 1000, description: 'תרומה לעמותה', tx_date: d, category_id: null, source: 'pdf', created_at: '2026-11-01T18:14:44Z' }
  );
  return db;
}

test('the guide resumes at the first step not done, and saving the income ticks it', async () => {
  const db = withLoose(makeFakeDb());
  const { page, errors } = await open(db);
  const guide = page.locator('.setup-guide');
  assert.match(await guide.textContent(), /ממשיכים מאיפה שעצרתם/);
  assert.match(await guide.locator('.guide-step.open').textContent(), /מסווגים את מה שנשאר/);
  assert.match(await guide.locator('.guide-step.open').textContent(), /3 תנועות מחכות לקטגוריה/);
  // Not relevant: skip; the next one opens.
  await guide.locator('text=לא רלוונטי לי').click();
  assert.match(await guide.locator('.guide-step.open').textContent(), /כמה נכנס בחודש/);
  await guide.locator('input[aria-label="הכנסה חודשית נטו"]').fill('18,000');
  await guide.locator('button:has-text("לשמור")').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.guide-step.done')].some((el) => /כמה נכנס בחודש/.test(el.textContent)));
  assert.deepEqual(db.tables.households[0].income_expectations, [{ label: 'הכנסה חודשית נטו', amount: 18000 }]);
  // Skips are remembered after reopening the app.
  await page.reload();
  // The app opens with the data kept on the device, then refreshes: wait for the fresh one.
  await page.waitForFunction(() => { const el = document.querySelector('.setup-guide .guide-step.open'); return el && !/מסווגים|כמה נכנס/.test(el.textContent); }, null, { timeout: 10000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test('banks and cards can be chosen from the start, not only after the six steps: the card is above the steps, and the first step opens it', async () => {
  const db = withLoose(makeFakeDb());
  // Only the account made at sign-up, no card.
  db.tables.bank_accounts = [{ id: 'a0', household_id: 'h1', name: 'חשבון ראשי', balance: 0 }];
  db.tables.credit_cards = [];
  const { page, errors } = await open(db);
  const pic = page.locator('.pic-card');
  await pic.waitFor();
  assert.match(await pic.textContent(), /איפה הכסף שלכם/);
  const order = await page.evaluate(() => { const a = document.querySelector('.pic-card'); const b = document.querySelector('.setup-guide'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); });
  assert.ok(order, 'the banks and cards card comes before the steps');
  // The cards step opens the same picker.
  await page.locator('.setup-guide .guide-head', { hasText: 'כל כרטיסי האשראי' }).click();
  await page.click('.setup-guide button:has-text("לבחור את הכרטיסים")');
  await page.waitForSelector('.pic-picker');
  assert.deepEqual(errors, []);
  await page.close();
  // Before any statement: the first step chooses the banks and cards, then uploads.
  const db2 = withLoose(makeFakeDb());
  db2.tables.transactions = [];
  db2.tables.bank_accounts = [{ id: 'a0', household_id: 'h1', name: 'חשבון ראשי', balance: 0 }];
  db2.tables.credit_cards = [];
  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockSupabase(page2, db2);
  await signIn(page2, server.base);
  await page2.goto(server.base + '/app/#/home');
  await page2.click('.setup-guide button:has-text("לבחור בנק וכרטיסים ולהעלות")');
  await page2.waitForSelector('.pic-picker');
  await page2.close();
});

test('sorting everything without a category: a choice is saved at once, the advisor\'s suggestions with one tap, and leaving the sheet loses nothing', async () => {
  const db = withLoose(makeFakeDb());
  const { page, errors } = await open(db);
  const sent = [];
  await page.route('**/api/ai/import', (r) => {
    const body = JSON.parse(r.request().postData());
    sent.push(body);
    const transactions = String(body.text).split('\n').map((line) => { const [i, d] = line.split(' | '); return { i: Number(i), category_id: /משכנתא/.test(d) ? 'home' : null, subcategory_id: null }; });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions }) });
  });
  // From the notice for statements imported before the fix.
  const notice = page.locator('.import-notice');
  assert.match(await notice.textContent(), /סליחה/);
  assert.match(await notice.textContent(), /3 תנועות בלי קטגוריה/);
  await notice.locator('text=לסווג עכשיו').click();
  const sheet = page.locator('.sort-sheet');
  await sheet.waitFor();
  assert.equal(await sheet.locator('.sort-row').count(), 2, 'one line per merchant');
  await sheet.locator('text=שהיועץ יציע לכולם').click();
  await page.waitForSelector('text=היועץ הציע ל-1 בתי עסק');
  assert.equal(sent.length, 1);
  assert.equal(String(sent[0].text).split('\n').length, 2, 'each merchant once');
  // Chosen by hand: saved the moment it is chosen, before any "save".
  await sheet.locator('select[aria-label="קטגוריה לתרומה לעמותה"]').selectOption('home');
  for (let i = 0; i < 30 && db.tables.transactions.find((t) => t.id === 'l3').category_id !== 'home'; i++) await page.waitForTimeout(100);
  assert.equal(db.tables.transactions.find((t) => t.id === 'l3').category_id, 'home', 'saved at once');
  await sheet.locator('.sort-row.saved').first().waitFor();
  // The advisor's suggestion waits for one tap.
  await sheet.locator('text=לשמור את כל ההצעות (1)').click();
  await page.waitForSelector('text=סווגה תנועה אחת');
  assert.deepEqual(['l1', 'l2', 'l3'].map((id) => db.tables.transactions.find((t) => t.id === id).category_id), ['home', 'home', 'home']);
  await sheet.locator('text=סיימתי').click();
  // Seen once: the notice does not come back.
  await page.reload();
  await page.waitForSelector('.hero');
  assert.equal(await page.locator('.import-notice').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('sorting: investments and merchants chosen before come ready as suggestions, and one tap saves them all', async () => {
  const db = withLoose(makeFakeDb());
  const d = iso(new Date());
  db.tables.categories.push({ id: 'inv', name: 'השקעות', icon: null, kind: 'expense', parent_id: null, household_id: db.hid });
  // Made-up monthly investments, and a merchant the family sorted before.
  db.tables.transactions.push(
    { id: 'i1', household_id: 'h1', type: 'expense', amount: 500, description: 'פסגות ניירות ערך', tx_date: d, category_id: null, source: 'pdf', created_at: '2026-11-01T18:14:44Z' },
    { id: 'i2', household_id: 'h1', type: 'expense', amount: 700, description: 'הוראת קבע קרן נאמנות', tx_date: d, category_id: null, source: 'pdf', created_at: '2026-11-01T18:14:44Z' },
    { id: 'old', household_id: 'h1', type: 'expense', amount: 100, description: 'תרומה לעמותה', tx_date: '2026-01-05', category_id: 'home', source: 'pdf', created_at: '2026-01-05T18:14:44Z' }
  );
  const { page, errors } = await open(db);
  await page.locator('.import-notice').locator('text=לסווג עכשיו').click();
  const sheet = page.locator('.sort-sheet');
  await sheet.waitFor();
  await sheet.locator('.sort-ready').waitFor();
  assert.equal(await sheet.locator('select[aria-label="קטגוריה לפסגות ניירות ערך"]').inputValue(), 'inv');
  assert.equal(await sheet.locator('select[aria-label^="קטגוריה להוראת קבע קרן נאמנות"]').inputValue(), 'inv');
  assert.equal(await sheet.locator('select[aria-label="קטגוריה לתרומה לעמותה"]').inputValue(), 'home');
  // Nothing saved before the tap.
  assert.equal(db.tables.transactions.find((t) => t.id === 'i1').category_id, null);
  const save = sheet.locator('button:has-text("לשמור את כל ההצעות")');
  assert.match(await save.textContent(), /\((3|4)\)/);
  await save.click();
  await page.waitForSelector('.toast:has-text("סווגו")');
  assert.deepEqual(['i1', 'i2', 'l2', 'l3'].map((id) => db.tables.transactions.find((t) => t.id === id).category_id), ['inv', 'inv', 'home', 'home']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('sorting, as a friend did it: choices saved one by one, a break to add a category, and back: nothing lost; Bit payments one by one', async () => {
  const db = withLoose(makeFakeDb());
  const d = iso(new Date());
  // Made-up Bit payments: each is something else.
  for (let i = 0; i < 3; i++) db.tables.transactions.push({ id: 'bit' + i, household_id: 'h1', type: 'expense', amount: 40 + i * 10, description: 'BIT', tx_date: d, category_id: null, source: 'pdf', created_at: '2026-11-01T18:14:44Z' });
  const { page, errors } = await open(db);
  await page.locator('.import-notice').locator('text=לסווג עכשיו').click();
  const sheet = page.locator('.sort-sheet');
  await sheet.waitFor();
  // Two merchants and three Bit payments, each on its own line.
  assert.equal(await sheet.locator('.sort-row').count(), 5);
  assert.equal(await sheet.locator('.sort-row', { hasText: 'BIT' }).count(), 3);
  // One Bit payment sorted: only that one.
  await sheet.locator('.sort-row', { hasText: '₪60' }).locator('select').selectOption('food');
  await sheet.locator('.sort-row', { hasText: 'משכנתא' }).locator('select').selectOption('home');
  for (let i = 0; i < 30 && db.tables.transactions.find((t) => t.id === 'l1').category_id !== 'home'; i++) await page.waitForTimeout(100);
  assert.equal(db.tables.transactions.find((t) => t.id === 'bit2').category_id, 'food');
  assert.equal(db.tables.transactions.find((t) => t.id === 'bit0').category_id, null, 'the other Bit payments untouched');
  // A break (the sheet closed), then back: what was chosen is kept, the rest still waits.
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  await page.goto(page.url().split('#')[0] + '#/money');
  await page.waitForSelector('.tabs');
  assert.equal(db.tables.transactions.find((t) => t.id === 'l1').category_id, 'home');
  assert.equal(db.tables.transactions.find((t) => t.id === 'bit2').category_id, 'food');
  assert.deepEqual(errors, []);
  await page.close();
});
