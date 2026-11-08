const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanErrors, cleanEvents, stats, sessionCache, tokenExp } = require('../server/ops');

test('failure reports are trimmed, capped at 20, and empty ones dropped', () => {
  const rows = cleanErrors([{ message: '  x\n  failed ', stack: 's'.repeat(9000), path: '#/home' }, { message: '' }, 'junk', null], { userId: 'u1', agent: 'UA' });
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], detail: rows[0].detail.length }, { user_id: 'u1', source: 'client', message: 'x failed', detail: 4000, path: '#/home', agent: 'UA' });
  assert.equal(cleanErrors(Array.from({ length: 40 }, () => ({ message: 'm' }))).length, 20);
  assert.deepEqual(cleanErrors('nope'), []);
});

test('only known event names are kept, and only for a signed-in person', () => {
  assert.deepEqual(cleanEvents(['tx_add', 'drop table', 'export'], { userId: 'u1', householdId: 'h1' }),
    [{ user_id: 'u1', household_id: 'h1', name: 'tx_add' }, { user_id: 'u1', household_id: 'h1', name: 'export' }]);
  assert.deepEqual(cleanEvents(['tx_add'], { userId: null }), []);
  assert.equal(cleanEvents(Array(80).fill('app_open'), { userId: 'u1' }).length, 50);
});

test('the dashboard: active people, who came back after a week, what is used, what broke', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
  const events = [
    { user_id: 'a', name: 'app_open', at: ago(0.1) },
    { user_id: 'a', name: 'tx_add', at: ago(20) },
    { user_id: 'b', name: 'app_open', at: ago(3) },
    { user_id: 'c', name: 'app_open', at: ago(15) },
    { user_id: 'c', name: 'tx_add', at: ago(12) } // back after 3 days only
  ];
  const errors = [{ message: 'boom', path: '#/a', at: ago(1) }, { message: 'boom', path: '#/a', at: ago(2) }, { message: 'old', at: ago(9) }];
  const s = stats({ events, errors, now });
  assert.deepEqual(s.active, { day: 1, week: 2, month: 3 });
  assert.deepEqual(s.retention, { started: 2, cameBack: 1, pct: 50 });
  assert.deepEqual(s.use, [{ name: 'app_open', count: 3 }, { name: 'tx_add', count: 2 }]);
  assert.equal(s.errors.week, 2);
  assert.deepEqual(s.errors.top.map((e) => [e.message, e.count]), [['boom', 2]]);
  assert.equal(stats({ events: [], errors: [], now }).retention.pct, null);
});

test('a verified session is remembered for a short while, never past its expiry, and the memory is bounded', () => {
  const c = sessionCache({ ttl: 1000, max: 2 });
  c.set('t1', 'u1', 0, 0);
  assert.equal(c.get('t1', 500), 'u1');
  assert.equal(c.get('t1', 1000), null, 'ttl passed');
  c.set('t2', 'u2', 1, 0); // expires at 1s
  c.set('t3', 'u3', 2, 0);
  c.set('t4', 'u4', 10, 0);
  assert.equal(c.size, 2);
  assert.equal(c.get('t2', 0), null, 'oldest dropped');
  c.set('dead', 'u5', 1, 5000);
  assert.equal(c.get('dead', 5000), null, 'an expired token is not stored');
});

test('reads the expiry of a token without trusting it', () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(tokenExp(b({ alg: 'x' }) + '.' + b({ exp: 123 }) + '.sig'), 123);
  assert.equal(tokenExp('garbage'), null);
});

const { aiCallRow, costOf, alias, perUser } = require('../server/ops');

test('an AI call is kept as numbers only: who, which route and model, tokens', () => {
  assert.deepEqual(aiCallRow({ userId: 'u1', route: 'POST /api/ai/import', provider: 'claude', model: 'claude-haiku-5-5', inputTokens: 1200.4, outputTokens: -3 }),
    { user_id: 'u1', route: 'POST /api/ai/import', provider: 'claude', model: 'claude-haiku-5-5', input_tokens: 1200, output_tokens: 0 });
  assert.equal(aiCallRow({ provider: 'gemini' }).user_id, null);
});

