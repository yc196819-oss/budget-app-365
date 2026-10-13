import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const DIGEST = () => ({ day: today(), pulse: [{ label: 'ריבית בנק ישראל', value: '3.25%', note: 'פריים 4.75%' }], items: [
  { title: 'הריבית נשארה 3.25%', summary: 'בנק ישראל לא שינה את הריבית.', families: 'מי שיש לו הלוואה בפריים לא ירגיש שינוי החודש.', topic: 'rate', source: { name: 'גלובס', link: 'https://www.globes.co.il/a1' }, question: 'מה עם המשכנתא?', answer: 'ההחזר לא משתנה החודש.' },
  { title: 'מחירי המזון עלו', summary: 'הסל התייקר.', families: 'כדאי להשוות בין רשתות.', topic: 'prices', source: { name: 'ynet כלכלה', link: 'https://www.ynet.co.il/b' }, question: '', answer: '' },
  { title: 'מס חדש נבחן', summary: 'האוצר בוחן שינוי.', families: 'עוד לא הוחלט דבר.', topic: 'tax', source: { name: 'כלכליסט', link: 'https://www.calcalist.co.il/c' }, question: '', answer: '' }
], term: { name: 'ריבית פריים', explain: 'ריבית בנק ישראל ועוד 1.5%.', quiz: { q: 'הריבית 3.25%. מה הפריים?', options: ['3.25%', '4.75%', '5.5%'], correct: 1 } } });

test('morning news in the learning corner: the items, their sources, what it means for us, the term of the day', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = collectErrors(page);
  let calls = 0;
  await mockSupabase(page, makeFakeDb());
  await page.route('**/api/news/today', (r) => { calls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ digest: DIGEST() }) }); });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.learn-card');
  await page.click('.learn-card');
  await page.click('.sheet .tabs button:has-text("חדשות הבוקר")');
  await page.waitForSelector('.news-item');
  assert.equal(await page.locator('.news-item').count(), 3);
  assert.match(await page.locator('.news-pulse').textContent(), /3\.25%/);
  assert.equal(await page.locator('.news-item a[href="https://www.globes.co.il/a1"]').count(), 1);
  // The fake household has groceries: the prices item speaks about them; tax has nothing personal.
  const items = await page.locator('.news-item').allTextContents();
  assert.match(items[1], /מה זה אומר עליכם: ההוצאה שלכם על מכולת/);
  assert.match(items[2], /מה זה אומר למשפחות: עוד לא הוחלט/);
  await page.uncheck('.news-mine input');
  assert.match((await page.locator('.news-item').allTextContents())[1], /מה זה אומר למשפחות: כדאי להשוות/);
  await page.click('.news-item .chip:has-text("מה עם המשכנתא?")');
  assert.match(await page.locator('.news-answer').textContent(), /ההחזר לא משתנה/);
  await page.click('.news-term .quiz-opt:has-text("4.75%")');
  assert.match(await page.locator('.news-term').textContent(), /נכון!/);
  // Kept for the day: opening again does not ask the server.
  await page.click('.sheet .tabs button:has-text("השיעור")');
  await page.click('.sheet .tabs button:has-text("חדשות הבוקר")');
  await page.waitForSelector('.news-item');
  assert.equal(calls, 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('when the news is not available, a clear message and a retry', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockSupabase(page, makeFakeDb());
  await page.route('**/api/news/today', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'החדשות של הבוקר לא זמינות כרגע. נסו שוב מאוחר יותר.' }) }));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.click('.learn-card');
  await page.click('.sheet .tabs button:has-text("חדשות הבוקר")');
  await page.waitForSelector('.sheet [role="alert"]');
  assert.match(await page.locator('.sheet [role="alert"]').textContent(), /לא זמינות כרגע/);
  await page.close();
});
