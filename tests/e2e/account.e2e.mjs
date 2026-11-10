import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open({ email, setup, width = 390 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
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

  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com', width: 1280 });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    active: { day: 3, week: 11, month: 25 }, retention: { started: 10, cameBack: 6, pct: 60 }, members: 31,
    use: [{ name: 'tx_add', count: 120 }], errors: { week: 2, top: [{ message: 'boom', count: 2, path: '#/home' }] },
    signedUp: 40, aiCost30d: 1.23, systemCost30d: 0.2,
    live: { users: 3, visitors: 1, screens: { home: 2, money: 1, login: 1 }, devices: { mobile: 3, desktop: 1 }, installed: 2 },
    funnel: { signups: 28, household: 15, tx: 7, import: 7, cameBack: 0, oldEnough: 0, byDay: { [new Date().toISOString().slice(0, 10)]: 2 } },
    daily: Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10), active: i, cost: 0.05 })),
    ownerCost30d: 0.9, sharing: { shares: 5, friends: 2, sharers: 1, mine: { shares: 3, friends: 4 } },
    cohorts: [{ week: '2026-11-01', signups: 12, household: 10, withData: 3, imported: 3, oldEnough: 0, cameBack: 0 }, { week: '2026-10-25', signups: 9, household: 8, withData: 2, imported: 2, oldEnough: 9, cameBack: 1 }],
    upload: { opened: 7, picked: 5, saved: 3, failedPeople: 2, files: [{ key: 'pdf', n: 4 }, { key: 'xlsx', n: 2 }], reasons: [{ key: 'pdf_scan', n: 2 }], leftAt: [{ key: 'review', n: 1 }] },
    users: [{ who: '#a1b2c3', name: 'רון', joined: '2026-10-28', lastSeen: '2026-11-01', opens: 9, added: 2, imports: 3, importFails: 1, asked: 14, aiCalls: 20, tokens: 51000, cost: 0.31, shares: 5, friends: 2, health: { level: 'good', label: 'משתמש פעיל, נעזר ביועץ', reasons: [] } },
      { who: '#bb22cc', name: '', joined: '2026-10-20', lastSeen: null, opens: 0, added: 0, imports: 0, importFails: 0, asked: 0, aiCalls: 0, tokens: 0, cost: 0, health: { level: 'stuck', label: 'נרשם ולא סיים הרשמה', reasons: ['נרשם לפני 15 ימים'] } }]
  }) }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: 5, visitors: 0, screens: { home: 5 }, devices: { mobile: 5, desktop: 0 }, installed: 1 }) }));
  await page.clock.install();
  await page.click('.side-profile');
  await page.click('text=לוח בעלים');
  const s = page.locator('.admin-stats');
  // A main screen with a button for each part, on a computer too; never sideways scrolling.
  await s.locator('.admin-tool').first().waitFor();
  assert.deepEqual(await s.locator('.admin-tool b').allTextContents(), ['פניות', 'פעילות ומשתמשים', 'מיילים', 'מחירי סופר', 'מצב המערכת']);
  assert.equal(await s.locator('.per-user').count(), 0);
  await s.locator('.admin-tool:has-text("מצב המערכת")').click();
  assert.match(await s.textContent(), /boom/);
  await s.locator('button:has-text("לוח הבעלים")').click();
  await s.locator('.admin-tool:has-text("פעילות ומשתמשים")').click();
  await s.locator('.per-user').waitFor();
  const noSideways = await page.evaluate(() => [...document.querySelectorAll('.sheet, .sheet *')].every((el) => el.scrollWidth <= el.clientWidth + 2 || getComputedStyle(el).overflowX === 'hidden' || el.tagName === 'TABLE'));
  assert.ok(noSideways, 'nothing scrolls sideways');
  const t = await s.textContent();
  assert.match(t, /60%/);
  assert.match(t, /הוספת תנועה/);
  // Per person: the name they gave, what they did and how they are doing; no email until asked.
  const row = await s.locator('.per-user .people-row').first().textContent();
  assert.match(row, /רון/);
  assert.match(row, /51,000 טוקנים/);
  // Sharing: per person, and in total with the owner's own apart.
  assert.match(row, /שיתף 5 · הצטרפו דרכו 2/);
  assert.match(await s.locator('.people-sharing').textContent(), /1 שיתפו \(5 פעמים ב-30 יום\) · הצטרפו דרכם 2.*דרכך: שיתפת 3, הצטרפו 4/s);
  assert.match(row, /משתמש פעיל/);
  assert.match(await s.locator('.per-user .people-row').nth(1).textContent(), /#bb22cc.*נרשם ולא סיים הרשמה/s);
  await s.locator('.per-user button.chip:has-text("תקועים")').click();
  assert.equal(await s.locator('.per-user .people-row').count(), 1);
  await s.locator('.per-user button.chip:has-text("הכול")').click();
  // The owner's own accounts are not in the list; their AI cost is given apart.
  assert.equal(await s.locator('.per-user .people-row').count(), 2);
  assert.match(await s.textContent(), /החשבונות שלך לא נספרים/);
  assert.match(await s.textContent(), /מתוכם \$0\.9 שלך/);
  assert.match(t, /\$1\.23/);
  assert.doesNotMatch(t, /@/, 'no email before it is asked for');
  // Live: who is on now, by screen and device; refreshed every 15 seconds.
  assert.match(t, /מחוברים עכשיו: 3/);
  assert.match(t, /\+ 1 לא מחוברים/);
  assert.match(t, /בית 2 · כסף 1 · כניסה 1/);
  assert.match(await s.locator('.admin-funnel').textContent(), /הקימו משק בית15 54%/);
  // By week of sign-up, and where uploads stop: numbers only, in Hebrew.
  const coh = await s.locator('.admin-cohorts').textContent();
  assert.match(coh, /01\.11.*12.*10.*3 25%/s);
  assert.match(coh, /מוקדם/);
  assert.match(coh, /25\.10.*1 11%/s);
  const up = await s.locator('.admin-upload').textContent();
  assert.match(up, /פתחו העלאה 7 · בחרו קובץ 5 · שמרו 3/);
  assert.match(up, /PDF סרוק בלי טקסט2/);
  assert.match(up, /במסך הבדיקה, לפני שמירה1/);
  assert.match(t, /נרשמו היום 2/);
  assert.match(t, /פעילים: היום 3 · השבוע 11 · החודש 25/);
  // An email only on request.
  await page.route('**/api/admin/email?who=*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: new URL(r.request().url()).searchParams.get('who') === '#a1b2c3' ? 'ron@example.com' : '' }) }));
  await s.locator('.per-user .people-row').first().locator('button:has-text("להציג מייל")').click();
  await s.locator('.people-email:has-text("ron@example.com")').waitFor();
  // "Who came in today?": one tap, a sentence, each person.
  await page.route('**/api/admin/today', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ day: '2026-11-04', items: [
    { who: '#a1b2c3', name: 'רון', first: '13:34', last: '17:27', newToday: false, opens: 4, added: 0, imports: 3, importFails: 0, asked: 12, aiCalls: 23, cost: 0.41, errors: 0, health: { level: 'good', label: 'משתמש פעיל, נעזר ביועץ', reasons: [] } },
    { who: '#dd33ee', name: 'נועה', first: '18:02', last: '18:02', newToday: true, opens: 1, added: 0, imports: 0, importFails: 0, asked: 0, aiCalls: 0, cost: 0, errors: 0, health: { level: 'stuck', label: 'לא העלה אף פירוט', reasons: [] } }] }) }));
  await s.locator('button:has-text("לוח הבעלים")').click();
  await s.locator('.admin-tool:has-text("פניות")').click();
  await s.locator('.admin-today button:has-text("מי נכנס היום?")').click();
  const today = s.locator('.admin-today');
  await today.locator('.today-summary').waitFor();
  const sum = await today.locator('.today-summary').textContent();
  assert.match(sum, /היום נכנסו 2 משתמשים \(אחד חדש\)/);
  assert.match(sum, /אחד העלה פירוט/);
  assert.match(sum, /כדאי לעזור ל: נועה \(לא העלה אף פירוט\)/);
  assert.match(await today.locator('.people-row').first().textContent(), /13:34–17:27.*3 פירוטים.*12 שאלות ליועץ/s);
  await s.locator('button:has-text("לוח הבעלים")').click();
  await s.locator('.admin-tool:has-text("פעילות ומשתמשים")').click();
  await page.clock.runFor(16000);
  await page.waitForSelector('text=מחוברים עכשיו: 5');
  assert.deepEqual(errors, []);
  await page.close();
});

