import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// A conversation where the couple told the advisor about plans, an existing
// goal, and what the AI proposes from it (including things that must be dropped).
const PROPOSALS = [
  { kind: 'memory', text: 'לא נוגעים בקרן החירום', memKind: 'decision' },
  { kind: 'memory', text: 'לא לוקחים הלוואות לחופשות' },
  { kind: 'goal', name: 'חופשה ביוון', target_amount: 8000, target_date: '2027-07' },
  { kind: 'goal', name: 'קרן חירום', target_amount: 30000, saved_amount: 15000 },
  { kind: 'budget', category: 'רכב', amount: 700 },
  { kind: 'budget', category: 'חיות מחמד', amount: 300 },
  { kind: 'balance', balance: 9500 }
];

function setup(db) {
  db.tables.goals = [{ id: 'g1', household_id: 'h1', name: 'קרן חירום', target_amount: 30000, saved_amount: 12000, target_date: null, plan_items: [] }];
  db.tables.advisor_conversations = [{ id: 'c1', household_id: 'h1', user_id: 'u1', title: 'תכנון לשנה הבאה', messages: [], is_private: false, updated_at: '2026-09-03T10:00:00Z' }];
  db.tables.advisor_messages = [
    { id: 'm1', conversation_id: 'c1', household_id: 'h1', author_id: 'u1', role: 'user', text: 'החלטנו לנסוע ליוון ביולי, בערך 8,000. ויש לנו כבר 15,000 בקרן החירום', created_at: '2026-09-03T10:00:00Z' },
    { id: 'm2', conversation_id: 'c1', household_id: 'h1', author_id: 'u1', role: 'ai', text: 'נשמע מצוין.', created_at: '2026-09-03T10:00:05Z' }
  ];
  db.tables.advisor_memories = [{ id: 'mem1', household_id: 'h1', text: 'לא לוקחים הלוואות לחופשות', kind: 'decision', created_at: '2026-08-01' }];
  return db;
}

async function open({ proposals = PROPOSALS, learnStatus = 200, manual = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  if (manual) await page.addInitScript(() => localStorage.setItem('learn:manual', '1'));
  const db = setup(makeFakeDb());
  const errors = collectErrors(page);
  const sent = [];
  await mockSupabase(page, db);
  await page.route('**/api/ai/learn-from-chat', (r) => {
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: learnStatus, contentType: 'application/json', body: JSON.stringify(learnStatus === 200 ? { items: proposals } : { error: 'לא הצלחנו לקרוא את השיחה כרגע. נסו שוב בעוד דקה.' }) });
  });
  await page.route('**/api/ai/advice-chat-stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"delta":"רשמתי."}\n\ndata: {"done":true}\n\n' }));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  await page.click('.ask-fab');
  await page.locator('.adv .row', { hasText: 'תכנון לשנה הבאה' }).click();
  await page.waitForSelector('.adv-msg');
  return { page, db, errors, sent };
}

test('"what I learned": proposals are checked against the data, edited, and only the approved ones are saved where they belong', async () => {
  const { page, db, errors, sent } = await open();
  await page.click('button:has-text("מה למדתי")');
  await page.waitForSelector('.learn-item');
  // Sent: the conversation and the household's goals/categories, no transactions.
  assert.match(JSON.stringify(sent[0].messages), /יוון/);
  assert.equal(sent[0].context.goals[0].name, 'קרן חירום');
  assert.doesNotMatch(JSON.stringify(sent[0]), /שופרסל/);
  // The known memory and the unknown category are dropped; the existing goal is an update.
  const kinds = await page.locator('.learn-kind').allTextContents();
  assert.deepEqual(kinds.map((k) => k.trim()), ['🧠 לזכור', '🎯 יעד חדש', '🎯 עדכון יעד: קרן חירום', '📊 תקציב', '🏦 יתרה בבנק']);
  assert.match(await page.locator('.learn-item').nth(2).textContent(), /היום: ₪?12,000|היום: 12,000/);
  // Edit the new goal's amount, switch off the balance.
  const goal = page.locator('.learn-item').nth(1);
  await goal.locator('input[inputmode="numeric"]').first().fill('9000');
  await page.locator('.learn-item').nth(4).locator('input[type="checkbox"]').uncheck();
  assert.match(await page.locator('.learn-actions .btn').first().textContent(), /לעדכן \(4\)/);
  await page.click('.learn-actions .btn:has-text("לעדכן")');
  await page.waitForSelector('.learn-done');
  assert.match(await page.locator('.learn-done').textContent(), /עודכנו 4 דברים/);

  const greece = db.tables.goals.find((g) => g.name === 'חופשה ביוון');
  assert.equal(greece.target_amount, 9000);
  assert.equal(greece.target_date, '2027-07-01');
  assert.equal(greece.household_id, 'h1');
  assert.equal(db.tables.goals.find((g) => g.id === 'g1').saved_amount, 15000);
  assert.equal(db.tables.category_budgets.find((b) => b.category_id === 'car').monthly_amount, 700);
  assert.equal(db.tables.bank_accounts[0].balance, 12000, 'switched off, not saved');
  const mem = db.tables.advisor_memories.find((m) => m.text === 'לא נוגעים בקרן החירום');
  assert.equal(mem.source_conversation_id, 'c1');
  assert.equal(db.tables.advisor_memories.length, 2);
  await page.click('.learn-done button:has-text("חזרה לשיחה")');
  await page.waitForSelector('.adv-log');
  assert.deepEqual(errors, []);
  await page.close();
});

