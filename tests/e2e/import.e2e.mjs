import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
import { makeXlsx } from '../fixtures/zip.mjs';
import { makePdf } from '../fixtures/pdf.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = new Date();
// Dates in the previous month: always full of fake data, whatever today is.
const prev = (d) => new Date(today.getFullYear(), today.getMonth() - 1, d);
const ddmmyyyy = (dt) => String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear();
const iso = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');

// Fake AI: reads statements and suggests categories. Records what it was sent.
async function mockAi(page, { fail = false, statement = [] } = {}) {
  const sent = [];
  await page.route('**/api/ai/import', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    sent.push(body);
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'No AI key configured' }) });
    let transactions = statement;
    if (/מספר \| תיאור/.test(body.prompt)) {
      transactions = String(body.text).split('\n').map((line) => {
        const [i, desc] = line.split(' | ');
        return { i: Number(i), category_id: /פז/.test(desc) ? 'car' : null, subcategory_id: null };
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions }) });
  });
  return sent;
}

async function open(width = 390, ai = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const db = makeFakeDb();
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  const sent = await mockAi(page, ai);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/money');
  await page.waitForSelector('.month-nav');
  return { page, db, errors, sent };
}

function statementXlsx() {
  return makeXlsx([
    ['פירוט עסקאות לכרטיס 4821'],
    [],
    ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'],
    [ddmmyyyy(prev(1)), 'משכנתא', '4,500.00', '4,500.00'],
    [ddmmyyyy(prev(2)), 'שופרסל דיל ת"א', '111.11', '111.11'],
    [ddmmyyyy(prev(3)), 'פז אילת', '300.00', '300.00'],
    [ddmmyyyy(prev(4)), 'פז אילת', '150.00', '150.00'],
    [ddmmyyyy(prev(6)), 'מוסך הצפון', '900.00', '900.00'],
    [ddmmyyyy(prev(7)), 'זיכוי ZARA', '-120.00', '-120.00'],
    ['', 'סה"כ', '', '5,841.11']
  ]);
}