test('writing to the owner: an answer waits on the profile and home, opens as a conversation, and "still not working" reopens it', async () => {
  const sentReq = [];
  const replies = [];
  const { page, errors } = await open({ setup: (d) => {
    d.tables.feedback = [
      { id: 'f0', user_id: 'u1', kind: 'idea', text: 'רשימת קניות', status: 'done', owner_note: 'בדרך!', closed: true, helped: null, last_by: 'owner', last_at: '2026-11-03T10:00:00Z', user_seen_at: null, created_at: '2026-10-30T10:00:00Z' },
      { id: 'f9', user_id: 'u1', kind: 'bug', text: 'משהו ישן', status: 'new', closed: false, last_by: 'user', last_at: '2026-10-01T10:00:00Z', created_at: '2026-10-01T10:00:00Z' }
    ];
    d.tables.feedback_messages = [{ feedback_id: 'f0', author: 'owner', text: 'בדרך!', created_at: '2026-11-03T10:00:00Z' }];
  } });
  await page.route('**/api/feedback', (r) => { sentReq.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.route('**/api/feedback/f0', (r) => { replies.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reopened: true }) }); });
  // The answer is waiting: on the home screen and on the profile button.
  await page.waitForSelector('.answer-notice:has-text("יש תשובה לפנייה שלך")');
  assert.equal(await page.locator('.topbar .fb-dot').textContent(), '1');
  await page.click('.topbar .icon-btn');
  await page.waitForSelector('.fb-has-answer:has-text("תשובה חדשה")');
  await page.click('text=תקלות ורעיונות לשיפור');
  const fb = page.locator('.feedback');
  await fb.locator('.fb-item').first().waitFor();
  assert.match(await fb.locator('.fb-item').first().textContent(), /תשובה חדשה/);
  assert.match(await fb.locator('.fb-item').nth(1).textContent(), /פתוחה · מחכה לתשובה/);
  // Opening it shows the conversation and marks the answer read.
  await fb.locator('.fb-item').first().click();
  await page.waitForSelector('.fb-msg.them:has-text("בדרך!")');
  for (let i = 0; i < 50 && !replies.length; i++) await page.waitForTimeout(100);
  assert.deepEqual(replies[0], { seen: true });
  // Closed: "it helped" or "still not working" (one message reopens it).
  await page.click('.fb-closed button:has-text("עדיין לא עובד")');
  await page.fill('textarea[aria-label="מה עדיין לא עובד"]', 'עדיין אין רשימה');
  await page.click('.fb-compose button:has-text("לשלוח")');
  await page.waitForSelector('text=הפנייה נפתחה מחדש');
  assert.deepEqual(replies[1], { message: 'עדיין אין רשימה' });
  // A new request.
  await page.click('text=→ הפניות שלי');
  await page.click('button:has-text("+ פנייה חדשה")');
  assert.ok(await page.locator('.feedback button[type=submit]').isDisabled());
  await page.fill('textarea[aria-label="הפנייה"]', 'הייבוא של הפירוט נתקע');
  await page.click('.feedback button[type=submit]');
  await page.waitForSelector('text=נשלח. תודה!');
  assert.equal(sentReq.length, 1);
  assert.equal(sentReq[0].kind, 'bug');
  assert.equal(sentReq[0].text, 'הייבוא של הפירוט נתקע');
  assert.deepEqual(errors, []);
  await page.close();
});

