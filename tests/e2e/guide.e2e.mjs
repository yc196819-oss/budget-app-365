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
  await page.waitForSelector('.setup-guide');
  assert.doesNotMatch(await page.locator('.setup-guide .guide-step.open').textContent(), /מסווגים|כמה נכנס/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('sorting everything without a category: the advisor suggests per merchant, one save sorts every line, undo restores', async () => {
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
  await sheet.locator('select[aria-label="קטגוריה לתרומה לעמותה"]').selectOption('home');
  await sheet.locator('text=לשמור 2 בתי עסק').click();
  await page.waitForSelector('text=סווגו 3 תנועות');
  assert.deepEqual(['l1', 'l2', 'l3'].map((id) => db.tables.transactions.find((t) => t.id === id).category_id), ['home', 'home', 'home']);
  // Seen once: the notice does not come back.
  await page.reload();
  await page.waitForSelector('.hero');
  assert.equal(await page.locator('.import-notice').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});
