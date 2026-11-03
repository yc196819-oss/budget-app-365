import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open({ email, setup } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  const sent = [];
  await page.route('**/api/telemetry', (r) => { sent.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 204, body: '' }); });
  if (setup) setup(db);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  if (email) {
    await page.evaluate((e) => {
      const k = 'sb-bwwupwbakefjhwropdin-auth-token';
      const s = JSON.parse(localStorage.getItem(k)); s.user.email = e; localStorage.setItem(k, JSON.stringify(s));
    }, email);
  }
  await page.goto(server.base + '/app/#/home');
  await page.reload();
  await page.waitForSelector('.hero');
  return { page, errors, db, sent };
}

test('export: two files, everything as JSON and the transactions as a CSV for Excel', async () => {
  const { page, errors } = await open();
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=המידע שלנו: קבצים, ייצוא ושחזור');
  const files = [];
  page.on('download', (d) => files.push(d));
  await page.click('text=להוריד את כל המידע');
  await page.waitForFunction(() => document.body.textContent.includes('ירדו שני קבצים'));
  await page.waitForTimeout(300);
  assert.equal(files.length, 2);
  const byName = Object.fromEntries(await Promise.all(files.map(async (d) => [d.suggestedFilename().replace(/-\d{4}-\d\d-\d\d/, ''), await readFile(await d.path(), 'utf8')])));
  const all = JSON.parse(byName['budget-all.json']);
  assert.ok(all.tables.transactions.length > 100);
  assert.equal(all.tables.categories.length, 6);
  assert.deepEqual(all.failed, []);
  const csv = byName['budget-transactions.csv'];
  assert.ok(csv.startsWith('﻿tx_date,type,amount,description,category'));
  assert.match(csv, /,expense,280,סונול,רכב,/);
  assert.equal(csv.trim().split('\r\n').length, all.tables.transactions.length + 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('recycle bin: what was deleted is listed with the days left, and comes back with one tap', async () => {
  const removed = new Date(Date.now() - 2 * 86400000).toISOString();
  const restored = [];
  const { page, errors, db } = await open({
    setup: (d) => {
      d.tables.recycle_bin = [
        { id: 7, household_id: 'h1', tbl: 'transactions', removed_at: removed, data: { id: 'gone1', household_id: 'h1', type: 'expense', amount: 999, description: 'מחשב נייד', tx_date: new Date().toISOString().slice(0, 10), category_id: 'home' } },
        { id: 8, household_id: 'h1', tbl: 'goals', removed_at: removed, data: { id: 'g9', household_id: 'h1', name: 'חופשה ביוון', target_amount: 9000 } }
      ];
    }
  });
  await page.route('**/rest/v1/rpc/restore_from_bin', (r) => {
    const { p_id } = JSON.parse(r.request().postData());
    restored.push(p_id);
    const item = db.tables.recycle_bin.find((x) => x.id === p_id);
    db.tables.transactions.push(item.data);
    item.restored_at = new Date().toISOString();
    return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=המידע שלנו: קבצים, ייצוא ושחזור');
  const bin = page.locator('.recycle-bin');
  await bin.locator('.bin-row').first().waitFor();
  assert.equal(await bin.locator('.bin-row').count(), 2);
  assert.match(await bin.textContent(), /מחשב נייד/);
  assert.match(await bin.textContent(), /עוד 28 ימים/);
  await page.click('button[aria-label="להחזיר: מחשב נייד"]');
  await page.waitForFunction(() => document.querySelectorAll('.recycle-bin .bin-row').length === 1);
  assert.deepEqual(restored, [7]);
  await page.waitForSelector('text=חזר למקום');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the usage switch: on by default, and off stops sending anything from this device', async () => {
  const { page, sent } = await open();
  await page.waitForTimeout(4500);
  assert.ok(sent.some((b) => b.events.includes('app_open')), 'opening the app is counted');
  await page.click('button[aria-label="פרופיל והגדרות"]');
  const sw = page.locator('input[aria-label="עזרה בשיפור האפליקציה"]');
  assert.equal(await sw.isChecked(), true);
  await sw.click();
  assert.equal(await page.evaluate(() => localStorage.getItem('telemetry:off')), '1');
  const before = sent.length;
  await page.evaluate(() => { location.hash = '#/money'; });
  await page.reload();
  await page.waitForSelector('.hero, .money, main');
  await page.waitForTimeout(4500);
  assert.equal(sent.length, before);
  await page.close();
});

test('owner dashboard: only for the owner, with active people, return rate and failures', async () => {
  const { page: other } = await open();
  await other.click('button[aria-label="פרופיל והגדרות"]');
  assert.equal(await other.locator('text=לוח בעלים').count(), 0);
  await other.close();

  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    active: { day: 3, week: 11, month: 25 }, retention: { started: 10, cameBack: 6, pct: 60 }, members: 31,
    use: [{ name: 'tx_add', count: 120 }], errors: { week: 2, top: [{ message: 'boom', count: 2, path: '#/home' }] },
    signedUp: 40, aiCost30d: 1.23, systemCost30d: 0.2,
    live: { users: 3, visitors: 1, screens: { home: 2, money: 1, login: 1 }, devices: { mobile: 3, desktop: 1 }, installed: 2 },
    funnel: { signups: 28, household: 15, tx: 7, import: 7, cameBack: 0, oldEnough: 0, byDay: { [new Date().toISOString().slice(0, 10)]: 2 } },
    daily: Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10), active: i, cost: 0.05 })),
    users: [{ who: '#a1b2c3', joined: '2026-10-28', lastSeen: '2026-11-01', opens: 9, added: 2, imports: 3, importFails: 1, asked: 14, aiCalls: 20, tokens: 51000, cost: 0.31 },
      { who: '#ffee00', owner: true, joined: '2026-06-28', lastSeen: '2026-11-02', opens: 30, added: 5, imports: 1, importFails: 0, asked: 40, aiCalls: 45, tokens: 90000, cost: 0.9 }]
  }) }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: 5, visitors: 0, screens: { home: 5 }, devices: { mobile: 5, desktop: 0 }, installed: 1 }) }));
  await page.clock.install();
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  const s = page.locator('.admin-stats');
  await s.locator('.per-user').waitFor();
  const t = await s.textContent();
  assert.match(t, /60%/);
  assert.match(t, /הוספת תנועה/);
  assert.match(t, /boom/);
  // Per person: a label and counts, never a name or an email.
  const row = await s.locator('.per-user tbody tr').first().textContent();
  assert.match(row, /#a1b2c3/);
  assert.match(row, /51,000/);
  assert.match(await s.locator('.per-user tr.owner-row').textContent(), /#ffee00 \(שלך\)/);
  assert.match(t, /\$1\.23/);
  assert.doesNotMatch(t, /@/);
  // Live: who is on now, by screen and device; refreshed every 15 seconds.
  assert.match(t, /מחוברים עכשיו: 3/);
  assert.match(t, /\+ 1 לא מחוברים/);
  assert.match(t, /בית 2 · כסף 1 · כניסה 1/);
  assert.match(await s.locator('.admin-funnel').textContent(), /הקימו משק בית15 54%/);
  assert.match(t, /2נרשמו היום/);
  await page.clock.runFor(16000);
  await page.waitForSelector('text=מחוברים עכשיו: 5');
  assert.deepEqual(errors, []);
  await page.close();
});

