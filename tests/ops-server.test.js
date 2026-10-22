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