// A tiny real PNG (1x1), made-up content.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');

test('a picture with a request: shrunk on the device, sent after the text, and shown in the conversation', async () => {
  const sentImg = [];
  const { page, errors } = await open({ setup: (d) => {
    d.tables.feedback = [{ id: '11111111-1111-1111-1111-111111111111', user_id: 'u1', kind: 'bug', text: 'מסך נתקע', status: 'new', closed: false, last_by: 'user', last_at: '2026-11-07T10:00:00Z', created_at: '2026-11-07T10:00:00Z' }];
    d.tables.feedback_messages = [{ feedback_id: '11111111-1111-1111-1111-111111111111', author: 'user', text: 'צירפתי תמונה', image: '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png', created_at: '2026-11-07T10:01:00Z' }];
  } });
  await page.route('**/api/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"33333333-3333-3333-3333-333333333333"}' }));
  await page.route('**/api/feedback/*/image', (r) => { sentImg.push({ url: r.request().url(), body: JSON.parse(r.request().postData()) }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.route('**/api/feedback-image?**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.click('.topbar .icon-btn');
  await page.click('text=תקלות ורעיונות לשיפור');
  // The picture in an existing conversation.
  await page.locator('.feedback .fb-item').first().click();
  await page.waitForSelector('.fb-msg img.fb-img');
  // A new request with a picture.
  await page.click('text=→ הפניות שלי');
  await page.click('button:has-text("+ פנייה חדשה")');
  await page.fill('textarea[aria-label="הפנייה"]', 'הכפתור למטה מרצד');
  await page.setInputFiles('input[aria-label="צירוף תמונה"]', { name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.img-pick-chosen img');
  await page.click('.feedback button[type=submit]');
  await page.waitForSelector('text=נשלח. תודה!');
  assert.equal(sentImg.length, 1);
  assert.match(sentImg[0].url, /\/api\/feedback\/33333333-3333-3333-3333-333333333333\/image$/);
  assert.match(sentImg[0].body.data, /^data:image\/jpeg;base64,/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('owner inbox: like a messaging app; unread first, the name, answer and close or ask, notes, read ticks', async () => {
  const { page, errors } = await open({ email: 'yc196819@gmail.com' });
  const acts = [];
  const items = [
    { id: 'f1', who: 'רון', label: '#abc123', kind: 'bug', status: 'new', screen: 'money', device: 'טלפון', created_at: '2026-11-02T10:00:00Z', last_at: '2026-11-02T10:05:00Z', last_by: 'user', unread: 2, pinned: false, archived: false, closed: false, helped: null, readByUser: false,
      messages: [{ author: 'user', text: 'הייבוא נתקע', created_at: '2026-11-02T10:00:00Z' }, { author: 'user', text: 'גם בקובץ השני', created_at: '2026-11-02T10:05:00Z' }] },
    { id: 'f2', who: '#ffee11', label: '#ffee11', kind: 'idea', status: 'done', created_at: '2026-11-01T10:00:00Z', last_at: '2026-11-01T12:00:00Z', last_by: 'owner', unread: 0, pinned: false, archived: false, closed: true, helped: true, readByUser: true,
      messages: [{ author: 'user', text: 'רעיון', created_at: '2026-11-01T10:00:00Z' }, { author: 'owner', text: 'נכנס לרשימה', created_at: '2026-11-01T12:00:00Z' }] }
  ];
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/feedback/f1', (r) => { const b = JSON.parse(r.request().postData()); acts.push(b); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mailed: !!b.mail }) }); });
  const drafts = [];
  await page.route('**/api/admin/feedback/f1/draft', (r) => { const b = JSON.parse(r.request().postData()); drafts.push(b); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'היי רון, תיקנו את הייבוא. סגור ופתח את האפליקציה ונסה שוב.', fixed: 'no', why: 'אין ברשימת השינויים תיקון לייבוא, ומאז שכתב הייבוא נכשל פעמיים' }) }); });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.click('.admin-hub-btn:has-text("פניות")');
  const inbox = page.locator('.admin-inbox');
  await inbox.waitFor();
  assert.equal(await inbox.locator('.inbox-unread-count').textContent(), '1');
  const rows = inbox.locator('.inbox-row');
  assert.match(await rows.first().textContent(), /רון/);
  assert.equal(await rows.first().locator('.inbox-badge').textContent(), '2');
  assert.match(await rows.nth(1).textContent(), /✓✓ נכנס לרשימה/);
  assert.doesNotMatch(await inbox.textContent(), /@/);
  // Filters.
  await inbox.locator('button.chip:has-text("רעיונות")').click();
  assert.equal(await inbox.locator('.inbox-row').count(), 1);
  await inbox.locator('button.chip:has-text("הכול")').click();
  // Open: marked read; answer with a quick reply, ask (stays open).
  await rows.first().click();
  const t = page.locator('.inbox-thread');
  await t.waitFor();
  assert.match(await t.textContent(), /גם בקובץ השני/);
  // A draft from the AI by where things stand, from the gist the owner typed; nothing is sent until he sends it.
  await t.locator('textarea[aria-label="תשובה לרון"]').fill('תיקנתי את הייבוא');
  await t.locator('.inbox-ai button:has-text("תוקן")').click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="תשובה לרון"]').value.startsWith('היי רון'));
  assert.deepEqual(drafts, [{ status: 'fixed', hint: 'תיקנתי את הייבוא' }]);
  assert.equal(acts.length, 1, 'only "seen"; the draft was not sent');
  // It checked: no fix found, so the owner is warned before sending.
  assert.match(await t.locator('.inbox-check').textContent(), /לא מצאתי שזה תוקן.*הייבוא נכשל פעמיים/s);
  await t.locator('.inbox-quick button:has-text("אפשר צילום מסך?")').click();
  await t.locator('button:has-text("לשאול אותו")').click();
  await page.waitForSelector('text=נשלח, הפנייה נשארת פתוחה');
  // A note only the owner sees.
  await t.locator('button[aria-label="אפשרויות"]').click();
  await t.locator('button:has-text("הערה פנימית")').click();
  await t.locator('textarea[aria-label="הערה פנימית"]').fill('לבדוק את הקובץ של מקס');
  await t.locator('button:has-text("לשמור הערה")').click();
  await page.waitForSelector('text=ההערה נשמרה');
  // Answer and close; pin.
  await t.locator('textarea[aria-label="תשובה לרון"]').fill('תוקן, נסו שוב');
  await t.locator('button:has-text("לענות ולסגור")').click();
  await page.waitForSelector('text=נשלח והפנייה נסגרה');
  await t.locator('button[aria-label="אפשרויות"]').click();
  await t.locator('button:has-text("להצמיד למעלה")').click();
  await page.waitForSelector('text=הוצמד למעלה');
  assert.deepEqual(acts, [{ seen: true }, { message: 'אפשר צילום מסך?', close: false, mail: true }, { note: 'לבדוק את הקובץ של מקס' }, { message: 'תוקן, נסו שוב', close: true, mail: true }, { pinned: true }]);
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
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mail: { ready: true }, stopped: 2, campaigns: [
      { id: 'start', title: 'נרשמו ולא פתחו משק בית', count: 14, preview: mail('נשארו לך 2 דקות להתחיל'), done: { sent: 13, failed: 1, last: '2026-11-04T19:28:00Z' } },
      { id: 'first', title: 'פתחו משק בית ולא העלו פירוט', count: 12, preview: mail('עוד צעד אחד, ורואים לאן הכסף הולך') },
      { id: 'more', title: 'העלו פירוט, פחות מ-6 חודשים', count: 7, preview: mail('טיפ קטן שיעשה את התקציב הרבה יותר מדויק') }
    ] }) });
  });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.click('.admin-hub-btn:has-text("מיילים")');
  const card = page.locator('.admin-reengage');
  await card.waitFor();
  assert.equal(await card.locator('.campaign').count(), 3);
  // What already went out, and who asked to stop.
  assert.match(await card.locator('.campaign-start .campaign-done').textContent(), /נשלח ל-13 · נכשל 1 · אחרון 04\.11/);
  assert.equal(await card.locator('.campaign-more .campaign-done').count(), 0);
  assert.match(await card.locator('.campaign-stopped').textContent(), /ביקשו להפסיק לקבל: 2/);
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
  await page.click('.admin-hub-btn:has-text("מיילים")');
  const card = page.locator('.admin-reengage');
  await card.waitFor();
  assert.match(await card.locator('.mail-not-ready').textContent(), /עוד לא מוגדר לשלוח מיילים/);
  assert.equal(await card.locator('button:has-text("לשלוח ל-7")').count(), 0);
  assert.equal(await card.locator('button:has-text("ניסיון אליי")').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('owner: the outside price service, what it takes and costs, then one small run with real rows', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/prices/load', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"running":false,"products":0,"offers":0,"chains":0,"wanted":0}' }));
  await page.route('**/api/admin/prices/service', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Israeli Supermarket Prices', description: 'Official price files', modified: '2026-10-01', pricing: { model: 'PAY_PER_EVENT', perUnit: null, unit: '', events: null }, fields: [{ key: 'query', title: 'Product', type: 'string', example: 'חלב' }], example: { query: 'חלב' } }) }));
  let ran = null;
  let checks = 0;
  await page.route('**/api/admin/prices/sample', (r) => { ran = JSON.parse(r.request().postData() || '{}'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ input: { productQueries: ['חלב 3%'] }, runId: 'run1abcdef', status: 'RUNNING' }) }); });
  await page.route('**/api/admin/prices/sample/run1abcdef', (r) => { checks++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checks < 2 ? { status: 'RUNNING', done: false, seconds: 5 } : { status: 'SUCCEEDED', done: true, seconds: 12, cost: 0.012, count: 2, keys: ['chain', 'store', 'item', 'price', 'updated'], rows: [{ chain: 'שופרסל', store: 'דיזנגוף', item: 'חלב 3%', price: '6.9', updated: '2026-11-08' }, { chain: 'רמי לוי', store: 'תלפיות', item: 'חלב 3%', price: '6.5', updated: '2026-11-08' }] }) }); });
  await page.clock.install();
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.click('.admin-hub-btn:has-text("מחירי סופר")');
  const card = page.locator('.admin-price-service');
  await card.waitFor();
  await card.locator('button:has-text("1. מה השירות")').click();
  await card.locator('text=Israeli Supermarket Prices').waitFor();
  assert.match(await card.textContent(), /PAY_PER_EVENT/);
  assert.match(await card.textContent(), /query – Product \(למשל "חלב"\)/);
  await card.locator('button:has-text("2. הרצה קטנה")').click();
  // Checked every 5 seconds until the run is done.
  await page.clock.runFor(5100);
  await page.clock.runFor(5100);
  await card.locator('table').waitFor();
  assert.deepEqual(ran, {}, 'the server picks the test search');
  assert.equal(checks, 2);
  assert.match(await card.textContent(), /2 תוצאות ב-12 שניות · עלה \$0\.012 · חיפוש: חלב 3%/);
  assert.equal(await card.locator('tbody tr').count(), 2);
  assert.match(await card.locator('tbody').textContent(), /רמי לוי.*6\.5/s);
  assert.deepEqual(errors, []);
  await page.close();
});


