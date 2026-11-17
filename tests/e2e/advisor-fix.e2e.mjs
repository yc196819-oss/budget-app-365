import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const TODAY = new Date(2026, 10, 17, 10);

// The advisor (made up): proposes moving the first two transactions it was
// sent to another category, or turning one into income.
async function open(answer) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  const db = makeFakeDb(TODAY);
  db.tables.categories.push({ id: 'grant', name: 'מלגה', kind: 'income', parent_id: 'sal', household_id: db.hid });
  db.tables.category_rules = [];
  db.tables.transactions.push({ id: 'g1', household_id: db.hid, type: 'expense', amount: 1000, description: 'מוסד לימודים בדוי', tx_date: '2026-11-10', category_id: 'home', source: 'import' });
  const errors = collectErrors(page);
  const asked = [];
  await mockSupabase(page, db);
  await page.route('**/api/ai/advice-chat-stream', (r) => {
    const p = JSON.parse(r.request().postData());
    asked.push(p);
    const text = answer(p);
    const body = text.match(/[\s\S]{1,40}/g).map((d) => 'data: ' + JSON.stringify({ delta: d }) + '\n\n').join('') + 'data: {"done":true}\n\n';
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  await page.click('.ask-fab');
  return { page, db, errors, asked };
}
const ask = async (page, text) => {
  await page.fill('[aria-label="שאלה ליועץ"]', text);
  await page.click('.adv-compose button[type="submit"]');
};

test('the advisor proposes moving a business to another category: nothing changes until "כן", then undo puts it back, and it can become a rule', async () => {
  const { page, db, errors, asked } = await open((p) => {
    const ids = (p.candidates || []).slice(0, 2).map((c) => c.id);
    return 'מצאתי את התנועות של ארומה. אני מציע להעביר אותן לסופר.\n@@שינויים:' + JSON.stringify({ ops: ids.map((id) => ({ op: 'update', id, set: { category: 'אוכל', subcategory: 'סופר' } })) }) + '\n@@הצעות: עוד משהו?';
  });
  await ask(page, 'ארומה זה בעצם סופר, תעביר את זה');
  await page.waitForSelector('.fix-card');
  // Sent with the question: only the business's transactions, and the category names.
  assert.ok(asked[0].candidates.length > 0 && asked[0].candidates.every((c) => /ארומה/.test(c.description)));
  assert.ok(asked[0].categories.some((c) => c.name === 'סופר' && c.parent === 'אוכל'));
  const card = page.locator('.fix-card');
  assert.match(await card.textContent(), /היועץ מציע לשנות 2 תנועות/);
  assert.match(await card.textContent(), /אוכל · מסעדות ואוכל בחוץ.*אוכל · סופר/);
  assert.doesNotMatch(await page.locator('.adv-msg.ai').last().textContent(), /@@|ops/);
  const ids = asked[0].candidates.slice(0, 2).map((c) => c.id);
  assert.ok(ids.every((id) => db.tables.transactions.find((t) => t.id === id).subcategory_id === 'cafe'), 'nothing changed yet');
  await card.locator('text=כן, לשנות').click();
  await page.waitForSelector('.fix-ok');
  for (let i = 0; i < 30 && !ids.every((id) => db.tables.transactions.find((t) => t.id === id).subcategory_id === 'super'); i++) await page.waitForTimeout(100);
  assert.ok(ids.every((id) => db.tables.transactions.find((t) => t.id === id).subcategory_id === 'super'));
  // One business to one category: kept as a rule on "כן, תמיד".
  await card.locator('text=כן, תמיד').click();
  await page.waitForSelector('text=מעכשיו זה יסווג לבד');
  assert.equal(db.tables.category_rules.length, 1);
  assert.equal(db.tables.category_rules[0].subcategory_id, 'super');
  // Undo: back as it was.
  await card.locator('.fix-ok .btn-text').first().click();
  await page.waitForSelector('text=השינוי בוטל');
  for (let i = 0; i < 30 && !ids.every((id) => db.tables.transactions.find((t) => t.id === id).subcategory_id === 'cafe'); i++) await page.waitForTimeout(100);
  assert.ok(ids.every((id) => db.tables.transactions.find((t) => t.id === id).subcategory_id === 'cafe'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('an expense that is really income: the card shows it, "כן" makes it income in an income category; "לא" changes nothing', async () => {
  const { page, db, errors } = await open((p) => {
    const c = (p.candidates || []).find((x) => /מוסד/.test(x.description));
    return 'זו תנועה של 1,000 ש"ח מ-10.11. אפשר להעביר אותה להכנסה.\n@@שינויים:' + JSON.stringify({ ops: !c ? [] : c.type === 'income' ? [{ op: 'update', id: c.id, set: { amount: 900 } }] : [{ op: 'update', id: c.id, set: { type: 'income', category: 'משכורת', subcategory: 'מלגה' } }, { op: 'delete', id: c.id }] });
  });
  await ask(page, 'מוסד לימודים בדוי זה לא הוצאה, זו מלגה שנכנסת אליי');
  await page.waitForSelector('.fix-card');
  const card = page.locator('.fix-card');
  assert.match(await card.textContent(), /היועץ מציע לשנות תנועה אחת/);
  assert.match(await card.textContent(), /הוצאה · בית ודיור.*הכנסה · משכורת · מלגה/);
  await card.locator('text=כן, לשנות').click();
  await page.waitForSelector('.fix-ok');
  for (let i = 0; i < 30 && db.tables.transactions.find((t) => t.id === 'g1').type !== 'income'; i++) await page.waitForTimeout(100);
  const g = db.tables.transactions.find((t) => t.id === 'g1');
  assert.deepEqual([g.type, g.category_id, g.subcategory_id], ['income', 'sal', 'grant'], 'and never deleted');
  // A second proposal, refused.
  await ask(page, 'תעביר שוב את מוסד לימודים בדוי');
  await page.waitForFunction(() => document.querySelectorAll('.fix-card').length === 2);
  await page.locator('.fix-card').last().locator('.fix-acts .btn-ghost').click();
  await page.waitForSelector('text=בסדר, לא שיניתי כלום');
  assert.equal(db.tables.transactions.find((t) => t.id === 'g1').amount, 1000);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a question about money sends no transactions and shows no card', async () => {
  const { page, asked } = await open(() => 'כדאי לחסוך באוכל בחוץ.');
  await ask(page, 'איך אני חוסך יותר?');
  await page.waitForFunction(() => document.querySelectorAll('.adv-msg.ai').length && !document.querySelector('.adv-msg.ai.pending'));
  await page.waitForTimeout(300);
  assert.equal(asked[0].candidates, undefined);
  assert.equal(await page.locator('.fix-card').count(), 0);
  await page.close();
});