test('cost per model: Haiku for files, Sonnet for the advisor; an unknown model counts at the Sonnet price', () => {
  assert.equal(costOf({ model: 'claude-haiku-5-5', input_tokens: 1e6, output_tokens: 1e6 }), 0.6);
  assert.equal(costOf({ model: 'claude-sonnet-5', input_tokens: 1e6, output_tokens: 1e6 }), 12);
  assert.equal(costOf({ provider: 'gemini', model: 'gemini-2.5-flash', input_tokens: 1e6, output_tokens: 0 }), 0.3);
  assert.equal(costOf({ model: 'mystery', input_tokens: 1e6, output_tokens: 0 }), 2);
});

test('activity per person: a label instead of who they are, counts and AI cost for 30 days, busiest first', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
  const out = perUser({
    now, salt: 's',
    users: [{ id: 'u1', created_at: '2026-10-28T19:00:00Z' }, { id: 'u2', created_at: '2026-10-29T07:00:00Z' }, { id: 'u3', created_at: '2026-10-30T07:00:00Z' }],
    events: [
      { user_id: 'u1', name: 'app_open', at: ago(1) }, { user_id: 'u1', name: 'import_done', at: ago(1) }, { user_id: 'u1', name: 'import_fail', at: ago(2) },
      { user_id: 'u1', name: 'advisor_ask', at: ago(0.5) }, { user_id: 'u2', name: 'app_open', at: ago(3) }, { user_id: 'u2', name: 'tx_add', at: ago(40) }
    ],
    calls: [
      { user_id: 'u1', provider: 'claude', model: 'claude-sonnet-5', input_tokens: 4000, output_tokens: 1000, at: ago(0.5) },
      { user_id: 'u1', provider: 'claude', model: 'claude-haiku-5-5', input_tokens: 20000, output_tokens: 16000, at: ago(1) },
      { user_id: null, provider: 'claude', model: 'claude-sonnet-5', input_tokens: 1e5, output_tokens: 0, at: ago(1) },
      { user_id: 'u2', provider: 'gemini', model: 'x', input_tokens: 1, output_tokens: 1, at: ago(45) }
    ]
  });
  const [a, b, c] = out.users;
  assert.equal(a.who, alias('u1', 's'));
  assert.match(a.who, /^#[0-9a-f]{6}$/);
  assert.ok(!JSON.stringify(out).includes('u1'), 'no ids in the answer');
  assert.deepEqual({ ...a, who: undefined }, { who: undefined, id: undefined, joined: '2026-10-28', lastSeen: ago(0.5).slice(0, 10), opens: 1, added: 0, imports: 1, importFails: 1, asked: 1, aiCalls: 2, tokens: 41000, cost: 0.028 });
  assert.equal(b.opens, 1);
  assert.equal(b.added, 0, 'older than 30 days');
  assert.equal(b.aiCalls, 0);
  assert.equal(c.lastSeen, null, 'signed up, never came back');
  assert.equal(out.systemCost30d, 0.2);
  assert.equal(out.aiCost30d, 0.23);
  assert.notEqual(alias('u1', 's'), alias('u1', 'other'), 'the label depends on a secret salt');
});

const { presenceStore, daily } = require('../server/ops');

test('online now: each open app once a minute; a person on two devices counts once; quiet for 2 minutes is gone', () => {
  const p = presenceStore();
  p.beat({ key: 'phone-a', userId: 'u1', screen: 'home', device: 'mobile', installed: true }, 0);
  p.beat({ key: 'laptop-a', userId: 'u1', screen: 'money', device: 'desktop' }, 1000);
  p.beat({ key: 'phone-b', userId: 'u2', screen: 'together' }, 2000);
  p.beat({ key: 'visitor', screen: 'login' }, 3000);
  p.beat({ key: 'odd', userId: 'u3', screen: '<script>' }, 3000);
  assert.deepEqual(p.snapshot(60000), { users: 3, visitors: 1, screens: { home: 1, together: 1, login: 1, other: 1 }, devices: { mobile: 4, desktop: 0 }, installed: 1 });
  assert.deepEqual(p.snapshot(125000), { users: 0, visitors: 0, screens: {}, devices: { mobile: 0, desktop: 0 }, installed: 0 });
});