test('owner on a phone: the main screen has the numbers and a button for each part; each opens its own page', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 7, week: 20, month: 40 }, retention: { started: 10, cameBack: 3, pct: 30 }, members: 1, use: [], errors: { week: 2, top: [] }, aiCost30d: 4.2,
    daily: [{ day: '2026-11-07', active: 5, cost: 0.1 }, { day: '2026-11-08', active: 7, cost: 0.38 }], funnel: { signups: 9, household: 7, tx: 2, import: 2, cameBack: 0, oldEnough: 0, byDay: { '2026-11-08': 3, '2026-11-07': 2 } },
    cohorts: [{ week: '2026-11-08', signups: 5, household: 4, withData: 1, imported: 1, oldEnough: 0, cameBack: 0 }] }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":3,"visitors":0,"screens":{},"devices":{"mobile":3,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  const s = page.locator('.admin-stats');
  await s.locator('.admin-hub').waitFor();
  assert.deepEqual((await s.locator('.admin-hub-btn b').allTextContents()), ['שאלו את הנתונים', 'פניות', 'פעילות ומשתמשים', 'מיילים', 'מחירי סופר', 'מצב המערכת']);
  // The numbers come a moment after the buttons (while they load, "טוען…").
  await s.locator('.admin-kpi').first().waitFor();
  // The numbers count up to their value.
  await page.waitForFunction(() => /\$0\.38/.test(document.querySelectorAll('.admin-kpi')[3]?.textContent || '') && /7/.test(document.querySelector('.admin-kpi b')?.textContent || ''));
  const kpis = await s.locator('.admin-kpi').allTextContents();
  assert.equal(kpis.length, 4);
  assert.match(kpis[0], /פעילים היום7▲ 2 מאתמול/);
  assert.match(kpis[1], /נרשמו השבוע5/);
  assert.match(kpis[3], /\$0\.38/);
  assert.match(await s.locator('.admin-summary').textContent(), /השבוע נרשמו 5, 1 מהם כבר עם נתונים/);
  // Nothing long on the main screen: the parts open on their own page.
  assert.equal(await s.locator('.admin-funnel').count(), 0);
  await s.locator('.admin-hub-btn:has-text("פעילות ומשתמשים")').click();
  await s.locator('.admin-funnel').waitFor();
  assert.equal(await s.locator('.admin-hub').count(), 0);
  await s.locator('button:has-text("לוח הבעלים")').click();
  await s.locator('.admin-hub').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('owner dashboard, part two: a greeting, what is happening now, a month chart, where people spend time, and a question for the AI', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com', width: 1280 });
  const now = Date.now();
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    active: { day: 9, week: 20, month: 40 }, retention: { started: 10, cameBack: 3, pct: 30 }, members: 1, errors: { week: 0, top: [] }, aiCost30d: 4.2,
    use: [{ name: 'app_open', count: 400 }, { name: 'tx_add', count: 30 }, { name: 'advisor_ask', count: 50 }, { name: 'shop_add', count: 20 }],
    daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10), active: i === 29 ? 9 : 3, cost: 0.05 })),
    feed: [{ at: new Date(now - 4 * 60000).toISOString(), who: 'דנה', what: 'העלה/תה פירוט', kind: 'data' }, { at: new Date(now - 90 * 60000).toISOString(), who: 'משתמש/ת', what: 'נרשם/ה', kind: 'join' }],
    users: [{ who: '#a1b2c3', name: 'דנה', email: 'x@example.com', joined: '2026-10-28', lastSeen: '2026-11-01', opens: 1, added: 0, imports: 0, importFails: 0, asked: 0, aiCalls: 0, tokens: 0, cost: 0, health: { level: 'good', label: 'ok', reasons: [] } }]
  }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":1,"visitors":0,"screens":{},"devices":{"mobile":1,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  let asked = null;
  await page.route('**/api/admin/ask', (r) => { asked = JSON.parse(r.request().postData()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'השבוע נרשמו 5.' }) }); });
  await page.click('.side-profile');
  await page.click('text=לוח בעלים');
  const s = page.locator('.admin-stats');
  await s.locator('.admin-feed').waitFor();
  assert.match(await s.locator('.admin-hello').textContent(), /(בוקר טוב|צהריים טובים|ערב טוב|לילה טוב)יום /);
  const feed = await s.locator('.admin-feed li').allTextContents();
  assert.equal(feed.length, 2);
  assert.match(feed[0], /דנה העלה\/תה פירוט.*לפני 4 דק׳/);
  // A record of the month: today is the busiest of 30 days.
  assert.match(await s.locator('.admin-record').textContent(), /שיא חודשי: 9 פעילים היום/);
  // Tools are tiles; each part opens on its own page.
  assert.deepEqual(await s.locator('.admin-tool b').allTextContents(), ['פניות', 'פעילות ומשתמשים', 'מיילים', 'מחירי סופר', 'מצב המערכת']);
  // A question: the answer shows, and the stats sent along are whitelisted on the server.
  await s.locator('.admin-ask-chips .chip').first().click();
  await s.locator('.admin-ask-answer:has-text("השבוע נרשמו 5.")').waitFor();
  assert.equal(asked.q, 'כמה נרשמו השבוע לעומת שבוע שעבר?');
  await s.locator('.admin-tool:has-text("פעילות ומשתמשים")').click();
  // Two weeks first, a month on request.
  await s.locator('.admin-daily').waitFor();
  assert.equal(await s.locator('.admin-daily .admin-bar').count(), 14);
  await s.locator('.admin-daily button:has-text("חודש")').click();
  assert.equal(await s.locator('.admin-daily .admin-bar').count(), 30);
  // Where people spend their actions, without app openings.
  const legend = await s.locator('.admin-donut-legend li').allTextContents();
  assert.deepEqual(legend, ['יועץ50%', 'כסף ותנועות30%', 'קניות20%']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('owner on a phone: what is happening now on the main screen, and the question box behind its own button', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] },
    feed: Array.from({ length: 8 }, (_, i) => ({ at: new Date(Date.now() - i * 600000).toISOString(), who: 'משתמש/ת', what: 'הוסיף/ה תנועה', kind: 'use' })) }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/ask', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'לא התקבלה תשובה. נסו שוב.' }) }));
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  const s = page.locator('.admin-stats');
  await s.locator('.admin-feed').waitFor();
  assert.equal(await s.locator('.admin-feed li').count(), 4, 'a short feed on the phone');
  await s.locator('.admin-hub-btn:has-text("שאלו את הנתונים")').click();
  await s.locator('.admin-ask input').fill('מה קרה היום?');
  await s.locator('.admin-ask button[type="submit"]').click();
  await s.locator('.admin-ask-answer.is-error:has-text("לא התקבלה תשובה")').waitFor();
  assert.deepEqual(errors.filter((e) => !/502/.test(e)), []);
  await page.close();
});

