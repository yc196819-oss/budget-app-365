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

test('a new household in one screen: a name and alone/together, then straight to the first step at home', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = newUserDb();
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.waitForSelector('text=רק שתי שאלות, ומתחילים');
  // No name, no start.
  const go = page.locator('.onb button:has-text("יאללה, מתחילים")');
  assert.equal(await go.isDisabled(), true);
  // "Together" is the default, and says the invite comes later.
  assert.match(await page.locator('main').textContent(), /נשלח לכם קישור הזמנה/);
  await page.click('.seg button:has-text("לבד")');
  assert.doesNotMatch(await page.locator('main').textContent(), /נשלח לכם קישור הזמנה/);
  await page.click('.seg button:has-text("ביחד")');
  await page.fill('input[autocomplete="given-name"]', 'יוסי');
  await go.click();

  // Home opens at the first step: the statements of 6 months, from every card.
  await page.waitForSelector('.setup-guide >> text=בואו נסדר לכם את התמונה');
  const open = await page.locator('.setup-guide .guide-step.open').textContent();
  assert.match(open, /מעלים פירוטי אשראי של 6 חודשים/);
  assert.match(open, /מכל כרטיסי האשראי/);
  assert.match(open, /כמה כרטיסים או כמה חשבונות בנק/);

  const t = db.tables;
  assert.equal(t.households.length, 1);
  assert.equal(t.households[0].name, 'משק הבית של יוסי');
  const hid = t.households[0].id;
  assert.deepEqual(t.memberships.map((m) => [m.user_id, m.household_id, m.role, m.display_name]), [['u1', hid, 'owner', 'יוסי']]);
  // The full default categories, with car and subscriptions.
  const roots = t.categories.filter((c) => !c.parent_id);
  for (const n of ['אוכל', 'בית ודיור', 'בריאות', 'פנאי ובידור', 'רכב', 'מנויים', 'משכורת']) assert.ok(roots.some((c) => c.name === n), n);
  assert.ok(t.categories.filter((c) => c.parent_id).every((c) => roots.some((r) => r.id === c.parent_id)));
  assert.ok(t.categories.every((c) => c.household_id === hid));
  // One bank account; no made-up card, budget, income or goal: those are asked later.
  assert.equal(t.bank_accounts.length, 1);
  assert.deepEqual([t.credit_cards.length, t.category_budgets.length, (t.goals || []).length], [0, 0, 0]);
  assert.equal(t.households[0].income_expectations, undefined);
  // The advisor is on.
  assert.notEqual(await page.evaluate(() => localStorage.getItem('ai:off')), '1');
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
  await page.waitForSelector('text=רק שתי שאלות, ומתחילים');
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
  await page.check('.terms-check input');
  await page.click('form .btn');
  await page.waitForSelector('text=שלחנו מייל לאימות');
  assert.equal(sent[0].email, 'dani@example.com');
  assert.equal(sent[0].data.display_name, 'דני');
  assert.equal(sent[0].data.invite_code, 'abc123');
  assert.equal(sent[0].data.terms_version, '2026-10', 'the terms confirmed at sign-up');
  await page.close();
});

test('the main address opens the app, with no link to the old version', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockSupabase(page, newUserDb());
  await page.goto(server.base + '/');
  await page.waitForSelector('.login');
  assert.equal(new URL(page.url()).pathname, '/app/');
  assert.equal(await page.locator('a[href="/old/"]').count(), 0);
  await page.close();
});

test('a password-reset link asks for a new password', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const db = makeFakeDb();
  const updates = [];
  await mockSupabase(page, db);
  await page.route('**/auth/v1/user**', (r) => {
    if (r.request().method() === 'PUT') updates.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'yossi@example.com', aud: 'authenticated', user_metadata: { terms_version: '2026-10' } }) });
  });
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#type=recovery');
  await page.reload();
  await page.waitForSelector('text=סיסמה חדשה');
  await page.fill('input[type="password"]', 'new-password-1');
  await page.click('text=לשמור ולהיכנס');
  await page.waitForSelector('.hero');
  assert.equal(updates[0].password, 'new-password-1');
  await page.close();
});

test('sign in with Google: the button is there, and Google returns to the main address', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockSupabase(page, newUserDb());
  await page.goto(server.base + '/app/');
  await page.waitForSelector('.login');
  assert.match(await page.locator('.btn-google').textContent(), /כניסה עם Google/);
  await page.click('.seg button:has-text("הרשמה")');
  assert.match(await page.locator('.btn-google').textContent(), /הרשמה עם Google/);
  const req = page.waitForRequest((r) => r.url().includes('/auth/v1/authorize'));
  await page.click('.btn-google');
  const url = new URL((await req).url());
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('redirect_to'), server.base + '/');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  await page.close();
});

test('coming back from Google to the main address keeps the sign-in in the URL on the way to /app/', async () => {
  const page = await browser.newPage();
  await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const res = [];
  page.on('response', (r) => { if (r.url().startsWith(server.base)) res.push([r.status(), r.url()]); });
  await page.goto(server.base + '/?code=abc#state=1', { waitUntil: 'commit' });
  assert.deepEqual(res[0], [302, server.base + '/?code=abc']);
  assert.match(page.url(), /\/app\/\?code=abc#state=1$/);
  await page.close();
});