test('writing to the owner: a problem goes to the server, and the answer shows in "my requests"', async () => {
  const sentReq = [];
  const { page, errors, db } = await open({ setup: (d) => { d.tables.feedback = [{ id: 'f0', user_id: 'u1', kind: 'idea', text: 'רשימת קניות', status: 'done', owner_note: 'בדרך!', created_at: '2026-10-30T10:00:00Z' }]; } });
  await page.route('**/api/feedback', (r) => { sentReq.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=תקלות ורעיונות לשיפור');
  const fb = page.locator('.feedback');
  await fb.locator('.my-feedback').waitFor();
  assert.match(await fb.locator('.my-feedback').textContent(), /תשובה: בדרך!/);
  assert.ok(await fb.locator('button:has-text("לשלוח")').isDisabled());
  await fb.locator('textarea[aria-label="הפנייה"]').fill('הייבוא של הפירוט נתקע');
  await fb.locator('button:has-text("לשלוח")').click();
  await page.waitForSelector('text=נשלח. תודה!');
  assert.equal(sentReq.length, 1);
  assert.equal(sentReq[0].kind, 'bug');
  assert.equal(sentReq[0].text, 'הייבוא של הפירוט נתקע');
  assert.ok(db);
  assert.deepEqual(errors, []);
  await page.close();
});

test('owner inbox: requests by label, mark as working or done, and answer', async () => {
  const { page, errors } = await open({ email: 'yc196819@gmail.com' });
  const patches = [];
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ id: 'f1', who: '#abc123', kind: 'bug', text: 'הייבוא נתקע', screen: 'money', device: 'טלפון', status: 'new', created_at: '2026-11-02T10:00:00Z' }] }) }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/feedback/f1', (r) => { patches.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  const inbox = page.locator('.admin-inbox');
  await inbox.waitFor();
  assert.match(await inbox.textContent(), /1 חדשות/);
  assert.match(await inbox.textContent(), /#abc123/);
  assert.doesNotMatch(await inbox.textContent(), /@/);
  await inbox.locator('button.chip:has-text("בטיפול")').click();
  await page.waitForFunction(() => /בטיפול/.test(document.querySelector('.inbox-item').textContent));
  await inbox.locator('input[aria-label="תשובה לפנייה של #abc123"]').fill('תוקן, נסו שוב');
  await inbox.locator('button:has-text("לענות")').click();
  await page.waitForSelector('text=התשובה נשלחה');
  assert.deepEqual(patches, [{ status: 'working' }, { owner_note: 'תוקן, נסו שוב', status: 'working', notify: true }]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a wrong file is removed whole: every line it brought, after a second tap to be sure', async () => {
  const { page, errors, db } = await open({
    setup: (d) => {
      d.tables.imports = [{ id: 'imp1', household_id: 'h1', file_name: 'cal-october.pdf', kind: 'pdf', rows: 2, date_from: '2026-10-01', date_to: '2026-10-20', created_at: '2026-10-28T20:00:00Z' }];
      d.tables.transactions.push(
        { id: 'x1', household_id: 'h1', type: 'expense', amount: 77, description: 'מהקובץ', tx_date: '2026-10-05', import_id: 'imp1', source: 'pdf' },
        { id: 'x2', household_id: 'h1', type: 'expense', amount: 88, description: 'מהקובץ', tx_date: '2026-10-06', import_id: 'imp1', source: 'pdf' }
      );
    }
  });
  const before = db.tables.transactions.length;
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=המידע שלנו: קבצים, ייצוא ושחזור');
  const files = page.locator('.import-files');
  await files.locator('.file-row').waitFor();
  assert.match(await files.textContent(), /cal-october\.pdf/);
  assert.match(await files.textContent(), /2 תנועות/);
  await files.locator('button[aria-label="למחוק את הקובץ cal-october.pdf"]').click();
  assert.equal(db.tables.transactions.length, before, 'the first tap only asks');
  await files.locator('button:has-text("בטוח? למחוק 2")').click();
  await page.waitForSelector('text=הקובץ נמחק עם 2 התנועות שלו');
  assert.equal(db.tables.transactions.length, before - 2);
  assert.ok(!db.tables.transactions.some((t) => t.import_id === 'imp1'));
  assert.ok(db.tables.imports[0].removed_at);
  assert.equal(await files.locator('.file-row').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('an uploaded file gets a name of its own, and the original file name stays in view', async () => {
  const { page, errors, db } = await open({
    setup: (d) => {
      d.tables.imports = [
        { id: 'imp1', household_id: 'h1', file_name: 'Statement_1029384.pdf', kind: 'pdf', rows: 3, date_from: '2026-10-01', date_to: '2026-10-20', created_at: '2026-10-28T20:00:00Z' },
        { id: 'imp0', household_id: 'h1', file_name: null, kind: 'pdf', rows: 5, created_at: '2026-09-02T20:00:00Z' }
      ];
    }
  });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=המידע שלנו: קבצים, ייצוא ושחזור');
  const files = page.locator('.import-files');
  await files.locator('.file-row').first().waitFor();
  assert.match(await files.textContent(), /פירוט שהועלה ב-02\.09/, 'a file from before names were kept still shows its date');
  await files.locator('button[aria-label="לתת שם לקובץ Statement_1029384.pdf"]').click();
  await files.locator('input[aria-label="שם לקובץ"]').fill('ויזה אוקטובר');
  await files.locator('button:has-text("לשמור")').click();
  await page.waitForSelector('text=השם נשמר');
  assert.equal(db.tables.imports.find((x) => x.id === 'imp1').title, 'ויזה אוקטובר');
  const row = files.locator('.file-row').first();
  assert.match(await row.textContent(), /ויזה אוקטובר/);
  assert.match(await row.locator('.file-original').textContent(), /Statement_1029384\.pdf/);
  // Clearing the name goes back to the original.
  await files.locator('button[aria-label="לתת שם לקובץ ויזה אוקטובר"]').click();
  await files.locator('input[aria-label="שם לקובץ"]').fill('');
  await files.locator('button:has-text("לשמור")').click();
  await page.waitForFunction(() => !document.querySelector('.file-name-form'));
  assert.equal(db.tables.imports.find((x) => x.id === 'imp1').title, null);
  assert.equal(await files.locator('.file-original').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('emails to users: one per step, read before sending, a test to yourself, and sent only after a second tap', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  const posts = [];
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  const mail = (subject) => ({ subject, text: 'היי,\nקובי', html: '' });
  let left = 7;
  let testFails = true;
  await page.route('**/api/admin/reengage', async (r) => {
    if (r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() || '{}');
      posts.push(body);
      if (body.test && testFails) return r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'השרת לא מחובר לשום שירות לשליחת מיילים (לא Resend ולא Gmail/SMTP).' }) });
      if (body.test) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"test":true,"to":"budgetapp2852@gmail.com","provider":"smtp"}' });
      await new Promise((ok) => setTimeout(ok, 120));
      left -= 1;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sent: 1, failed: 0, left }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mail: { ready: true }, campaigns: [
      { id: 'start', title: 'נרשמו ולא פתחו משק בית', count: 14, preview: mail('נשארו לך 2 דקות להתחיל') },
      { id: 'first', title: 'פתחו משק בית ולא העלו פירוט', count: 12, preview: mail('עוד צעד אחד, ורואים לאן הכסף הולך') },
      { id: 'more', title: 'העלו פירוט, פחות מ-6 חודשים', count: 7, preview: mail('טיפ קטן שיעשה את התקציב הרבה יותר מדויק') }
    ] }) });
  });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  const card = page.locator('.admin-reengage');
  await card.waitFor();
  assert.equal(await card.locator('.campaign').count(), 3);
  const more = card.locator('.campaign-more');
  await more.locator('summary').click();
  assert.match(await more.textContent(), /טיפ קטן שיעשה את התקציב/);
  // The email itself, with its design.
  await more.frameLocator('iframe.mail-preview').locator('a:has-text("להוסיף עוד פירוט")').waitFor();
  assert.ok(await more.frameLocator('iframe.mail-preview').locator('img[src$="/wallet-192.png"]').count());
  // A test that fails says why, in the row, and stays there.
  await more.locator('button:has-text("ניסיון אליי")').click();
  await more.locator('.mail-job.is-error').waitFor();
  assert.match(await more.locator('.mail-job').textContent(), /לא מחובר לשום שירות לשליחת מיילים/);
  assert.ok(await more.locator('.mail-steps .st-fail').count());
  // A test that goes: each step gets its ✓, and where it went.
  testFails = false;
  await more.locator('button:has-text("ניסיון אליי")').click();
  await more.locator('.mail-job.is-done').waitFor();
  assert.equal(await more.locator('.mail-steps .st-ok').count(), 3);
  assert.match(await more.locator('.mail-job').textContent(), /נשלח אל budgetapp2852@gmail\.com דרך Gmail \/ SMTP/);
  assert.deepEqual(posts, [{ campaign: 'more', test: true }, { campaign: 'more', test: true }]);
  await more.locator('button:has-text("לשלוח ל-7")').click();
  assert.equal(posts.length, 2, 'the first tap only asks');
  await more.locator('button:has-text("בטוח? לשלוח עכשיו ל-7")').click();
  // While it sends, the envelope flies and the bar fills with the real count.
  await more.locator('.mail-job.is-active').waitFor();
  await more.locator('.mail-job.is-done').waitFor({ timeout: 10000 });
  assert.match(await more.locator('.mail-count').textContent(), /נשלחו 7 מתוך 7/);
  assert.match(await more.locator('.mail-bar i').getAttribute('style'), /width: ?100%/);
  const sends = posts.filter((p) => !p.test);
  assert.equal(sends.length, 7, 'one at a time, so the progress is real');
  assert.deepEqual(sends[0], { campaign: 'more', test: false, limit: 1 });
  assert.match(await more.textContent(), /אין כרגע למי לשלוח/);
  assert.match(await card.locator('.campaign-start').textContent(), /14/, 'the other emails stay as they were');
  assert.deepEqual(errors.filter((e) => !/status of 502/.test(e)), [], 'only the failed test send, on purpose');
  await page.close();
});

test('emails to users: when the server cannot email people yet, the dashboard says so and only a test can be sent', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mail: { ready: false, resendTestOnly: true }, campaigns: [{ id: 'more', title: 'העלו פירוט, פחות מ-6 חודשים', count: 7, preview: { subject: 'טיפ', text: 'היי' } }] }) }));
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  const card = page.locator('.admin-reengage');
  await card.waitFor();
  assert.match(await card.locator('.mail-not-ready').textContent(), /עוד לא מוגדר לשלוח מיילים/);
  assert.equal(await card.locator('button:has-text("לשלוח ל-7")').count(), 0);
  assert.equal(await card.locator('button:has-text("ניסיון אליי")').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});