test('the last 14 days: active people and AI cost per day, in Israel time', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  const d = daily({ now, events: [{ user_id: 'a', at: '2026-11-01T22:30:00Z' }, { user_id: 'a', at: '2026-11-02T08:00:00Z' }, { user_id: 'b', at: '2026-11-02T09:00:00Z' }, { user_id: 'c', at: '2026-10-01T09:00:00Z' }],
    calls: [{ model: 'claude-sonnet-5', input_tokens: 1e6, output_tokens: 0, at: '2026-11-02T09:00:00Z' }] });
  assert.equal(d.length, 14);
  assert.deepEqual(d[13], { day: '2026-11-02', active: 2, cost: 2 }, '22:30Z on Nov 1 is already Nov 2 in Israel');
  assert.equal(d[12].active, 0);
});

const { cleanFeedback, feedbackPatch } = require('../server/ops');

test('a request from a user: a known kind, trimmed text, nothing empty', () => {
  assert.deepEqual(cleanFeedback({ kind: 'bug', text: '  הייבוא נתקע  ', screen: 'money', device: 'טלפון' }, 'u1'),
    { user_id: 'u1', kind: 'bug', text: 'הייבוא נתקע', screen: 'money', device: 'טלפון' });
  assert.equal(cleanFeedback({ kind: 'hack', text: 'שלום רב' }, 'u1').kind, 'other');
  assert.equal(cleanFeedback({ text: ' a ' }, 'u1'), null);
  assert.equal(cleanFeedback({ text: 'שלום רב' }, null), null);
  assert.equal(cleanFeedback({ text: 'x'.repeat(5000) }, 'u1').text.length, 2000);
});

test('the owner changes a request: only a known status and an answer', () => {
  const p = feedbackPatch({ status: 'done', owner_note: ' תוקן, תודה! ', user_id: 'other', text: 'x' });
  assert.deepEqual(Object.keys(p).sort(), ['owner_note', 'status', 'updated_at']);
  assert.equal(p.owner_note, 'תוקן, תודה!');
  assert.equal(feedbackPatch({ status: 'deleted' }), null);
  assert.equal(feedbackPatch({}), null);
});

test("the owner's own accounts are left out of the list and the live count; their AI cost is given apart", () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const calls = [{ user_id: 'me', provider: 'anthropic', model: 'claude-sonnet-5', input_tokens: 1e6, output_tokens: 0, at: '2026-11-03T10:00:00Z' },
    { user_id: 'u2', provider: 'anthropic', model: 'claude-sonnet-5', input_tokens: 5e5, output_tokens: 0, at: '2026-11-03T10:00:00Z' }];
  const out = perUser({ users: [{ id: 'me', created_at: '2026-10-01' }, { id: 'u2', created_at: '2026-10-02' }], events: [{ user_id: 'me', name: 'app_open', at: '2026-11-03T10:00:00Z' }], calls, owners: ['me'], salt: 's', now });
  assert.equal(out.users.length, 1);
  assert.equal(out.users[0].aiCalls, 1);
  assert.ok(!JSON.stringify(out).includes('"me"'));
  // What is paid stays whole; the owner's part is shown apart.
  assert.equal(out.aiCost30d, 3);
  assert.equal(out.ownerCost30d, 2);
  const p = presenceStore();
  p.beat({ key: 'a', userId: 'me', screen: 'home' }, 0);
  p.beat({ key: 'b', userId: 'u2', screen: 'money' }, 0);
  assert.equal(p.snapshot(1000, ['me']).users, 1);
  assert.equal(p.snapshot(1000).users, 2);
});

const { reengageList, reengageMail, campaignList, campaignMail, mailReady, mailErrorText } = require('../server/ops');

test('one invitation back: signed up 2+ days ago, confirmed, no household, never invited, not the owner', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const u = (id, o = {}) => ({ id, email: id + '@x.com', email_confirmed_at: '2026-10-01', created_at: '2026-10-28T10:00:00Z', ...o });
  const list = reengageList({
    now, owners: ['boss@x.com'],
    users: [u('a'), u('b'), u('c'), u('d', { email_confirmed_at: null }), u('e', { created_at: '2026-11-01T20:00:00Z' }), u('boss')],
    members: [{ user_id: 'b' }], sent: [{ user_id: 'c' }]
  });
  assert.deepEqual(list.map((x) => x.id), ['a']);
  const m = reengageMail('https://app.example/app/');
  assert.equal(m.subject, 'בוא נראה יחד לאן הכסף שלך הולך');
  assert.doesNotMatch(m.text, /2 דקות/);
  assert.match(m.text, /פירוט אשראי של 6 החודשים האחרונים, מכל הכרטיסים/);
  assert.match(m.text, /https:\/\/app\.example\/app\//);
  assert.match(m.html, /הסר/);
});

