import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// A stand-in for the browser's speech recognition: it "hears" whatever the
// test puts in window.__say, first as interim words, then as the final text.
const FAKE_SPEECH = () => {
  class FakeSR {
    start() {
      window.__started = (window.__started || 0) + 1;
      const said = window.__say;
      setTimeout(() => {
        if (said === '__deny') { this.onerror && this.onerror({ error: 'not-allowed' }); this.onend && this.onend(); return; }
        const r = (t, isFinal) => { const x = [{ transcript: t }]; x.isFinal = isFinal; return x; };
        this.onresult && this.onresult({ resultIndex: 0, results: [r(said.split(' ')[0], false)] });
        setTimeout(() => { this.onresult && this.onresult({ resultIndex: 0, results: [r(said, true)] }); this.onend && this.onend(); }, 150);
      }, 100);
    }
    stop() { this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
};
const NO_SPEECH = () => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; };

async function openAdd({ speech = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(speech ? FAKE_SPEECH : NO_SPEECH);
  const db = makeFakeDb();
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/money');
  await page.waitForSelector('.month-nav');
  await page.click('.nav-add');
  await page.waitForSelector('.sheet input.input');
  return { page, db, errors };
}
const added = (db) => db.tables.transactions.find((t) => String(t.id).startsWith('new'));
const addedAll = (db) => db.tables.transactions.filter((t) => String(t.id).startsWith('new'));
const say = async (page, text) => {
  await page.evaluate((t) => { window.__say = t; }, text);
  await page.click('button[aria-label="להוסיף בקול"]');
};

test('after recording, the card is shown to check, edit, and confirm', async () => {
  const { page, db, errors } = await openAdd();
  await say(page, 'שילמתי שמונים שקל בסופר');
  await page.waitForSelector('.review-item');
  assert.match(await page.locator('.sheet h2').textContent(), /בדיקה לפני הוספה/);
  const card = page.locator('.review-item').first();
  assert.equal(await card.locator('input.input').first().inputValue(), 'סופר');
  assert.equal(await card.locator('input[inputmode="decimal"]').inputValue(), '80');
  assert.equal(await card.locator('.seg button[aria-pressed="true"]').textContent(), 'הוצאה');
  assert.equal(addedAll(db).length, 0, 'nothing saved before confirming');
  await card.locator('input[inputmode="decimal"]').fill('85');
  await page.click('.review-actions .btn:has-text("להוסיף")');
  await page.waitForSelector('.toast');
  const t = added(db);
  assert.deepEqual([t.type, t.amount, t.description], ['expense', 85, 'סופר']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('cancel after recording saves nothing', async () => {
  const { page, db } = await openAdd();
  await say(page, 'שילמתי שמונים שקל בסופר');
  await page.waitForSelector('.review-item');
  await page.click('.review-actions .btn:has-text("ביטול")');
  await page.waitForSelector('.sheet input.input');
  assert.equal(addedAll(db).length, 0);
  await page.close();
});

test('saying "קיבלתי…" adds an income', async () => {
  const { page, db } = await openAdd();
  await say(page, 'קיבלתי משכורת 21 אלף');
  await page.waitForSelector('.review-item.income');
  await page.click('.review-actions .btn:has-text("להוסיף")');
  await page.waitForSelector('.toast');
  const t = added(db);
  assert.deepEqual([t.type, t.amount, t.description], ['income', 21000, 'משכורת']);
  await page.close();
});

test('one long recording with several transactions: split into cards, each editable or removable', async () => {
  const { page, db } = await openAdd();
  await say(page, 'אתמול שילמתי 80 שקל בסופר ו-46 על קפה, וקיבלתי משכורת 21 אלף. ו-200 דלק');
  await page.waitForSelector('.review-item >> nth=3');
  assert.match(await page.locator('.review').textContent(), /שמעתי 4 תנועות/);
  const descs = await page.locator('.review-item').evaluateAll((els) => els.map((e) => e.querySelector('input.input').value));
  assert.deepEqual(descs, ['סופר', 'קפה', 'משכורת', 'דלק']);
  // The category of a known merchant is guessed ("ארומה" history is cafe); remove the fuel line.
  await page.click('button[aria-label="להסיר: דלק"]');
  await page.locator('.review-item').nth(1).locator('input.input').first().fill('קפה בארומה');
  await page.click('.review-actions .btn:has-text("להוסיף 3 תנועות")');
  await page.waitForSelector('.toast:has-text("נוספו 3 תנועות")');
  const rows = addedAll(db).map((t) => [t.type, t.amount, t.description]);
  assert.deepEqual(rows.sort((a, b) => a[1] - b[1]), [['expense', 46, 'קפה בארומה'], ['expense', 80, 'סופר'], ['income', 21000, 'משכורת']]);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  assert.ok(addedAll(db).every((t) => t.tx_date === yIso), '"אתמול" applies to all');
  await page.close();
});

test('record more: a second recording adds cards to the same review', async () => {
  const { page, db } = await openAdd();
  await say(page, 'שילמתי 80 שקל בסופר');
  await page.waitForSelector('.review-item');
  await page.evaluate(() => { window.__say = '46 קפה'; });
  await page.click('.review-actions button:has-text("להקליט עוד")');
  await page.waitForSelector('.review-item >> nth=1');
  await page.click('.review-actions .btn:has-text("להוסיף 2 תנועות")');
  await page.waitForSelector('.toast');
  assert.equal(addedAll(db).length, 2);
  await page.close();
});

test('no microphone permission: a clear message, and typing still works', async () => {
  const { page } = await openAdd();
  await say(page, '__deny');
  await page.waitForSelector('.sheet [role="alert"]:has-text("לאשר גישה למיקרופון")');
  await page.close();
});

test('keyboard dictation (no speech API): spoken text is understood, several at once too', async () => {
  const { page, db } = await openAdd({ speech: false });
  assert.equal(await page.locator('button[aria-label="להוסיף בקול"]').count(), 0);
  assert.match(await page.locator('.sheet').textContent(), /המיקרופון שבמקלדת/);
  await page.fill('.sheet input.input', 'נכנס החזר מביטוח לאומי חמש מאות שקל');
  await page.press('.sheet input.input', 'Enter');
  await page.waitForSelector('.toast');
  assert.deepEqual([added(db).type, added(db).amount, added(db).description], ['income', 500, 'החזר מביטוח לאומי']);
  await page.click('.nav-add');
  await page.fill('.sheet input.input', 'סופר 80, קפה 46');
  await page.click('.sheet button:has-text("לבדוק ולהוסיף")');
  await page.waitForSelector('.review-item >> nth=1');
  await page.click('.review-actions .btn:has-text("להוסיף 2 תנועות")');
  await page.waitForSelector('.toast:has-text("נוספו 2 תנועות")');
  assert.equal(addedAll(db).length, 3);
  await page.close();
});

test('choosing expense by hand wins over a word that sounds like income', async () => {
  const { page, db } = await openAdd({ speech: false });
  await page.fill('.sheet input.input', 'החזר הלוואה 500');
  assert.match(await page.locator('.sheet h2').textContent(), /הוספת הכנסה/);
  await page.click('.sheet .seg button:has-text("הוצאה")');
  await page.press('.sheet input.input', 'Enter');
  await page.waitForSelector('.toast');
  assert.equal(added(db).type, 'expense');
  await page.close();
});
