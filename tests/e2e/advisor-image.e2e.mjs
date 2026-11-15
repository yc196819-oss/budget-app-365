import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// The app's own mailbox (the owner): pictures to the advisor are his for now.
const OWNER = 'budgetapp2852@gmail.com';
// A small made-up PNG (a gray square), as a phone photo would arrive.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNgGAWjYBSMglEwCkYBAQAEEAABhc0BmQAAAABJRU5ErkJggg==', 'base64');

async function open({ email = OWNER, width = 390 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = makeFakeDb();
  const errors = collectErrors(page);
  const asked = [];
  await mockSupabase(page, db);
  await page.route('**/api/ai/advice-chat-stream', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    const body = ['בקבלה: 248 ש"ח בסופר, 12.11.', '\n@@הצעות: לרשום את זה?'].map((d) => 'data: ' + JSON.stringify({ delta: d }) + '\n\n').join('') + 'data: {"done":true}\n\n';
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await signIn(page, server.base);
  if (email) await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, email);
  await page.goto(server.base + '/app/#/home');
  await page.reload();
  await page.waitForSelector('.hero');
  return { page, db, asked, errors };
}

test('the owner attaches a picture: the privacy note once, a preview, sent with the question, only a line is saved', async () => {
  const { page, db, asked, errors } = await open();
  await page.click('.ask-fab');
  await page.waitForSelector('.adv-attach');
  await page.setInputFiles('.adv-compose input[type="file"]', { name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.adv-pic img');
  assert.match(await page.locator('.adv-pic').textContent(), /התמונה לא נשמרת/);
  assert.match(await page.locator('.adv-pic-note').textContent(), /התמונות לא נשמרות\..*לא נשמרת אצלנו/);
  // Sending needs no words: a picture alone is a question.
  assert.equal(await page.locator('.adv-compose button[type="submit"]').isDisabled(), false);
  await page.click('.adv-pic-note .btn-text');
  assert.equal(await page.locator('.adv-pic-note').count(), 0);
  await page.fill('[aria-label="שאלה ליועץ"]', 'כמה שילמתי?');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.adv-msg.ai:has-text("248")');
  assert.equal(asked.length, 1);
  assert.match(asked[0].image, /^data:image\/jpeg;base64,/);
  assert.equal(asked[0].message, 'כמה שילמתי?');
  // The conversation keeps the line and the answer, never the picture.
  const saved = db.tables.advisor_messages.filter((m) => m.role === 'user');
  assert.deepEqual(saved.map((m) => m.text), ['צירפתי תמונה · כמה שילמתי?']);
  assert.ok(!JSON.stringify(db.tables).includes('base64'));
  // On screen (this visit only) the picture shows in the bubble; the box is empty again.
  assert.equal(await page.locator('.adv-msg.me .adv-thumb').count(), 1);
  assert.equal(await page.locator('.adv-pic').count(), 0);
  // The note was seen: the next picture comes without it.
  await page.setInputFiles('.adv-compose input[type="file"]', { name: 'b.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.adv-pic img');
  assert.equal(await page.locator('.adv-pic-note').count(), 0);
  await page.click('[aria-label="להסיר את התמונה"]');
  assert.equal(await page.locator('.adv-pic').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('everyone else: no attach button yet, and a picture pasted is not attached', async () => {
  const { page, errors } = await open({ email: null });
  await page.click('.ask-fab');
  await page.waitForSelector('[aria-label="שאלה ליועץ"]');
  assert.equal(await page.locator('.adv-attach').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

// What the service worker keeps when a picture is shared to the app.
async function sharePicture(page) {
  await page.evaluate(async (data) => {
    const c = await caches.open('shared-files');
    await c.put('/shared/0', new Response(new Uint8Array(data), { headers: { 'content-type': 'image/png', 'x-name': 'receipt.png', 'x-at': String(Date.now()) } }));
  }, [...PNG]);
  await page.goto(server.base + '/app/?action=shared');
}

test('a picture shared from the phone (owner): asked what it is for; "ask the advisor" opens it with the picture attached', async () => {
  const { page, errors } = await open();
  await sharePicture(page);
  await page.waitForSelector('.share-choose');
  assert.match(await page.locator('.share-choose').textContent(), /פירוט חשבון להעלאה.*לשאול את היועץ.*התמונה לא נשמרת/);
  await page.locator('.share-opt', { hasText: 'לשאול את היועץ' }).click();
  await page.waitForSelector('.adv-pic img');
  assert.equal(await page.evaluate(async () => (await caches.keys()).includes('shared-files') ? (await (await caches.open('shared-files')).keys()).length : 0), 0, 'nothing left on the device');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a picture shared (owner) can still be a statement: on to "which account or card"', async () => {
  const { page } = await open();
  await sharePicture(page);
  await page.waitForSelector('.share-choose');
  await page.locator('.share-opt', { hasText: 'פירוט חשבון להעלאה' }).click();
  await page.waitForSelector('.share-q');
  await page.close();
});

test('everyone else: a shared picture goes straight to "which account or card", as before', async () => {
  const { page } = await open({ email: null });
  await sharePicture(page);
  await page.waitForSelector('.share-q');
  assert.equal(await page.locator('.share-choose').count(), 0);
  await page.close();
});

test('a refused or failed send keeps the picture in the box, to try again', async () => {
  const { page } = await open();
  await page.unroute('**/api/ai/advice-chat-stream');
  await page.route('**/api/ai/advice-chat-stream', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'צירוף תמונה עוד לא זמין.' }) }));
  await page.click('.ask-fab');
  await page.setInputFiles('.adv-compose input[type="file"]', { name: 'r.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.adv-pic img');
  await page.click('.adv-compose button[type="submit"]');
  await page.waitForSelector('.adv-err');
  assert.equal(await page.locator('.adv-pic img').count(), 1);
  await page.close();
});