test('each email goes to the people at its step of getting started, once each', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const u = (id, o = {}) => ({ id, email: id + '@x.com', email_confirmed_at: '2026-10-01', created_at: '2026-10-28T10:00:00Z', ...o });
  const args = {
    now, owners: ['boss@x.com'],
    users: [u('none'), u('empty'), u('few'), u('lots'), u('boss'), u('fresh', { created_at: '2026-11-02T08:00:00Z' }), u('gotit')],
    members: [{ user_id: 'empty', household_id: 'h1' }, { user_id: 'few', household_id: 'h2' }, { user_id: 'lots', household_id: 'h3' }, { user_id: 'boss', household_id: 'h2' }, { user_id: 'gotit', household_id: 'h2' }, { user_id: 'fresh', household_id: 'h1' }],
    spans: [{ household_id: 'h2', n: '40', months: '2' }, { household_id: 'h3', n: '500', months: '12' }],
    sent: [{ user_id: 'gotit', campaign: 'more' }, { user_id: 'none', campaign: 'more' }]
  };
  assert.deepEqual(campaignList('start', args).map((x) => x.id), ['none']);
  assert.deepEqual(campaignList('first', args).map((x) => x.id), ['empty'], 'opened a household, nothing uploaded');
  assert.deepEqual(campaignList('more', args).map((x) => x.id), ['few'], 'less than 6 months; the owner, the one already sent, and 12 months are left out');
  assert.equal(campaignList('nope', args).length, 0);
  const m = campaignMail('more', 'https://app.example/app/');
  assert.match(m.subject, /טיפ/);
  assert.match(m.text, /3 עד 6/);
  assert.match(m.text, /מכל כרטיסי האשראי/);
  assert.match(m.text, /מזומן/);
  assert.match(m.html, /✓<\/td><td[^>]*>[^<]*מכל כרטיסי האשראי/, 'the tips are a list in the email');
  assert.match(m.html, /src="https:\/\/app\.example\/wallet-192\.png"/, 'the logo comes from the app');
  assert.doesNotMatch(m.html, /<script|animation/i);
  const f = campaignMail('first', 'https://app.example/app/');
  assert.match(f.text, /מכל כרטיסי האשראי/);
  assert.match(f.text, /מזומן/);
  assert.match(m.html, /להוסיף עוד חודשים/);
  assert.match(m.html, /הסר/);
  assert.equal(campaignMail('nope', 'x'), null);
});

test('mail is ready with Brevo or a Resend sender of your own; not with SMTP (blocked on Render free) or Resend\'s test address', () => {
  assert.equal(mailReady({}).ready, false);
  assert.equal(mailReady({ smtp: true }).ready, false);
  assert.equal(mailReady({ brevo: true }).ready, true);
  assert.deepEqual(mailReady({ resendKey: 'k', resendFrom: 'Budget App <onboarding@resend.dev>' }), { ready: false, brevo: false, smtp: false, resend: false, resendTestOnly: true });
  assert.equal(mailReady({ resendKey: 'k', resendFrom: 'קובי <hi@budget.co.il>' }).ready, true);
});

test('why an email did not go, in words the owner can act on', () => {
  assert.match(mailErrorText(new Error('No email provider is configured')), /לא מחובר לשום שירות/);
  assert.match(mailErrorText(new Error('resend: You can only send testing emails to your own email address')), /Resend מוגדר רק במצב ניסיון/);
  assert.match(mailErrorText(new Error('smtp: Invalid login: 535-5.7.8 Username and Password not accepted')), /סיסמת האפליקציה של Gmail/);
  assert.match(mailErrorText(new Error('smtp: Connection timeout')), /חוסם שליחה דרך Gmail\/SMTP/);
  assert.match(mailErrorText(new Error('brevo: Sender is not valid')), /לאשר אותה ב-Brevo/);
  assert.match(mailErrorText(new Error('brevo: Key not found')), /מפתח ה-Brevo/);
  assert.match(mailErrorText(new Error('weird')), /השליחה נכשלה: weird/);
});

