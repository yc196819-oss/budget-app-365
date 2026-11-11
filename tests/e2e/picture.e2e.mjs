import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';
import { makeXlsx } from '../fixtures/zip.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const today = new Date();
const ym = (k) => { const d = new Date(today.getFullYear(), today.getMonth() - k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const dd = (k, day) => { const d = new Date(today.getFullYear(), today.getMonth() - k, day); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };

async function open(width, setup) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = makeFakeDb();
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await page.route('**/api/ai/import', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"transactions":[]}' }));
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.pic-card, .pic-check');
  return { page, db, errors };
}

test('first time: banks, then cards (how many of each, and the bank own cards), with the days reminders need', async () => {
  const { page, db, errors } = await open(390, (d) => { d.tables.bank_accounts = []; d.tables.credit_cards = []; d.tables.imports = []; });
  assert.match(await page.locator('.pic-card').textContent(), /איפה הכסף שלכם/);
  await page.click('.pic-card');
  await page.waitForSelector('.pic-picker');
  // Step 1: the banks, Pagi among them.
  assert.match(await page.locator('.pic-title').textContent(), /באיזה בנק/);
  assert.equal(await page.locator('.pic-grid .pic-pick').count(), 12);
  assert.equal(await page.locator('.pic-pick img[alt="פאג״י"]').count(), 1);
  await page.click('.pic-pick:has(img[alt="לאומי"])');
  await page.waitForFunction(() => document.querySelectorAll('.pic-pick.on').length === 1);
  assert.deepEqual(db.tables.bank_accounts.map((a) => [a.provider, a.name]), [['leumi', 'לאומי']]);
  await page.locator('.pic-q', { hasText: 'לאומי' }).locator('select').selectOption('10');
  for (let i = 0; i < 30 && db.tables.bank_accounts[0].salary_day !== 10; i++) await page.waitForTimeout(100);
  assert.equal(db.tables.bank_accounts[0].salary_day, 10);
  await page.click('.pic-chosen button:has-text("המשך")');
  // Step 2: the card companies, and the cards the bank itself issued.
  await page.waitForSelector('.pic-title:has-text("כרטיסי אשראי")');
  assert.equal(await page.locator('.pic-grid .pic-pick').count(), 5);
  await page.click('.pic-pick:has(img[alt="מקס"])');
  await page.waitForFunction(() => document.querySelectorAll('.pic-pick.on').length === 1);
  const max = page.locator('.pic-qs:not(.pic-bankcards) .pic-q', { hasText: 'מקס' });
  await max.locator('button[aria-label="עוד אחד"]').click();
  await page.waitForFunction(() => document.querySelector('.pic-pick.on .pic-n')?.textContent === '2×');
  assert.deepEqual(db.tables.credit_cards.map((c) => c.provider), ['max', 'max']);
  // One billing day for the company: both its cards.
  await max.locator('select').selectOption('2');
  for (let i = 0; i < 30 && !db.tables.credit_cards.every((c) => c.billing_day === 2); i++) await page.waitForTimeout(100);
  assert.ok(db.tables.credit_cards.every((c) => c.billing_day === 2));
  // A second tap on a company with two cards does not remove them.
  await page.click('.pic-pick:has(img[alt="מקס"])');
  await page.waitForSelector('.toast:has-text("לחצו על −")');
  assert.equal(db.tables.credit_cards.length, 2);
  await page.locator('.pic-bankcards .pic-q', { hasText: 'לאומי' }).locator('button[aria-label="עוד אחד"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.pic-chosen li').length === 3);
  assert.equal(db.tables.credit_cards.filter((c) => c.provider === 'leumi').length, 1);
  assert.match(await page.locator('.pic-chosen').textContent(), /אשראי לאומי/);
  await page.click('.pic-chosen button:has-text("סיימתי")');
  await page.waitForSelector('.pic-list');
  // One statement for each: the bank, Max (both cards), and Leumi's own cards.
  assert.equal(await page.locator('.pic-task').count(), 3);
  assert.match(await page.locator('.pic-task', { hasText: 'מקס' }).textContent(), /2 כרטיסים/);
  // A phone shows the month on one screen: no scrolling.
  assert.ok(await page.evaluate(() => { const b = document.querySelector('.sheet'); return b.scrollHeight <= b.clientHeight + 2; }), 'the month fits the screen');
  // A tile opens how to get its statement, with the site.
  await page.locator('.pic-task', { hasText: 'אשראי לאומי' }).locator('.pic-item-main').click();
  assert.match(await page.locator('.pic-focus').textContent(), /באתר הבנק: כרטיסי אשראי/);
  const link = page.locator('.pic-focus a.btn', { hasText: 'לאתר של לאומי' });
  assert.equal(await link.getAttribute('href'), 'https://www.leumi.co.il/');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.match(await link.getAttribute('rel'), /noopener/);
  // The 6 months are a tap away.
  await page.click('.pic-focus button[aria-label="סגירה"]');
  await page.click('.pic-hist-btn');
  await page.waitForSelector('.pic-history .pic-tr');
  assert.equal(await page.locator('.pic-list').first().isVisible(), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a file of another company moves there without uploading again, and its lines are saved there', async () => {
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'עו״ש', provider: 'leumi', balance: 1 }];
    d.tables.credit_cards = [{ id: 'c1', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 10 }, { id: 'c2', household_id: d.hid, name: 'כאל', provider: 'cal', billing_day: 10 }];
    d.tables.imports = [];
  });
  await page.click('.pic-card');
  await page.waitForSelector('.pic-task');
  await page.click('.pic-task:has-text("מקס") .pic-item-main');
  await page.click('.pic-focus button:has-text("להעלות את הקובץ")');
  await page.waitForSelector('.sheet:has-text("העלאת פירוט: מקס")');
  const cal = makeXlsx([['כאל - פירוט עסקאות'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'], [dd(1, 3), 'מסעדה בדויה', '80.00', '80.00'], ['', 'סה"כ', '', '80.00']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'x.xlsx', mimeType: '', buffer: cal });
  await page.waitForSelector('.import-move');
  assert.match(await page.locator('.import-move').textContent(), /פירוט של כאל, לא של מקס/);
  await page.click('.import-move button:has-text("להעביר לכאל")');
  await page.waitForSelector('.sheet:has-text("העלאת פירוט: כאל")');
  // Straight on to its lines, under Cal.
  await page.waitForSelector('.import-okline');
  assert.equal(await page.locator('.import-move').count(), 0);
  assert.match(await page.locator('.import-okline').textContent(), /פירוט כאל/);
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  const imp = db.tables.imports.find((f) => f.source_id === 'c2');
  assert.ok(imp, 'the file is kept as Cal\'s');
  assert.ok(db.tables.transactions.filter((t) => t.import_id === imp.id).every((t) => t.card_id === 'c2'));
  // A company not in the list yet: added, and the file goes to it.
  await page.click('.pic-card');
  await page.waitForSelector('.pic-task');
  await page.click('.pic-task:has-text("מקס") .pic-item-main');
  await page.click('.pic-focus button:has-text("להעלות את הקובץ")');
  const isra = makeXlsx([['ישראכרט פירוט חיובים'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'], [dd(1, 4), 'חנות בדויה', '40.00', '40.00'], ['', 'סה"כ', '', '40.00']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'y.xlsx', mimeType: '', buffer: isra });
  await page.waitForSelector('.import-move button:has-text("להוסיף את ישראכרט")');
  await page.click('.import-move button');
  await page.waitForSelector('.sheet:has-text("העלאת פירוט: ישראכרט")');
  const added = db.tables.credit_cards.find((c) => c.provider === 'isracard');
  assert.ok(added);
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  assert.ok(db.tables.imports.find((f) => f.source_id === added.id));
  assert.deepEqual(errors, []);
  await page.close();
});

test('the ring and 6 months: what is uploaded, what is missing, and an upload from a missing month checks the file', async () => {
  const { page, db, errors } = await open(1280, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'עו״ש', bank_name: 'לאומי', provider: 'leumi', salary_day: 10, balance: 12000 }];
    d.tables.credit_cards = [{ id: 'c1', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 1, last4: '4821' }];
    d.tables.imports = [{ id: 'b1', household_id: d.hid, source_kind: 'bank', source_id: 'a1', date_from: ym(1) + '-01', date_to: ym(1) + '-28' }];
  });
  // The bank's last month is in; the card's statement of this month is not.
  assert.match(await page.locator('.pic-card').textContent(), /50%.*חסר פירוט אחד/);
  await page.click('.pic-card');
  await page.waitForSelector('.pic-history');
  assert.equal(await page.locator('.pic-ring2 b').textContent(), '1/2');
  assert.equal(await page.locator('.pic-tr').count(), 3, 'a header and two accounts');
  const bank = page.locator('.pic-tr').nth(1);
  assert.equal(await bank.locator('.pic-dot.is-ok').count(), 1);
  assert.equal(await bank.locator('.pic-dot.is-waiting').count(), 1, 'this month is not over');
  // Each logo opens the company's own site in a new tab.
  assert.equal(await bank.locator('a.logo-link').getAttribute('href'), 'https://www.leumi.co.il/');
  // Upload from the card's missing month: the sheet knows which card it is for.
  await page.locator('.pic-tr').nth(2).locator('button.pic-dot').last().click();
  await page.waitForSelector('.sheet:has-text("העלאת פירוט: מקס")');
  const xlsx = makeXlsx([['פירוט עסקאות לכרטיס 4821'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'],
    [dd(1, 3), 'מסעדה בדויה', '80.00', '80.00'], [dd(1, 20), 'חנות בדויה', '120.00', '120.00'], ['', 'סה"כ', '', '200.00']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'max.xlsx', mimeType: '', buffer: xlsx });
  await page.waitForSelector('.import-checks');
  const checks = await page.locator('.import-checks li').allTextContents();
  assert.match(await page.locator('.scan-result h3').textContent(), /הכול תקין/);
  assert.match(checks[0], /זה פירוט של מקס \(כרטיס 4821\)/);
  assert.match(checks.join(' '), /2 תנועות, סה״כ ₪200/);
  // All fine: on to the lines by itself, under the card.
  await page.waitForSelector('.import-okline');
  assert.match(await page.locator('.import-okline').textContent(), /פירוט מקס/);
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  const imp = db.tables.imports.find((f) => f.source_id === 'c1');
  assert.ok(imp, 'the file is kept as the card\'s');
  assert.equal(imp.source_kind, 'card');
  assert.ok(db.tables.transactions.filter((t) => t.import_id === imp.id).every((t) => t.card_id === 'c1'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('a bank file is kept as the bank account\'s, and a card file chosen for the bank is flagged', async () => {
  const { page, db } = await open(390, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'עו״ש', provider: 'leumi', balance: 1 }];
    d.tables.credit_cards = [];
    d.tables.imports = [];
  });
  await page.click('.pic-card');
  await page.waitForSelector('.pic-task');
  await page.click('.pic-task .pic-item-main');
  await page.click('.pic-focus button:has-text("להעלות את הקובץ")');
  const xlsx = makeXlsx([['פירוט עסקאות לכרטיס 4821'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'], [dd(1, 3), 'מסעדה בדויה', '80.00', '80.00'], ['', 'סה"כ', '', '80.00']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'x.xlsx', mimeType: '', buffer: xlsx });
  await page.waitForSelector('.import-checks');
  assert.match(await page.locator('.import-checks li.bad').first().textContent(), /נראה כמו פירוט של כרטיס/);
  // A problem stops on the check: nothing goes on by itself.
  assert.match(await page.locator('.scan-result h3').textContent(), /משהו לא מתאים/);
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('.import-summary').count(), 0);
  await page.click('.sheet button:has-text("להמשיך בכל זאת")');
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  const imp = db.tables.imports.find((f) => f.source_id === 'a1');
  assert.equal(imp.source_kind, 'bank');
  assert.ok(db.tables.transactions.filter((t) => t.import_id === imp.id).every((t) => t.account_id === 'a1'));
  await page.close();
});

test('a new household with nothing uploaded yet sees the card too', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  db.tables.transactions = [];
  db.tables.bank_accounts = []; db.tables.credit_cards = []; db.tables.imports = [];
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home');
  await page.waitForSelector('.pic-card');
  assert.match(await page.locator('.pic-card').textContent(), /איפה הכסף שלכם/);
  await page.close();
});

test('a company with two cards: a file with only one of them says so, and can be saved anyway', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.bank_accounts = [];
    d.tables.credit_cards = [{ id: 'c1', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 10, last4: '4821' }, { id: 'c2', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 10, last4: '5555' }];
    d.tables.imports = [];
  });
  await page.click('.pic-card');
  await page.waitForSelector('.pic-task');
  assert.equal(await page.locator('.pic-task').count(), 1, 'one statement for the company');
  await page.click('.pic-task .pic-item-main');
  await page.click('.pic-focus button:has-text("להעלות את הקובץ")');
  const xlsx = makeXlsx([['פירוט עסקאות'], [], ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב', '4 ספרות אחרונות'], [dd(1, 3), 'מסעדה בדויה', '80.00', '80.00', '4821'], [dd(1, 5), 'חנות בדויה', '20.00', '20.00', '4821'], ['', 'סה"כ', '', '100.00', '']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'm.xlsx', mimeType: '', buffer: xlsx });
  await page.waitForSelector('.scan-result');
  assert.match(await page.locator('.scan-result h3').textContent(), /נמצא כרטיס אחד מתוך 2/);
  await page.click('.sheet button:has-text("לשמור, ולהעלות את השני")');
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  assert.ok(db.tables.imports.find((f) => f.source_id === 'c1'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('accounts and cards saved before the companies: named ones get their logo, the rest are asked once or learned from the next file', async () => {
  const { page, db, errors } = await open(390, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'נעמי', balance: 1 }];
    d.tables.credit_cards = [{ id: 'c1', household_id: d.hid, name: 'רמי לוי', billing_day: 10 }, { id: 'c2', household_id: d.hid, name: 'הכרטיס של קובי', billing_day: 10 }];
    d.tables.imports = [];
  });
  await page.click('.pic-card');
  await page.waitForSelector('.pic-hint');
  // Rami Levy's card is Isracard's: its logo, not a question.
  assert.equal(await page.locator('.pic-task img[alt="ישראכרט"]').count(), 1);
  assert.match(await page.locator('.pic-task:has(img[alt="ישראכרט"])').textContent(), /רמי לוי/, 'the card\'s own name stays');
  assert.equal(await page.locator('.pic-pill.pick').count(), 2);
  // A row with no company: one tap on its row, one on the company's logo.
  await page.click('.pic-task:has-text("הכרטיס של קובי") .pic-item-main');
  await page.click('.pic-focus .pic-pickone[aria-label="כאל"]');
  for (let i = 0; i < 30 && db.tables.credit_cards[1].provider !== 'cal'; i++) await page.waitForTimeout(100);
  assert.equal(db.tables.credit_cards[1].provider, 'cal');
  await page.waitForFunction(() => document.querySelectorAll('.pic-pill.pick').length === 1);
  await page.click('.pic-focus button[aria-label="סגירה"]');
  await page.waitForFunction(() => !document.querySelector('.pic-veil'));
  // The bank account learns its bank from the first file confirmed for it.
  await page.click('.pic-task:has-text("נעמי") .pic-item-main');
  await page.click('.pic-focus button:has-text("להעלות את הקובץ")');
  const xlsx = makeXlsx([['בנק לאומי - תנועות בחשבון'], [], ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'], [dd(1, 3), 'העברה בדויה', '80.00', '', '1000'], [dd(1, 20), 'משכורת בדויה', '', '500.00', '1420']]);
  await page.setInputFiles('.sheet input[type="file"]', { name: 'b.xlsx', mimeType: '', buffer: xlsx });
  await page.waitForSelector('.import-okline');
  await page.click('.sheet button:has-text("לשמור")');
  await page.waitForSelector('.toast:has-text("נשמרו")');
  for (let i = 0; i < 30 && db.tables.bank_accounts[0].provider !== 'leumi'; i++) await page.waitForTimeout(100);
  assert.equal(db.tables.bank_accounts[0].provider, 'leumi');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the link in our emails opens completing the picture at once, and leaves the address clean', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/?action=picture#/home');
  await page.waitForSelector('.sheet:has-text("השלמת התמונה")');
  assert.doesNotMatch(page.url(), /action=/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the button in the personal email opens the upload at once, and counts as a click on that email', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const db = makeFakeDb();
  const errors = collectErrors(page);
  const sent = [];
  await mockSupabase(page, db);
  await page.route('**/api/telemetry', (r) => { sent.push(...((JSON.parse(r.request().postData() || '{}').events) || [])); return r.fulfill({ status: 204, body: '' }); });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/?action=import&m=nudge#/home');
  await page.waitForSelector('.sheet:has-text("העלאת פירוט")');
  assert.doesNotMatch(page.url(), /m=nudge|action=/);
  // Usage counts are sent a few seconds later, together.
  for (let i = 0; i < 80 && !sent.includes('mail_click_nudge'); i++) await page.waitForTimeout(100);
  assert.ok(sent.includes('mail_click_nudge'), 'counted: ' + sent.join(','));
  assert.deepEqual(errors, []);
  await page.close();
});

test('everything due is in: the card steps aside, a small ✓ at the top says so and when the next statements come', async () => {
  const { page, errors } = await open(390, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'עו״ש', bank_name: 'לאומי', provider: 'leumi', salary_day: 10, balance: 12000 }];
    d.tables.credit_cards = [{ id: 'c1', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: 1, last4: '4821' }];
    d.tables.imports = [{ id: 'b1', household_id: d.hid, source_kind: 'bank', source_id: 'a1', date_from: ym(1) + '-01', date_to: ym(1) + '-28' }]
      .concat([1, 2, 3].map((k) => ({ id: 'k' + k, household_id: d.hid, source_kind: 'card', source_id: 'c1', date_from: ym(k) + '-03', date_to: ym(k) + '-20' })));
  });
  await page.waitForSelector('.pic-check');
  assert.equal(await page.locator('.pic-card').count(), 0, 'no big card when nothing is missing');
  await page.click('.pic-check');
  const sheet = page.locator('.sheet');
  await sheet.locator('.pic-check-title').waitFor();
  assert.match(await sheet.textContent(), /הכל מעודכן/);
  assert.equal(await sheet.locator('.pic-next-row').count(), 2, 'the bank account and the card');
  assert.match(await sheet.locator('.pic-next').textContent(), /מקס.*••4821|עו״ש/);
  assert.match(await sheet.locator('.pic-next-when').first().textContent(), /^מ-\d{1,2} ב/);
  await sheet.locator('button:has-text("הבנתי")').click();
  await page.waitForSelector('.pic-check-title', { state: 'detached' });
  assert.deepEqual(errors, []);
  await page.close();
});

test('something missing: no ✓ at the top, the card says what', async () => {
  const { page } = await open(390, (d) => {
    d.tables.bank_accounts = [{ id: 'a1', household_id: d.hid, name: 'עו״ש', bank_name: 'לאומי', provider: 'leumi', salary_day: 10, balance: 12000 }];
    d.tables.imports = [];
  });
  await page.waitForSelector('.pic-card');
  assert.equal(await page.locator('.pic-check').count(), 0);
  await page.close();
});

test('a card charged a day ago: said once, by the picture card, not again under "needs attention"', async () => {
  const { page, errors } = await open(1280, (d) => {
    d.tables.credit_cards = [{ id: 'c1', household_id: d.hid, name: 'מקס', provider: 'max', billing_day: Math.max(1, today.getDate() - 1), last4: '4821' }];
    d.tables.imports = [];
  });
  await page.waitForSelector('.pic-card');
  await page.waitForSelector('.hero');
  assert.doesNotMatch(await page.locator('.home').textContent(), /ירד ב-/);
  assert.deepEqual(errors, []);
  await page.close();
});
