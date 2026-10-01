import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// Two old conversations: one with per-message rows, one from before that
// table (messages in a JSON column), opened by the partner.
function withConversations(db) {
  db.tables.memberships.push({ household_id: 'h1', user_id: 'u2', display_name: 'דני', role: 'member' });
  db.tables.advisor_conversations = [
    { id: 'c1', household_id: 'h1', user_id: 'u1', title: 'איפה לחסוך — 3.9', messages: [], is_private: false, updated_at: '2026-09-03T10:00:00Z' },
    { id: 'c2', household_id: 'h1', user_id: 'u2', title: 'שיחה ישנה על הרכב', messages: [{ role: 'user', text: 'כמה עולה לנו הרכב?' }, { role: 'ai', text: 'בערך 1,400 בחודש.' }], is_private: false, updated_at: '2026-08-01T10:00:00Z' }
  ];
  db.tables.advisor_messages = [
    { id: 'm1', conversation_id: 'c1', household_id: 'h1', author_id: 'u1', role: 'user', text: 'איפה אפשר לחסוך?', created_at: '2026-09-03T10:00:00Z' },
    { id: 'm2', conversation_id: 'c1', household_id: 'h1', author_id: 'u1', role: 'ai', text: 'באוכל בחוץ.\n@@הצעות: כמה?|ומה עוד?', created_at: '2026-09-03T10:00:05Z' }
  ];
  db.tables.advisor_memories = [{ household_id: 'h1', text: 'לא לוקחים הלוואות לחופשות', created_at: '2026-08-01' }];
  return db;
}