test('an Excel statement: read on the device, categorized, duplicates held back, saved, undone', async () => {
  const { page, db, errors, sent } = await open();
  const before = db.tables.transactions.length;
  await page.click('text=העלאת פירוט כרטיס');
  await page.setInputFiles('.sheet input[type="file"]', { name: 'max.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: statementXlsx() });
  await page.waitForSelector('.import-summary');
  assert.match(await page.locator('.import-summary').textContent(), /6 תנועות נמצאו/);
  assert.match(await page.locator('.import-summary').textContent(), /1 כבר במערכת/);

  // Only merchants the household never categorized went to the AI, once each.
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /פז אילת/);
  assert.match(sent[0].text, /מוסך הצפון/);
  assert.doesNotMatch(sent[0].text, /שופרסל|משכנתא/);
  assert.equal(sent[0].text.match(/פז אילת/g).length, 1);
  assert.equal(sent[0].fileData, undefined);

  // The "waiting" tab opens first: the garage and the refund.
  assert.equal(await page.locator('.import-line').count(), 2);
  await page.locator('.import-line', { hasText: 'מוסך הצפון' }).locator('.import-open').click();
  await page.locator('.import-pick .chip', { hasText: 'רכב' }).click();
  assert.equal(await page.locator('.import-line').count(), 1);

  await page.locator('.sheet button', { hasText: /^כפולות/ }).click();
  const dupe = page.locator('.import-line', { hasText: 'משכנתא' });
  assert.match(await dupe.textContent(), /כבר קיימת/);
  assert.equal(await dupe.locator('input[type="checkbox"]').isChecked(), false);

  await page.click('text=לשמור 5 תנועות');
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').textContent(), /נשמרו 5 תנועות/);
  const added = db.tables.transactions.slice(before);
  assert.equal(added.length, 5);
  const by = (d) => added.filter((t) => t.description === d);
  assert.deepEqual(by('פז אילת').map((t) => t.category_id), ['car', 'car']);
  assert.equal(by('מוסך הצפון')[0].category_id, 'car');
  assert.equal(by('שופרסל דיל ת"א')[0].subcategory_id, 'super');
  assert.equal(by('שופרסל דיל ת"א')[0].tx_date, iso(prev(2)));
  assert.equal(by('זיכוי ZARA')[0].type, 'income');
  assert.ok(added.every((t) => t.household_id === 'h1' && t.created_by === 'u1' && t.source === 'pdf'));
  assert.equal(by('משכנתא').length, 0);

  // The new lines show up in the money list right away.
  await page.click('button[aria-label="החודש הקודם"]');
  assert.ok(await page.locator('.row', { hasText: 'מוסך הצפון' }).count());

  await page.click('.toast button');
  await page.waitForTimeout(300);
  assert.equal(db.tables.transactions.length, before);
  assert.equal(await page.locator('.row', { hasText: 'מוסך הצפון' }).count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('without AI the lines still import; unknown merchants just wait for a category', async () => {
  const { page, db } = await open(390, { fail: true });
  const before = db.tables.transactions.length;
  await page.click('text=העלאת פירוט כרטיס');
  await page.setInputFiles('.sheet input[type="file"]', { name: 'max.xlsx', mimeType: '', buffer: statementXlsx() });
  await page.waitForSelector('.import-summary');
  assert.match(await page.locator('.import-summary').textContent(), /4 מחכות לכם/);
  await page.click('text=לשמור 5 תנועות');
  await page.waitForSelector('.toast');
  assert.equal(db.tables.transactions.length, before + 5);
  assert.equal(db.tables.transactions.slice(before).filter((t) => !t.category_id).length, 4);
  await page.close();
});

test('a PDF statement is read with pdf.js (under the strict CSP) and parsed by the AI', async () => {
  const statement = [
    { date: iso(prev(9)), description: 'AMAZON MKTPLACE', amount: 74.4, type: 'expense', category_id: 'home' },
    { date: iso(prev(10)), description: 'ארומה', amount: 999, type: 'expense', category_id: null }
  ];
  const { page, errors, sent } = await open(1280, { statement });
  // From the desktop sidebar.
  await page.click('.sidebar >> text=העלאת פירוט');
  await page.setInputFiles('.sheet input[type="file"]', { name: 'cal.pdf', mimeType: 'application/pdf', buffer: makePdf(['Card statement 4821', 'AMAZON MKTPLACE 74.40']) });
  await page.waitForSelector('.import-summary', { timeout: 20000 });
  assert.match(sent[0].text, /AMAZON MKTPLACE 74\.40/);
  assert.match(sent[0].prompt, /id:food/);
  assert.match(await page.locator('.import-summary').textContent(), /2 תנועות נמצאו/);
  // The AI left ארומה without a category; the household's history fills it in.
  await page.locator('.sheet button', { hasText: /^הכול/ }).click();
  assert.match(await page.locator('.import-line', { hasText: 'ארומה' }).textContent(), /כמו בפעם הקודמת/);
  assert.deepEqual(errors.filter((e) => !/Warning/.test(e)), []);
  await page.close();
});

test('old binary .xls and unknown files get a clear message, and another file can be picked', async () => {
  const { page } = await open();
  await page.click('text=העלאת פירוט כרטיס');
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'isracard.xls', mimeType: 'application/vnd.ms-excel', buffer: ole });
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.locator('[role="alert"]').textContent(), /xlsx/);
  await page.click('text=לבחור קובץ אחר');
  await page.setInputFiles('.sheet input[type="file"]', { name: 'notes.docx', mimeType: 'application/msword', buffer: Buffer.from('x') });
  assert.match(await page.locator('[role="alert"]').textContent(), /לא נתמך/);
  await page.close();
});

test('the add sheet links to the statement upload, replacing itself (no sheet on a sheet)', async () => {
  const { page } = await open();
  await page.click('.bottom-nav .nav-add');
  await page.click('text=או: העלאת פירוט חודשי של כרטיס');
  assert.equal(await page.locator('.sheet').count(), 1);
  assert.equal(await page.locator('.sheet h2').textContent(), 'העלאת פירוט כרטיס');
  await page.close();
});
