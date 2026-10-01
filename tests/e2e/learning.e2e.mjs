import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
import { LESSONS, TOPICS } from '../../public/app/src/content/learning/index.js';
import { shuffledQuiz } from '../../public/app/src/domain/learning.js';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open(setup) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  db.tables.user_settings = [];
  if (setup) setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.learn-card');
  return { page, db, errors };
}

test('today\'s lesson: read, a 2-question quiz, saved per user, streak on the home card', async () => {
  const { page, db, errors } = await open();
  const first = LESSONS[0];
  assert.match(await page.locator('.learn-card').textContent(), new RegExp(first.title));
  assert.match(await page.locator('.learn-card').textContent(), new RegExp('מתוך ' + LESSONS.length));
  await page.click('.learn-card');
  await page.waitForSelector('.lesson-title');
  assert.equal(await page.locator('.lesson-title').textContent(), first.title);
  assert.equal(await page.locator('.lesson-p').count(), first.body.length);
  await page.click('text=למבחנון: 2 שאלות');
  const quiz = shuffledQuiz(first);
  // First answer right, second wrong.
  await page.locator('.quiz-opt').nth(quiz[0].answer).click();
  assert.match(await page.locator('.quiz-why').textContent(), /נכון!/);
  await page.click('text=לשאלה הבאה');
  await page.locator('.quiz-opt').nth((quiz[1].answer + 1) % quiz[1].options.length).click();
  assert.match(await page.locator('.quiz-why').textContent(), /לא בדיוק/);
  await page.click('text=לסיים את השיעור');
  await page.waitForSelector('text=1 מתוך 2 נכונות');
  await page.waitForFunction(() => true);
  const row = db.tables.user_settings.find((r) => r.user_id === 'u1');
  assert.ok(row && row.learning && row.learning.done[first.id], 'progress saved');
  assert.equal(row.household_id, 'h1');
  await page.keyboard.press('Escape');
  assert.match(await page.locator('.learn-card').textContent(), /השיעור של היום הושלם/);
  assert.match(await page.locator('.learn-card .flame').textContent(), /1/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('progress from another device is loaded, and the library shows every topic', async () => {
  const done = Object.fromEntries(LESSONS.slice(0, 3).map((l) => [l.id, '2026-01-01']));
  const { page } = await open((db) => db.tables.user_settings.push({ user_id: 'u1', household_id: 'h1', learning: { done, answers: {} }, reminders: { keep: true } }));
  assert.match(await page.locator('.learn-card').textContent(), new RegExp(LESSONS[3].title));
  await page.click('.learn-card');
  await page.click('.sheet button:has-text("כל השיעורים")');
  assert.equal(await page.locator('.topic').count(), TOPICS.length);
  assert.match(await page.locator('.sheet').textContent(), new RegExp('3 מתוך ' + LESSONS.length));
  await page.locator('.topic').first().locator('.row').click();
  assert.equal(await page.locator('.tick.on').count(), 3);
  await page.locator('.topic-lesson').nth(5).click();
  assert.equal(await page.locator('.lesson-title').textContent(), TOPICS[0].lessons[5].title);
  await page.close();
});

test('saving progress keeps the other user settings', async () => {
  const { page, db } = await open((d) => d.tables.user_settings.push({ user_id: 'u1', household_id: 'h1', learning: null, reminders: { keep: true } }));
  await page.click('.learn-card');
  await page.click('text=למבחנון: 2 שאלות');
  for (let i = 0; i < 2; i++) {
    await page.locator('.quiz-opt').first().click();
    await page.locator('.quiz-why button').click();
  }
  await page.waitForSelector('text=לשיעור הבא');
  await page.waitForTimeout(200);
  const row = db.tables.user_settings.find((r) => r.user_id === 'u1');
  assert.deepEqual(row.reminders, { keep: true });
  assert.ok(row.learning.done[LESSONS[0].id]);
  await page.close();
});