test('when there is nothing new, it says so; when the server fails, it can be retried', async () => {
  const a = await open({ proposals: [{ kind: 'memory', text: 'לא לוקחים הלוואות לחופשות' }] });
  await a.page.click('button:has-text("מה למדתי")');
  await a.page.waitForSelector('.learn-empty');
  await a.page.close();
  const b = await open({ learnStatus: 502 });
  await b.page.click('button:has-text("מה למדתי")');
  await b.page.waitForSelector('[role="alert"]:has-text("נסו שוב")');
  await b.page.click('button:has-text("לנסות שוב")');
  await b.page.waitForSelector('[role="alert"]');
  assert.equal(b.sent.length, 2);
  await b.page.close();
});

test('asking first (switched in the profile): after an amount it offers to save what it learned; "not now" hides it for those messages', async () => {
  const { page } = await open({ manual: true });
  await page.fill('[aria-label="שאלה ליועץ"]', 'המשכורת שלי עלתה ל-12,500');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.learn-offer');
  await page.click('.learn-offer button:has-text("לא עכשיו")');
  assert.equal(await page.locator('.learn-offer').count(), 0);
  await page.fill('[aria-label="שאלה ליועץ"]', 'תודה');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.adv-msg.ai:has-text("רשמתי.") >> nth=1');
  assert.equal(await page.locator('.learn-offer').count(), 0);
  // A new amount brings the offer back, and it opens the review.
  await page.fill('[aria-label="שאלה ליועץ"]', 'החלטנו לחסוך 1,000 בחודש');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.learn-offer');
  await page.click('.learn-offer button:has-text("לבדוק מה למדתי")');
  await page.waitForSelector('.learn-item');
  await page.close();
});

test('by default the advisor updates the data from the conversation by itself, says what changed, and each change can be undone', async () => {
  const { page, db, errors, sent } = await open();
  const carBefore = db.tables.category_budgets.find((b) => b.category_id === 'car').monthly_amount;
  await page.fill('[aria-label="שאלה ליועץ"]', 'החלטנו: רכב 700 בחודש, ויש לנו כבר 15,000 בקרן החירום');
  await page.click('.adv-compose button[type="submit"]');
  const note = page.locator('.learn-auto');
  await note.waitFor();
  const text = await note.textContent();
  assert.match(text, /עדכנתי לפי השיחה/);
  assert.match(text, /תקציב רכב: ₪700 \(היה ₪900\)/);
  assert.match(text, /יעד חדש: חופשה ביוון/);
  assert.match(text, /יעד קרן חירום: נחסך ₪15,000/);
  assert.match(text, /זוכר: לא נוגעים בקרן החירום/);
  assert.doesNotMatch(text, /חיות מחמד|לא לוקחים הלוואות/, 'unknown category and known memory are dropped');
  assert.equal(sent.length, 1);
  // Saved where they belong, without asking.
  assert.equal(db.tables.category_budgets.find((b) => b.category_id === 'car').monthly_amount, 700);
  assert.ok(db.tables.goals.some((g) => g.name === 'חופשה ביוון'));
  assert.equal(db.tables.goals.find((g) => g.id === 'g1').saved_amount, 15000);
  // Undo one: the budget goes back; the rest stays.
  await note.locator('.learn-auto-row', { hasText: 'תקציב רכב' }).locator('button:has-text("ביטול")').click();
  await note.locator('.learn-auto-row', { hasText: 'תקציב רכב' }).locator('text=בוטל').waitFor();
  assert.equal(db.tables.category_budgets.find((b) => b.category_id === 'car').monthly_amount, carBefore);
  await note.locator('.learn-auto-row', { hasText: 'יעד חדש' }).locator('button:has-text("ביטול")').click();
  await note.locator('.learn-auto-row', { hasText: 'יעד חדש' }).locator('text=בוטל').waitFor();
  assert.ok(!db.tables.goals.some((g) => g.name === 'חופשה ביוון'));
  assert.equal(db.tables.goals.find((g) => g.id === 'g1').saved_amount, 15000);
  assert.deepEqual(errors, []);
  await page.close();
});

