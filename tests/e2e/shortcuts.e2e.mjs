import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

// Home-screen shortcuts open the app straight into the action:
// /app/?action=add | voice | ask | talk.
let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// Speech in and out, as the phone would: each listening session "hears" the
// next phrase in window.__queue (nothing once it is empty), and speaking
// records what was said aloud.
const FAKE_VOICE = () => {
  window.__queue = window.__queue || [];
  window.__said = [];
  window.__starts = 0;
  class FakeSR {
    start() {
      window.__starts++;
      if (window.__hold) return; // listening, nothing said yet
      const phrase = window.__queue.shift();
      setTimeout(() => {
        if (phrase) {
          const r = [{ transcript: phrase }]; r.isFinal = true;
          this.onresult && this.onresult({ resultIndex: 0, results: [r] });
        }
        setTimeout(() => this.onend && this.onend(), 60);
      }, 80);
    }
    stop() { setTimeout(() => this.onend && this.onend(), 10); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(u) { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 60); },
    cancel() {}, getVoices() { return []; }
  } });
};

async function open(action, { queue = [] } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(FAKE_VOICE);
  await page.addInitScript((q) => { window.__queue = q; }, queue);
  const db = makeFakeDb();
  const errors = collectErrors(page);
  const asked = [];
  await mockSupabase(page, db);
  await page.route('**/api/ai/advice-chat-stream', (r) => {
    const q = JSON.parse(r.request().postData());
    asked.push(q);
    const body = 'data: ' + JSON.stringify({ delta: 'תשובה ' + asked.length + ': ' + q.message }) + '\n\ndata: {"done":true}\n\n';
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/?action=' + action + '#/home');
  return { page, db, errors, asked };
}

test('"add an expense": the add sheet opens, and the address loses the parameter', async () => {
  const { page, errors } = await open('add');
  await page.waitForSelector('.sheet input.input');
  assert.doesNotMatch(page.url(), /action=/);
  assert.match(page.url(), /#\/home$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('"add by voice": the add sheet opens already listening', async () => {
  const { page } = await open('voice', { queue: ['קפה 18'] });
  await page.waitForSelector('.sheet');
  await page.waitForFunction(() => window.__starts > 0);
  await page.close();
});

test('"ask the advisor": the advisor opens, with the mic and the voice conversation', async () => {
  const { page } = await open('ask');
  await page.waitForSelector('.sheet .adv input[aria-label="שאלה ליועץ"]');
  assert.equal(await page.locator('.sheet .adv-mic').count(), 1);
  assert.equal(await page.locator('.sheet .adv-talk').count(), 1);
  await page.close();
});

test('"talk with the advisor": it listens, answers aloud, listens again, and stops after silence', async () => {
  const { page, asked, db } = await open('talk', { queue: ['כמה נשאר לי החודש?', 'ואיפה הכי הרבה?'] });
  await page.waitForSelector('.sheet .talk-bar');
  await page.waitForFunction(() => window.__said.length >= 2, null, { timeout: 8000 });
  assert.deepEqual(asked.map((q) => q.message), ['כמה נשאר לי החודש?', 'ואיפה הכי הרבה?']);
  const said = await page.evaluate(() => window.__said);
  assert.match(said[0], /תשובה 1: כמה נשאר לי החודש\?/);
  assert.match(said[1], /תשובה 2/);
  // One conversation, both turns in it, saved like any other.
  const convs = db.tables.advisor_conversations || [];
  assert.equal(convs.length, 1);
  // Three silent rounds: the conversation ends by itself.
  await page.waitForFunction(() => !document.querySelector('.talk-bar'), null, { timeout: 8000 });
  assert.equal(await page.locator('.sheet .adv-msg.ai').count(), 2);
  await page.close();
});

test('the voice conversation can be ended by hand', async () => {
  const { page } = await open('talk', { queue: [] });
  await page.evaluate(() => { window.__hold = true; });
  await page.waitForSelector('.sheet .talk-bar.listening');
  await page.click('.talk-end');
  await page.waitForFunction(() => !document.querySelector('.talk-bar'));
  await page.close();
});
