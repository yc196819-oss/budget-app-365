import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

const iso = (d) => d.toISOString().slice(0, 10);

// The couple: u1 (signed in) and u2 (דני). דני already asked for a washing machine.
function setup(db, { partner = true, cards = true } = {}) {
  if (partner) db.tables.memberships.push({ household_id: 'h1', user_id: 'u2', display_name: 'דני', role: 'member' });
  db.tables.households = [{ id: 'h1', decision_threshold: 500, personal_allowance: 400, income_expectations: [] }];
  db.tables.shared_decisions = cards ? [{ id: 'd1', household_id: 'h1', created_by: 'u2', title: 'מכונת כביסה', amount: 2400, note: 'הישנה נשברה', status: 'open', wanted_by: null, created_at: new Date(Date.now() - 3600e3).toISOString() }] : [];
  db.tables.decision_votes = [];
  return db;
}

async function open({ hash = '#/together', partner = true, cards = true, width = 390, prep } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const db = setup(makeFakeDb(), { partner, cards });
  if (prep) prep(db);
  const errors = collectErrors(page);
  const notified = [];
  await mockSupabase(page, db);
  await page.route('**/api/decisions/notify', (r) => { notified.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/' + hash);
  return { page, db, errors, notified };
}

test('the partner\'s card waits for my answer: badge on the tab, the reason, the effect on the money', async () => {
  const { page, errors } = await open({ hash: '#/home' });
  await page.waitForSelector('.hero');
  await page.waitForSelector('.nav-item[href="#/together"] .nav-badge');
  assert.equal((await page.locator('.nav-item[href="#/together"] .nav-badge').textContent()).trim(), '1');
  await page.click('.nav-item[href="#/together"]');
  await page.waitForSelector('.decision');
  assert.match(await page.locator('.together').textContent(), /מחכה לתשובה שלך/);
  const card = await page.locator('.decision').first().textContent();
  assert.match(card, /מכונת כביסה/);
  assert.match(card, /דני רוצה/);
  assert.match(card, /למה: הישנה נשברה/);
  assert.match(card, /בסוף .* בחשבון/);
  assert.match(card, /עוד לא ענה\/תה/);
  assert.match(await page.locator('.agreement').textContent(), /מעל ₪500 .*עד ₪400 בחודש בלי לשאול/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('"not now" needs a reason; the answer is saved and the partner is notified', async () => {
  const { page, db, notified } = await open();
  await page.click('.decision button:has-text("לענות")');
  await page.click('.vote-choice:has-text("לא עכשיו")');
  assert.equal(await page.locator('.sheet button[type="submit"]').isDisabled(), true, 'no reason yet');
  await page.fill('.sheet textarea', 'בואו נחכה לבונוס בדצמבר');
  await page.click('.sheet button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.deepEqual(db.tables.decision_votes.map((v) => [v.decision_id, v.user_id, v.vote, v.note]), [['d1', 'u1', 'not_now', 'בואו נחכה לבונוס בדצמבר']]);
  assert.equal(db.tables.shared_decisions[0].status, 'not_now');
  assert.deepEqual(notified, [{ decisionId: 'd1', event: 'answered' }]);
  // It moves to history, and the badge is gone.
  await page.waitForSelector('details.history');
  assert.equal(await page.locator('.nav-badge').count(), 0);
  await page.close();
});

test('approving adds the purchase to the plan; when the transaction shows up it can be closed as bought', async () => {
  const { page, db } = await open({ prep: (db) => db.tables.transactions.push({ id: 'tx-wm', household_id: 'h1', type: 'expense', amount: 2390, description: 'מחסני חשמל', tx_date: iso(new Date()), category_id: 'home', created_at: new Date().toISOString() }) });
  await page.click('.decision button:has-text("לענות")');
  await page.click('.vote-choice:has-text("מאשר/ת")');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.decision.st-approved');
  const d = db.tables.shared_decisions[0];
  assert.equal(d.status, 'approved');
  const goal = db.tables.goals.find((g) => g.id === d.goal_id);
  assert.equal(goal.name, 'מכונת כביסה');
  assert.equal(goal.target_amount, 2400);
  assert.match(await page.locator('.decision').textContent(), /נראה שזה נקנה: מחסני חשמל/);
  await page.click('.decision-match button:has-text("כן, לסגור")');
  await page.waitForSelector('details.history');
  assert.equal(db.tables.shared_decisions[0].status, 'bought');
  assert.equal(db.tables.shared_decisions[0].transaction_id, 'tx-wm');
  assert.equal(db.tables.goals.some((g) => g.id === d.goal_id), false, 'the planned line is replaced by the real transaction');
  await page.close();
});

test('opening a card: what, how much, when, why; the effect shows before sending; the partner is notified', async () => {
  const { page, db, notified } = await open({ cards: false });
  await page.waitForSelector('.together');
  assert.match(await page.locator('.together').textContent(), /עוד אין כרטיסים/);
  await page.click('button:has-text("אני רוצה לקנות משהו")');
  await page.fill('.sheet input[placeholder^="למשל: מכונת"]', 'אופניים חשמליים');
  await page.fill('.sheet input[inputmode="decimal"]', '300');
  assert.match(await page.locator('.sheet').textContent(), /מתחת ל-₪500 שסיכמתם/);
  await page.fill('.sheet input[inputmode="decimal"]', '4500');
  await page.click('.sheet .seg button:has-text("בחודש הבא")');
  await page.selectOption('.sheet select', 'car');
  await page.fill('.sheet textarea', 'לנסוע לעבודה בלי רכב');
  await page.waitForSelector('.sheet .decision-impact');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.decision');
  const row = db.tables.shared_decisions[0];
  assert.deepEqual([row.title, row.amount, row.category_id, row.note, row.created_by, row.household_id], ['אופניים חשמליים', 4500, 'car', 'לנסוע לעבודה בלי רכב', 'u1', 'h1']);
  const next = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0);
  assert.equal(row.wanted_by, `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`);
  assert.deepEqual(notified, [{ decisionId: row.id, event: 'opened' }]);
  assert.match(await page.locator('.together').textContent(), /מחכה לתשובה/);
  assert.match(await page.locator('.decision').textContent(), /דני: עוד לא ענה\/תה/);
  // The opener can withdraw.
  await page.click('.decision button:has-text("לבטל את הבקשה")');
  await page.waitForSelector('details.history');
  assert.equal(db.tables.shared_decisions[0].status, 'withdrawn');
  await page.close();
});

test('the agreement can be changed together', async () => {
  const { page, db } = await open();
  await page.click('.agreement button:has-text("לשנות")');
  await page.fill('.sheet input >> nth=0', '800');
  await page.fill('.sheet input >> nth=1', '');
  await page.click('.sheet button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.agreement').textContent.includes('₪800'));
  assert.equal(db.tables.households[0].decision_threshold, 800);
  assert.equal(db.tables.households[0].personal_allowance, null);
  assert.doesNotMatch(await page.locator('.agreement').textContent(), /בלי לשאול/);
  await page.close();
});

test('alone in the household: an invite instead of answers', async () => {
  const { page } = await open({ partner: false, cards: false });
  await page.waitForSelector('.together');
  assert.match(await page.locator('.together').textContent(), /עובד כששניכם באפליקציה/);
  await page.close();
});

test('the advisor knows what is being decided', async () => {
  const { page } = await open();
  const asked = [];
  await page.route('**/api/ai/advice-chat-stream', (r) => { asked.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"delta":"כדאי."}\n\ndata: {"done":true}\n\n' }); });
  await page.waitForSelector('.decision');
  await page.click('.ask-fab');
  await page.click('.adv .chip:has-text("אפשר להרשות את מה שמחכה לאישור?")');
  await page.waitForSelector('.adv-msg.ai:has-text("כדאי.")');
  assert.deepEqual(asked[0].summary.sharedDecisions, [{ title: 'מכונת כביסה', amount: 2400, wantedBy: null, status: 'open' }]);
  assert.equal(asked[0].summary.screen, 'together');
  await page.close();
});

test('desktop: the tab and its badge in the sidebar', async () => {
  const { page, errors } = await open({ width: 1280 });
  await page.waitForSelector('.side-item[href="#/together"] .nav-badge');
  await page.waitForSelector('.decision');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the profile has a notifications switch for this device', async () => {
  const { page } = await open({ hash: '#/home' });
  await page.waitForSelector('.hero');
  await page.click('.topbar .icon-btn');
  await page.waitForSelector('text=התראות');
  assert.match(await page.locator('.sheet').textContent(), /התראות(כבויות|פועלות|נחסמו|הדפדפן הזה)/);
  await page.close();
});

test('mobile bar: the "+" stays in the exact middle, all five tabs on one row', async () => {
  const { page } = await open({ hash: '#/home' });
  await page.waitForSelector('.hero');
  const add = await page.locator('.nav-add').boundingBox();
  const vw = page.viewportSize().width;
  assert.ok(Math.abs(add.x + add.width / 2 - vw / 2) <= 2, 'plus centered: ' + (add.x + add.width / 2));
  const items = await page.locator('.bottom-nav .nav-item').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: Math.round(r.top), w: r.width, href: e.getAttribute('href') }; }));
  assert.equal(items.length, 5);
  assert.equal(new Set(items.map((i) => i.y)).size, 1, 'one row');
  assert.ok(items.every((i) => i.w >= 44), 'each tab is tappable');
  // RTL: home and money on the right of the plus, together/plans/assets on the left.
  const xs = await page.locator('.bottom-nav .nav-item').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
  assert.ok(xs[0] > add.x && xs[1] > add.x && xs[2] < add.x && xs[4] < add.x);
  assert.deepEqual(items.map((i) => i.href), ['#/home', '#/money', '#/together', '#/plans', '#/assets']);
  await page.close();
});