const { firstName, ownerAction, userAction, threadView } = require('../server/ops');

test('the owner sees a first name, never a username or an email', () => {
  assert.equal(firstName('יוסי כהן'), 'יוסי');
  assert.equal(firstName('Dana'), 'Dana');
  for (const n of ['yossi123', 'dani', 'a@b.com', '', null]) assert.equal(firstName(n), '');
});

test('owner actions: answer and close (default) or ask and keep open, a note, status, pin, unread', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const close = ownerAction({ message: ' תוקן ' }, now);
  assert.equal(close.message, 'תוקן');
  assert.deepEqual([close.row.closed, close.row.status, close.row.last_by], [true, 'done', 'owner']);
  const ask = ownerAction({ message: 'צילום מסך?', close: false }, now);
  assert.deepEqual([ask.row.closed, ask.row.status], [false, 'working']);
  assert.deepEqual(ownerAction({ note: 'לבדוק' }, now).note, 'לבדוק');
  assert.equal(ownerAction({ note: 'x' }, now).row.last_by, undefined, 'a note does not count as an answer');
  assert.equal(ownerAction({ pinned: true }, now).row.pinned, true);
  assert.equal(ownerAction({ unread: true }, now).row.owner_seen_at, null);
  assert.deepEqual([ownerAction({ status: 'wontfix' }, now).row.closed], [true]);
  assert.equal(ownerAction({ status: 'deleted' }, now), null);
  assert.equal(ownerAction({ user_id: 'x', text: 'y' }, now), null);
});

test('the person: a reply reopens a closed request once; "it helped" and "seen" write nothing else', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const re = userAction({ message: 'עדיין לא עובד' }, { closed: true, status: 'done' }, now);
  assert.deepEqual([re.reopened, re.row.closed, re.row.status, re.row.last_by], [true, false, 'new', 'user']);
  const more = userAction({ message: 'הנה צילום' }, { closed: false, status: 'working' }, now);
  assert.deepEqual([more.reopened, more.row.status], [false, 'working']);
  assert.deepEqual(Object.keys(userAction({ helped: true }, {}, now).row).sort(), ['helped', 'updated_at', 'user_seen_at']);
  assert.deepEqual(Object.keys(userAction({ seen: true }, {}, now).row), ['user_seen_at']);
  assert.equal(userAction({ message: ' ' }, {}, now), null);
  assert.equal(userAction({ status: 'done', closed: true }, {}, now), null, 'cannot close or change status');
});

test('a request as the owner sees it: first message, unread since last look, read by the person', () => {
  const f = { id: 'f', kind: 'bug', text: 'נתקע', status: 'working', created_at: '2026-11-01T10:00:00Z', owner_seen_at: '2026-11-01T11:00:00Z', user_seen_at: '2026-11-01T12:30:00Z', last_at: '2026-11-01T13:00:00Z', last_by: 'user' };
  const v = threadView(f, [
    { author: 'owner', text: 'צילום?', created_at: '2026-11-01T12:00:00Z' },
    { author: 'note', text: 'לבדוק', created_at: '2026-11-01T12:01:00Z' },
    { author: 'user', text: 'הנה', created_at: '2026-11-01T13:00:00Z' }
  ], { name: 'רון', label: '#abc' });
  assert.equal(v.who, 'רון');
  assert.equal(v.messages[0].text, 'נתקע');
  assert.equal(v.unread, 1);
  assert.equal(v.readByUser, true);
  assert.equal(threadView(f, [], { label: '#abc' }).who, '#abc');
});

