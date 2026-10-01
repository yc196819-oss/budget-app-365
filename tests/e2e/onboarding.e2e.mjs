import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// A signed-in person with no household yet.
function newUserDb() {
  const db = makeFakeDb();
  for (const k of Object.keys(db.tables)) db.tables[k] = [];
  db.tables.households = [];
  db.tables.invites = [];
  return db;
}

async function rpc(page, db, handlers) {
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = JSON.parse(route.request().postData() || '{}');
    const h = handlers[name];
    if (!h) return route.fulfill({ status: 404, body: '{}' });
    const out = h(body, db);
    return route.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.body) });
  });
}

test('a new household in five steps: everything is created in the shared tables', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = newUserDb();
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.waitForSelector('text=מתחילים · 2 דקות');
  await page.click('text=מתחילים · 2 דקות');
  // 1: who
  assert.equal(await page.locator('.onb .btn:has-text("המשך")').isDisabled(), true);
  await page.fill('input[autocomplete="given-name"]', 'יוסי');
  await page.fill('input[placeholder="נשלח הזמנה בסוף"]', 'דני');
  await page.click('text=המשך');
  // 2: life
  await page.click('.chip:has-text("ילדים")');
  await page.click('text=המשך');
  // 3: cards
  await page.fill('input[aria-label="4 ספרות אחרונות"]', '4821');
  await page.click('.chip:has-text("ה-15")');
  await page.click('text=+ עוד כרטיס');
  await page.locator('input[aria-label="שם הכרטיס"]').nth(1).fill('דיירקט');
  await page.locator('.seg').nth(1).locator('button:has-text("חיוב מיידי")').click();
  await page.click('text=המשך');
  // 4: money
  await page.fill('input[aria-label="הכנסה חודשית נטו"]', '15000');
  await page.fill('input[aria-label="שכירות או משכנתא"]', '5000');
  await page.fill('input[aria-label="גן או מסגרות"]', '1800');
  await page.click('.chip:has-text("₪1,000")');
  assert.match(await page.locator('.card:has-text("נשאר למחיה בחודש")').textContent(), /₪7,200/);
  await page.click('text=המשך');
  // 5: privacy
  await page.locator('input[aria-label="יועץ AI"]').uncheck();
  await page.click('text=סיום');
  await page.waitForSelector('text=יוסי, הכול מוכן');

  const t = db.tables;
  assert.equal(t.households.length, 1);
  assert.equal(t.households[0].name, 'יוסי ודני');
  assert.deepEqual(t.households[0].income_expectations, [{ label: 'הכנסה חודשית נטו', amount: 15000 }]);
  const hid = t.households[0].id;
  assert.deepEqual(t.memberships.map((m) => [m.user_id, m.household_id, m.role, m.display_name]), [['u1', hid, 'owner', 'יוסי']]);
  const roots = t.categories.filter((c) => !c.parent_id);
  assert.ok(roots.some((c) => c.name === 'ילדים') && roots.some((c) => c.name === 'רכב'));
  assert.ok(t.categories.filter((c) => c.parent_id).every((c) => roots.some((r) => r.id === c.parent_id)));
  assert.ok(t.categories.every((c) => c.household_id === hid));
  assert.equal(t.bank_accounts.length, 1);
  assert.deepEqual(t.credit_cards.map((c) => [c.name, c.last4, c.billing_day]), [['ויזה', '4821', 15], ['דיירקט', null, null]]);
  const budgetOf = (name) => t.category_budgets.find((b) => b.category_id === roots.find((r) => r.name === name).id)?.monthly_amount;
  assert.equal(budgetOf('בית ודיור'), 5000);
  assert.equal(budgetOf('ילדים'), 1800);
  assert.equal(budgetOf('אוכל'), 4300);
  assert.deepEqual(t.goals.map((g) => [g.name, g.target_amount]), [['קרן חירום', 42000]]);

  // Invite the partner from the summary.
  await page.click('text=הזמנת דני');
  await page.waitForSelector('input[aria-label="קישור הזמנה"]');
  const link = await page.inputValue('input[aria-label="קישור הזמנה"]');
  assert.equal(t.invites.length, 1);
  assert.equal(link, server.base + '/app/?invite=' + t.invites[0].code);
  assert.equal(t.invites[0].household_id, hid);

  await page.click('text=להיכנס לאפליקציה');
  await page.waitForSelector('text=עוד אין תנועות');
  // The AI switch from step 5 is applied.
  assert.equal(await page.evaluate(() => localStorage.getItem('ai:off')), '1');
  assert.deepEqual(errors, []);
  await page.close();
});

test('an invite link: join the partner\'s household with one tap', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = newUserDb();
  const full = makeFakeDb();
  const joined = [];
  await mockSupabase(page, db);
  await rpc(page, db, {
    get_invite_info: (b) => ({ body: [{ valid: b.p_code === 'abc123', reason: b.p_code === 'abc123' ? 'ok' : 'invalid', household_name: 'יוסי ודני', inviter_name: 'יוסי' }] }),
    accept_household_invite: (b, d) => {
      joined.push(b.p_code);
      d.tables.memberships.push({ household_id: 'h1', user_id: 'u1', display_name: 'דני', role: 'member', created_at: '2026-10-01' });
      Object.assign(d.tables, { transactions: full.tables.transactions, categories: full.tables.categories });
      return { body: [{ household_id: 'h1', role: 'member' }] };
    }
  });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/?invite=abc123');
  await page.waitForSelector('text=יוסי מזמין/ה אתכם להצטרף');
  assert.equal(new URL(page.url()).search, '', 'the code is taken off the address');
  await page.click('button:has-text("להצטרף")');
  await page.waitForSelector('.hero');
  assert.deepEqual(joined, ['abc123']);
  assert.equal(await page.evaluate(() => localStorage.getItem('pendingInvite')), '');
  await page.close();
});

test('a used or invalid invite says why, and lets the person open their own household', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = newUserDb();
  await mockSupabase(page, db);
  await rpc(page, db, { get_invite_info: () => ({ body: [{ valid: false, reason: 'used', household_name: 'x', inviter_name: 'y' }] }) });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/?invite=old');
  await page.waitForSelector('text=לא ניתן להצטרף');
  assert.match(await page.locator('main').textContent(), /כבר נוצל/);
  await page.click('text=לפתוח משק בית משלי');
  await page.waitForSelector('text=מתחילים · 2 דקות');
  await page.close();
});

test('sign-up: name, email and password; the invite code travels with it', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const sent = [];
  await mockSupabase(page, newUserDb());
  await page.route('**/auth/v1/signup**', (r) => {
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u9', email: 'dani@example.com', aud: 'authenticated', identities: [{}] }) });
  });
  await page.goto(server.base + '/app/?invite=abc123');
  await page.waitForSelector('.login');
  // Coming from an invite link, sign-up is already selected.
  assert.equal(await page.locator('.seg button[aria-pressed="true"]').textContent(), 'הרשמה');
  await page.fill('input[autocomplete="given-name"]', 'דני');
  await page.fill('input[type="email"]', 'dani@example.com');
  await page.fill('input[type="password"]', 'short');
  await page.click('form .btn');
  assert.match(await page.locator('[role="alert"]').textContent(), /8 תווים/);
  await page.fill('input[type="password"]', 'long-enough-1');
  await page.click('form .btn');
  await page.waitForSelector('text=שלחנו מייל לאימות');
  assert.equal(sent[0].email, 'dani@example.com');
  assert.equal(sent[0].data.display_name, 'דני');
  assert.equal(sent[0].data.invite_code, 'abc123');
  await page.close();
});