async function open({ width = 390, hash = '#/home', setup } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = withConversations(makeFakeDb());
  if (setup) setup(db);
  const calls = [];
  const errors = collectErrors(page);
  const asked = [];
  await mockSupabase(page, db, calls);
  await page.route('**/api/ai/advice-chat-stream', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    const body = ['כדאי ', 'לקצץ באוכל בחוץ ב-400 ש"ח.', '\n@@הצעות: איך מתחילים? | כמה זה בשנה?']
      .map((d) => 'data: ' + JSON.stringify({ delta: d }) + '\n\n').join('') + 'data: {"done":true}\n\n';
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  await page.waitForSelector(hash === '#/home' ? '.hero' : '.month-nav');
  return { page, db, calls, errors, asked };
}

test('recent conversations are all there, including old-format ones, and nothing is deleted', async () => {
  const { page, db, calls, errors } = await open();
  await page.click('.ask-fab');
  await page.waitForSelector('.adv .row');
  const titles = await page.locator('.adv .row').allTextContents();
  assert.match(titles[0], /איפה לחסוך/);
  assert.match(titles[1], /שיחה ישנה על הרכב/);
  assert.match(titles[1], /של דני/);
  await page.locator('.adv .row', { hasText: 'שיחה ישנה על הרכב' }).click();
  await page.waitForSelector('.adv-msg');
  const msgs = await page.locator('.adv-msg').allTextContents();
  assert.equal(msgs.length, 2);
  // The partner's message carries their name.
  assert.match(msgs[0], /^דני.*כמה עולה לנו הרכב\?/);
  assert.match(msgs[1], /בערך 1,400 בחודש\./);
  assert.equal(calls.filter((c) => c.method === 'DELETE' && /advisor/.test(c.table)).length, 0);
  assert.equal(db.tables.advisor_conversations.length, 2);
  assert.equal(db.tables.advisor_messages.length, 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('continuing an old conversation: the answer streams, both turns are saved, follow-ups appear', async () => {
  const { page, db, asked } = await open();
  await page.click('.ask-fab');
  await page.locator('.adv .row', { hasText: 'איפה לחסוך' }).click();
  await page.waitForSelector('.adv-msg');
  assert.match(await page.locator('.adv-log').textContent(), /באוכל בחוץ\./);
  assert.doesNotMatch(await page.locator('.adv-log').textContent(), /@@/);
  await page.fill('input[aria-label="שאלה ליועץ"]', 'ובכמה בדיוק?');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.adv .chip:has-text("איך מתחילים?")');
  assert.match(await page.locator('.adv-msg.ai').last().textContent(), /כדאי לקצץ באוכל בחוץ ב-400 ש"ח\./);
  const added = db.tables.advisor_messages.filter((m) => m.conversation_id === 'c1').slice(2);
  assert.deepEqual(added.map((m) => [m.role, m.author_id]), [['user', 'u1'], ['ai', 'u1']]);
  assert.equal(added[0].text, 'ובכמה בדיוק?');
  // What the server got: history, the screen, decisions; no merchant names.
  const p = asked[0];
  assert.equal(p.message, 'ובכמה בדיוק?');
  assert.equal(p.history.length, 2);
  assert.equal(p.summary.screen, 'home');
  assert.deepEqual(p.summary.memories, ['לא לוקחים הלוואות לחופשות']);
  assert.doesNotMatch(JSON.stringify(p.summary), /שופרסל|ארומה|description/);
  await page.close();
});

test('a new conversation from a suggested question is saved with a title, on the screen it was asked from', async () => {
  const { page, db, asked } = await open({ hash: '#/money' });
  await page.click('.ask-fab');
  await page.click('.adv .chip:has-text("איפה אפשר לקצץ החודש?")');
  await page.waitForSelector('.adv-msg.ai:has-text("כדאי")');
  const conv = db.tables.advisor_conversations.find((c) => /איפה אפשר לקצץ החודש\?/.test(c.title));
  assert.ok(conv, 'conversation created');
  assert.equal(conv.user_id, 'u1');
  assert.equal(conv.is_private, false);
  assert.equal(db.tables.advisor_messages.filter((m) => m.conversation_id === conv.id).length, 2);
  assert.equal(asked[0].summary.screen, 'money');
  await page.close();
});

test('with the advisor off nothing is sent, and old conversations can still be read', async () => {
  const { page, asked } = await open();
  await page.click('.topbar .icon-btn');
  await page.locator('input[aria-label="היועץ והצעות AI"]').uncheck();
  await page.keyboard.press('Escape');
  await page.click('.ask-fab');
  await page.waitForSelector('.adv-off');
  assert.equal(await page.locator('input[aria-label="שאלה ליועץ"]').count(), 0);
  await page.locator('.adv .row', { hasText: 'איפה לחסוך' }).click();
  await page.waitForSelector('.adv-msg');
  assert.equal(await page.locator('input[aria-label="שאלה ליועץ"]').count(), 0);
  assert.equal(asked.length, 0);
  await page.click('text=להפעיל את היועץ');
  await page.waitForSelector('input[aria-label="שאלה ליועץ"]');
  await page.close();
});

test('desktop: the advisor sits in the side rail', async () => {
  const { page, errors } = await open({ width: 1280 });
  await page.waitForSelector('.rail .adv .row');
  assert.equal(await page.locator('.adv').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('while the advisor thinks, an animated indicator shows; it gives way to the answer', async () => {
  const { page } = await open();
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/ai/advice-chat-stream', async (r) => {
    await gate;
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"delta":"תשובה קצרה."}\n\ndata: {"done":true}\n\n' });
  });
  await page.click('.ask-fab');
  await page.fill('input[aria-label="שאלה ליועץ"]', 'מה המצב?');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.adv-msg.ai .adv-thinking .dots i');
  assert.match(await page.locator('.adv-thinking').textContent(), /היועץ חושב/);
  assert.equal(await page.locator('.adv-compose .spinner').count(), 1);
  release();
  await page.waitForSelector('.adv-msg.ai:has-text("תשובה קצרה.")');
  assert.equal(await page.locator('.adv-thinking').count(), 0);
  assert.equal(await page.locator('.adv-compose .spinner').count(), 0);
  await page.close();
});

test('when the AI fails, a clear message shows and the question is not lost from the log', async () => {
  const { page } = await open();
  await page.route('**/api/ai/advice-chat-stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ error: 'היועץ לא הצליח לענות כרגע. נסו שוב בעוד דקה.' }) + '\n\n' }));
  await page.click('.ask-fab');
  await page.fill('input[aria-label="שאלה ליועץ"]', 'מה המצב?');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.adv-err');
  assert.match(await page.locator('.adv-err').textContent(), /נסו שוב/);
  assert.equal(await page.locator('.adv-thinking').count(), 0);
  assert.match(await page.locator('.adv-log').textContent(), /מה המצב\?/);
  await page.close();
});