test('owner: confirming kashrut, one by one or every product that says "מהדרין" at once', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/prices/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"no key"}' }));
  let waiting = [{ barcode: '1001', name: 'חלב 3% מהדרין', maker: 'מחלבה א', qty: 1, unit: 'ליטר' }, { barcode: '1002', name: 'גבינה לבנה 5%', maker: null, qty: 250, unit: 'גרם' }];
  const confirmed = [];
  await page.route('**/api/admin/kosher**', (r) => {
    if (r.request().method() === 'POST') {
      const b = JSON.parse(r.request().postData());
      confirmed.push(b);
      waiting = waiting.filter((p) => !b.barcodes.includes(p.barcode));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, count: b.barcodes.length }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products: 2, confirmed: confirmed.length, waiting }) });
  });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.locator('.admin-hub-btn:has-text("מחירי סופר")').click();
  const k = page.locator('.kosher-admin');
  await k.locator('button:has-text("להציג מוצרים")').click();
  await k.locator('.kosher-list li').first().waitFor();
  assert.match(await k.textContent(), /250 גרם/);
  await k.locator('button:has-text("שכתוב בשמם")').click();
  await page.waitForFunction(() => document.querySelectorAll('.kosher-admin .kosher-list li').length === 1);
  assert.deepEqual(confirmed[0], { barcodes: ['1001'], level: 'mehadrin' });
  await k.locator('.kosher-list input[type=checkbox]').check();
  await k.locator('.kosher-bar button:has-text("כשר")').first().click();
  await page.waitForFunction(() => /אין מוצרים שמחכים/.test(document.querySelector('.kosher-admin')?.textContent || ''));
  assert.equal(confirmed[1].barcodes[0], '1002');
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
  await page.close();
});

