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

test('adding an expense by voice: the words become amount and description, then it is saved', async () => {
  const { page, db, errors } = await openAdd();
  await page.evaluate(() => { window.__say = 'שילמתי שמונים שקל בסופר'; });
  await page.click('button[aria-label="להוסיף בקול"]');
  await page.waitForSelector('.add-mic.on');
  await page.waitForFunction(() => document.querySelector('.sheet input.input').value === '80 סופר');
  assert.equal(await page.locator('.add-mic.on').count(), 0, 'stops listening by itself');
  await page.click('.sheet button.btn:has-text("להוסיף")');
  await page.waitForSelector('.toast');
  const t = added(db);
  assert.deepEqual([t.type, t.amount, t.description], ['expense', 80, 'סופר']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('saying "קיבלתי…" adds an income', async () => {
  const { page, db } = await openAdd();
  await page.evaluate(() => { window.__say = 'קיבלתי משכורת 21 אלף'; });
  await page.click('button[aria-label="להוסיף בקול"]');
  await page.waitForFunction(() => document.querySelector('.sheet input.input').value === '21000 משכורת');
  assert.match(await page.locator('.sheet h2').textContent(), /הוספת הכנסה/);
  assert.equal(await page.locator('.sheet .seg button[aria-pressed="true"]').textContent(), 'הכנסה');
  await page.click('.sheet button.btn:has-text("להוסיף")');
  await page.waitForSelector('.toast');
  const t = added(db);
  assert.deepEqual([t.type, t.amount, t.description], ['income', 21000, 'משכורת']);
  await page.close();
});

test('no microphone permission: a clear message, and typing still works', async () => {
  const { page } = await openAdd();
  await page.evaluate(() => { window.__say = '__deny'; });
  await page.click('button[aria-label="להוסיף בקול"]');
  await page.waitForSelector('.sheet [role="alert"]:has-text("לאשר גישה למיקרופון")');
  await page.close();
});

test('keyboard dictation (no speech API): spoken text in the box is understood, income included', async () => {
  const { page, db } = await openAdd({ speech: false });
  assert.equal(await page.locator('button[aria-label="להוסיף בקול"]').count(), 0);
  assert.match(await page.locator('.sheet').textContent(), /המיקרופון שבמקלדת/);
  await page.fill('.sheet input.input', 'נכנס החזר מביטוח לאומי חמש מאות שקל');
  await page.press('.sheet input.input', 'Enter');
  await page.waitForSelector('.toast');
  const t = added(db);
  assert.deepEqual([t.type, t.amount, t.description], ['income', 500, 'החזר מביטוח לאומי']);
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