const { healthOf, todayRows } = require('../server/ops');
test('how each person is doing: stuck, no statement, gone quiet, high AI use, little data, fine', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
  assert.equal(healthOf({ joined: ago(5), inHousehold: false, now }).label, 'נרשם ולא סיים הרשמה');
  assert.equal(healthOf({ joined: ago(5), inHousehold: true, txCount: 0, now }).label, 'לא העלה אף פירוט');
  assert.equal(healthOf({ joined: ago(60), lastSeen: ago(20), inHousehold: true, txCount: 300, months: 6, now }).level, 'gone');
  const ai = healthOf({ joined: ago(30), lastSeen: ago(1), inHousehold: true, txCount: 300, months: 6, cost: 3, medianCost: 0.2, now });
  assert.equal(ai.level, 'watch');
  assert.match(ai.reasons.join(), /צריכת AI גבוהה/);
  assert.equal(healthOf({ joined: ago(10), lastSeen: ago(1), inHousehold: true, txCount: 40, months: 1, now }).level, 'watch');
  assert.equal(healthOf({ joined: ago(30), lastSeen: ago(1), inHousehold: true, txCount: 400, months: 6, asked: 3, cost: 0.3, medianCost: 0.2, now }).label, 'משתמש פעיל, נעזר ביועץ');
});

test("today (Israel time): who came in, what they did, AI use and errors; yesterday's do not count", () => {
  const now = new Date('2026-11-04T15:00:00Z'); // 17:00 in Israel (winter, UTC+2)
  const rows = todayRows({
    now,
    users: [{ id: 'a', created_at: '2026-10-01T10:00:00Z' }, { id: 'b', created_at: '2026-11-04T08:00:00Z' }],
    events: [
      { user_id: 'a', name: 'app_open', at: '2026-11-04T10:34:00Z' }, { user_id: 'a', name: 'import_done', at: '2026-11-04T11:00:00Z' },
      { user_id: 'a', name: 'advisor_ask', at: '2026-11-04T14:27:00Z' }, { user_id: 'a', name: 'app_open', at: '2026-11-03T10:00:00Z' },
      { user_id: 'b', name: 'app_open', at: '2026-11-04T08:01:00Z' }
    ],
    calls: [{ user_id: 'a', model: 'claude-sonnet-5', input_tokens: 1e5, output_tokens: 0, at: '2026-11-04T14:27:10Z' }],
    errors: [{ user_id: 'b', at: '2026-11-04T08:02:00Z' }]
  });
  const a = rows.find((r) => r.id === 'a');
  assert.deepEqual([a.first, a.last, a.opens, a.imports, a.asked, a.aiCalls, a.cost], ['12:34', '16:27', 1, 1, 1, 1, 0.2]);
  const b = rows.find((r) => r.id === 'b');
  assert.deepEqual([b.newToday, b.errors], [true, 1]);
});