test('owner: the catalog loads on the server; the card shows the numbers from the database and goes on while closed', async () => {
  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: { day: 1, week: 1, month: 1 }, retention: { started: 0, cameBack: 0, pct: null }, members: 1, use: [], errors: { week: 0, top: [] } }) }));
  await page.route('**/api/admin/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"users":0,"visitors":0,"screens":{},"devices":{"mobile":0,"desktop":0},"installed":0}' }));
  await page.route('**/api/admin/feedback', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/admin/reengage', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"preview":null}' }));
  await page.route('**/api/admin/kosher**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":0,"confirmed":0,"waiting":[]}' }));
  await page.route('**/api/admin/prices/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"no key"}' }));
  let state = { running: false, part: 0, parts: 0, added: 0, cost: 0, error: null, endedAt: null, products: 120, offers: 131, chains: 19, wanted: 3, chainsDone: [{ key: 'shufersal', name: 'שופרסל', count: 7500 }, { key: 'keshet', name: 'קשת טעמים', count: 0, error: 'HTTP 403' }] };
  let started = 0;
  await page.route('**/api/admin/prices/load', (r) => {
    if (r.request().method() === 'POST') { started++; state = { ...state, running: true, free: true, part: 1, parts: 7 }; }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  await page.locator('.admin-hub-btn:has-text("מחירי סופר")').click();
  const c = page.locator('.price-seed');
  await c.locator('.price-seed-stats').waitFor();
  assert.match(await c.textContent(), /120\s*מוצרים.*131\s*מחירים.*19\s*רשתות.*3\s*חיפשו ולא נמצאו/);
  assert.match(await c.locator('.price-seed-chains li.ok').textContent(), /שופרסל.*7,500 מוצרים/);
  assert.match(await c.locator('.price-seed-chains li.bad').textContent(), /קשת טעמים.*לא נטען/);
  assert.match(await c.textContent(), /בחינם מהקבצים הרשמיים/);
  await c.locator('button:has-text("לעדכן מחירים מהרשתות עכשיו (חינם)")').click();
  await c.locator('text=טוען רשת 1 מתוך 7').waitFor();
  assert.equal(started, 1);
  assert.equal(await c.locator('button:has-text("לעדכן")').count(), 0, 'no second start while it runs');
  assert.match(await c.textContent(), /אפשר לסגור את המסך/);
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
  await page.close();
});
