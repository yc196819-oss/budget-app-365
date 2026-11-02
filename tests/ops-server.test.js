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