test("the owner's evening email: today's sentence, each person, requests waiting, a link to the dashboard", () => {
  const { ownerDigestMail } = require('../server/ops');
  const items = [
    { name: 'דנה', newToday: true, opens: 1, imports: 0, importFails: 1, cost: 0, health: { level: 'stuck', label: 'לא העלה אף פירוט' } },
    { name: '', who: '#a1b2c3', opens: 2, imports: 1, asked: 3, cost: 0.4, health: { level: 'good', label: 'משתמש פעיל' } }
  ];
  const m = ownerDigestMail({ day: '2026-11-04', summary: 'היום נכנסו 2 משתמשים.', items, waiting: 1, link: 'https://example.test/app/' });
  assert.equal(m.subject, 'היום: 2 משתמשים נכנסו, אחד צריך עזרה, פנייה אחת מחכה');
  assert.match(m.text, /04\.11\.2026/);
  assert.match(m.text, /• דנה \(חדש היום\): כניסה אחת · פירוט אחד נכשל · לא העלה אף פירוט/);
  assert.match(m.text, /• בלי שם #a1b2c3: 2 כניסות · פירוט אחד · 3 שאלות ליועץ · AI \$0\.40/);
  assert.match(m.html, /פנייה אחת מחכה לתשובה/);
  assert.match(m.html, /https:\/\/example\.test\/app\/\?go=profile\/admin#\/home/);
  assert.doesNotMatch(m.html, /@/);
  const quiet = ownerDigestMail({ day: '2026-11-04', summary: 'היום עוד אף אחד לא נכנס (חוץ ממך).', items: [], waiting: 0, link: 'https://example.test/app/' });
  assert.equal(quiet.subject, 'היום: אף אחד לא נכנס');
  // Names are escaped.
  assert.match(ownerDigestMail({ day: '2026-11-04', summary: '', items: [{ name: '<b>x', opens: 1 }], link: 'https://example.test/app/' }).html, /&lt;b&gt;x/);
});

test("Israel's clock in winter and summer: the evening email's 23:45 and today's day", () => {
  const { israelClock } = require('../server/ops');
  assert.deepEqual(israelClock(new Date('2026-11-04T21:45:00Z')), { day: '2026-11-04', hm: '23:45', hour: 23 });
  assert.deepEqual(israelClock(new Date('2026-07-04T20:45:00Z')), { day: '2026-07-04', hm: '23:45', hour: 23 });
  assert.equal(israelClock(new Date('2026-11-04T20:45:00Z')).hour, 22);
  assert.equal(israelClock(new Date('2026-07-04T21:45:00Z')).day, '2026-07-05');
});

test('getting-started emails: a one-click link to stop them, and whoever stopped is skipped', () => {
  const { campaignMail, campaignList, campaignStats, unsubToken, unsubOk } = require('../server/ops');
  const m = campaignMail('first', 'https://app.example/app/', 'https://app.example/unsubscribe?u=a&t=b&k=news');
  assert.match(m.html, /לא רוצה לקבל עוד מיילים כאלה\? <a href="https:\/\/app\.example\/unsubscribe\?u=a&amp;t=b&amp;k=news"[^>]*>להסרה לחץ כאן<\/a>/);
  assert.match(m.text, /להסרה: https:\/\/app\.example\/unsubscribe/);
  assert.doesNotMatch(m.html, /תענה "הסר"/);
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  const users = [{ id: 'u1', email: 'a@example.test', email_confirmed_at: old, created_at: old }, { id: 'u2', email: 'b@example.test', email_confirmed_at: old, created_at: old }];
  assert.deepEqual(campaignList('start', { users, stopped: ['u2'] }).map((u) => u.id), ['u1']);
  // A link stops one kind for one person.
  const id = '3f1c2b4a-1111-2222-3333-444455556666';
  const t = unsubToken(id, 's', 'news');
  assert.equal(unsubOk(id, t, 's', 'news'), true);
  assert.equal(unsubOk(id, t, 's', 'monthly'), false);
  assert.equal(unsubOk(id, t, 's', 'other'), false);
  assert.equal(unsubToken(id, 's'), unsubToken(id, 's', 'monthly'), 'old monthly links keep working');
  // What the dashboard shows.
  const st = campaignStats([
    { campaign: 'start', ok: true, sent_at: '2026-11-04T19:28:00Z' }, { campaign: 'start', sent_at: '2026-11-04T19:29:00Z' },
    { campaign: 'start', ok: false, sent_at: '2026-11-03T10:00:00Z' }, { campaign: 'monthly-2026-10', ok: true }
  ], ['x', 'y']);
  assert.deepEqual(st, { byCampaign: { start: { sent: 2, failed: 1, last: '2026-11-04T19:29:00Z' } }, stopped: 2 });
});

test("a person's share code: stable, 6 hex, and not their dashboard label", () => {
  const { refCode, alias } = require('../server/ops');
  const id = '3f1c2b4a-1111-2222-3333-444455556666';
  assert.match(refCode(id, 's'), /^[0-9a-f]{6}$/);
  assert.equal(refCode(id, 's'), refCode(id, 's'));
  assert.notEqual('#' + refCode(id, 's'), alias(id, 's'));
});

test("the owner sees who shared and how many joined through each one; the owner's own apart", () => {
  const { shareStats, refCode } = require('../server/ops');
  const users = [{ id: 'a' }, { id: 'b' }, { id: 'me' }];
  const events = [{ user_id: 'a', name: 'share' }, { user_id: 'a', name: 'share' }, { user_id: 'b', name: 'app_open' }, { user_id: 'me', name: 'share' }];
  const referrals = [{ ref_code: refCode('a', 's') }, { ref_code: refCode('me', 's') }, { ref_code: refCode('me', 's') }, { ref_code: 'ffffff' }];
  const r = shareStats({ users, events, referrals, salt: 's', owners: ['me'] });
  assert.deepEqual(r.byUser.get('a'), { shares: 2, friends: 1 });
  assert.deepEqual(r.byUser.get('b'), { shares: 0, friends: 0 });
  assert.equal(r.byUser.has('me'), false);
  assert.deepEqual(r.totals, { shares: 2, friends: 1, sharers: 1, mine: { shares: 1, friends: 2 } });
});

test("the owner's AI draft: by where things stand, from his gist, the conversation and the guide; notes stay out", () => {
  const { draftPrompt } = require('../server/ops');
  const p = draftPrompt({ status: 'fixed', hint: 'תיקנו את הקטגוריות', kind: 'bug', name: 'רון', guide: 'מדריך: פרופיל ← תקלות',
    messages: [{ author: 'user', text: 'אין לי קטגוריות' }, { author: 'note', text: 'סוד פנימי' }, { author: 'owner', text: 'בודקים' }] });
  assert.match(p, /התקלה תוקנה/);
  assert.match(p, /תיקנו את הקטגוריות/);
  assert.match(p, /רון: אין לי קטגוריות/);
  assert.match(p, /אנחנו: בודקים/);
  assert.match(p, /מדריך: פרופיל/);
  assert.doesNotMatch(p, /סוד פנימי/, 'internal notes are not sent to the AI');
  assert.equal(draftPrompt({ status: 'whatever', messages: [] }), null);
  for (const s of ['working', 'explain', 'idea', 'more']) assert.ok(draftPrompt({ status: s, messages: [] }), s);
});

test('the draft checks the request against what changed and what the person\'s data shows', () => {
  const { draftPrompt, readDraft } = require('../server/ops');
  const p = draftPrompt({ status: 'fixed', kind: 'bug', messages: [{ author: 'user', text: 'אין קטגוריות' }], askedAt: '2026-11-04T23:09:00Z',
    changes: [{ date: '2026-11-05', text: 'תיקון: קטגוריות למשק בית בלי קטגוריות' }], facts: ['קטגוריות במשק הבית: 14.'] });
  assert.match(p, /2026-11-05: תיקון: קטגוריות/);
  assert.match(p, /קטגוריות במשק הבית: 14/);
  assert.match(p, /הפנייה נשלחה ב-2026-11-04/);
  assert.match(p, /"fixed":"yes\|no\|unknown"/);
  assert.deepEqual(readDraft('```json\n{"fixed":"yes","why":"תוקן ב-05.11","text":"היי, תיקנו"}\n```'), { text: 'היי, תיקנו', fixed: 'yes', why: 'תוקן ב-05.11' });
  assert.deepEqual(readDraft('{"fixed":"maybe","text":"היי"}'), { text: 'היי', fixed: 'unknown', why: '' });
  assert.deepEqual(readDraft('סתם טקסט'), { text: 'סתם טקסט', fixed: 'unknown', why: '' }, 'plain text still becomes a draft');
});

test('the list of changes: dated, newest first, in plain words', () => {
  const changes = require('../server/changes');
  assert.ok(changes.length > 5);
  for (const c of changes) { assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(c.text.length > 10); }
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i - 1].date >= changes[i].date, 'newest first');
});

test('a picture with a request: only a real PNG, JPEG or WebP, under the size limit', () => {
  const { feedbackImage, IMAGE_PATH } = require('../server/ops');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
  const ok = feedbackImage('data:image/png;base64,' + png.toString('base64'));
  assert.equal(ok.type, 'image/png');
  assert.equal(ok.ext, 'png');
  assert.equal(feedbackImage('data:image/jpeg;base64,' + png.toString('base64')), null, 'says JPEG, is a PNG');
  assert.equal(feedbackImage('data:text/html;base64,PGI+aGk8L2I+'), null);
  assert.equal(feedbackImage('data:image/png;base64,' + Buffer.from('<svg onload=x>').toString('base64')), null, 'not a picture inside');
  const big = Buffer.concat([png, Buffer.alloc(1.6 * 1024 * 1024)]);
  assert.equal(feedbackImage('data:image/png;base64,' + big.toString('base64')), null, 'too big');
  assert.equal(feedbackImage(null), null);
  assert.ok(IMAGE_PATH.test('11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg'));
  assert.ok(!IMAGE_PATH.test('../secrets/x.jpg'));
  assert.ok(!IMAGE_PATH.test('11111111-1111-1111-1111-111111111111/a.svg'));
});