test('"what the advisor knows about us": list, edit, delete and add memories', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = setup(makeFakeDb());
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  await page.click('.topbar .icon-btn');
  await page.click('button:has-text("מה היועץ יודע עלינו")');
  await page.waitForSelector('.mem-item');
  const input = page.locator('.mem-item input');
  assert.equal(await input.inputValue(), 'לא לוקחים הלוואות לחופשות');
  await input.fill('לא לוקחים הלוואות בכלל');
  await input.press('Enter');
  await page.waitForFunction(() => document.body.textContent.includes('עודכן'));
  assert.equal(db.tables.advisor_memories[0].text, 'לא לוקחים הלוואות בכלל');
  await page.fill('input[aria-label="דבר חדש שהיועץ יזכור"]', 'מפרישים מעשרות');
  await page.click('.memories button:has-text("להוסיף")');
  await page.waitForSelector('.mem-item >> nth=1');
  assert.ok(db.tables.advisor_memories.some((m) => m.text === 'מפרישים מעשרות' && m.household_id === 'h1' && m.created_by === 'u1'));
  await page.click('button[aria-label="למחוק: לא לוקחים הלוואות בכלל"]');
  await page.waitForFunction(() => document.querySelectorAll('.mem-item').length === 1);
  assert.equal(db.tables.advisor_memories.length, 1);
  await page.close();
});

test('asked to delete a wrong transaction: the advisor shows exactly which ones, and nothing is deleted until the person says yes', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = setup(makeFakeDb());
  const sonol = db.tables.transactions.filter((t) => t.description === 'סונול').sort((a, b) => (a.tx_date < b.tx_date ? 1 : -1))[0];
  const before = db.tables.transactions.length;
  await mockSupabase(page, db);
  await page.route('**/api/ai/learn-from-chat', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [
    { kind: 'tx_delete', match: 'סונול', amount: 280, date: sonol.tx_date, reason: 'נרשם בטעות' },
    { kind: 'tx_delete', match: 'בית עסק שלא קיים', amount: 999 }
  ] }) }));
  await page.route('**/api/ai/advice-chat-stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"delta":"אציג לך אותה למחיקה."}\n\ndata: {"done":true}\n\n' }));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.hero');
  await page.click('.ask-fab');
  await page.locator('.adv .row', { hasText: 'תכנון לשנה הבאה' }).click();
  await page.waitForSelector('.adv-msg');
  await page.fill('[aria-label="שאלה ליועץ"]', 'תמחק את הדלק של 280 מסונול, זה נרשם פעמיים');
  await page.click('.adv-compose button[type="submit"]');
  const card = page.locator('.learn-delete');
  await card.waitFor();
  assert.match(await card.textContent(), /למחוק את התנועות האלה\?/);
  assert.match(await card.textContent(), /סונול/);
  assert.equal(await card.locator('b.num').count(), 1, 'only the transaction that is really there, on that date');
  assert.equal(db.tables.transactions.length, before, 'nothing deleted before the yes');
  assert.equal(await page.locator('.learn-auto').count(), 0, 'not applied quietly');
  await card.locator('button:has-text("למחוק")').click();
  await card.locator('text=נמחק').first().waitFor();
  assert.equal(db.tables.transactions.length, before - 1);
  assert.ok(!db.tables.transactions.some((t) => t.id === sonol.id));
  await page.close();
});
