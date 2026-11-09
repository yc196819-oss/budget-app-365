const { test } = require('node:test');
const assert = require('node:assert/strict');
const { feed, askFacts, askPrompt } = require('../server/insights');

const now = new Date('2026-03-10T12:00:00Z');
const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();

test('the feed shows the newest meaningful moments with first names, newest first', () => {
  const rows = feed({
    now,
    users: [{ id: 'a', created_at: ago(30) }, { id: 'old', created_at: ago(60 * 24 * 5) }],
    events: [
      { user_id: 'b', name: 'import_done', at: ago(5) },
      { user_id: 'b', name: 'app_open', at: ago(6) },
      { user_id: 'c', name: 'import_fail_password', at: ago(50) }
    ],
    nameOf: (id) => ({ a: 'דנה', b: 'יוסי' })[id] || ''
  });
  assert.deepEqual(rows.map((r) => [r.who, r.what, r.kind]), [
    ['יוסי', 'העלה/תה פירוט', 'data'],
    ['דנה', 'נרשם/ה', 'join'],
    ['משתמש/ת', 'נכשל/ה בהעלאה', 'fail']
  ]);
});

test('the same person doing the same thing a few times in a row is one line', () => {
  const rows = feed({ now, events: [1, 2, 3, 4].map((m) => ({ user_id: 'b', name: 'shop_add', at: ago(m) })) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].what, 'הוסיף/ה לרשימת הקניות (4 פעמים)');
});

test('the feed keeps only the last two days and at most the limit', () => {
  const events = Array.from({ length: 30 }, (_, i) => ({ user_id: 'u' + i, name: 'tx_add', at: ago(i * 20) }));
  events.push({ user_id: 'z', name: 'tx_add', at: ago(60 * 49) });
  const rows = feed({ now, events, limit: 10 });
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.who === 'משתמש/ת'));
});

test('only totals go to the AI: no names, ids or emails', () => {
  const s = {
    active: { day: 3, week: 9, month: 20 }, signedUp: 40, members: 12,
    retention: { pct: 15, cameBack: 4, started: 26 },
    funnel: { signups: 40, household: 20, tx: 13, import: 13, cameBack: 4, byDay: { '2026-03-10': 2 } },
    daily: [{ day: '2026-03-10', active: 3, cost: 0.12 }],
    users: [{ who: '#abc123', name: 'דנה', email: 'someone@example.com' }],
    use: [{ name: 'tx_add', count: 9 }]
  };
  const facts = askFacts(s);
  const text = JSON.stringify(facts);
  assert.ok(!text.includes('דנה') && !text.includes('@') && !text.includes('#abc123'));
  assert.equal(facts.retention.pct, 15);
  assert.deepEqual(facts.daily, [{ day: '2026-03-10', active: 3, aiCostUsd: 0.12 }]);
  assert.equal(facts.funnel30d.byDay, undefined);
});

test('the question is trimmed and a too-short one is refused', () => {
  assert.equal(askPrompt('  ', {}), null);
  const p = askPrompt('כמה   נרשמו השבוע?\n', { active: 1 });
  assert.ok(p.includes('השאלה: כמה נרשמו השבוע?'));
  assert.ok(p.includes('{"active":1}'));
  assert.ok(askPrompt('x'.repeat(900), {}).length < 1500);
});
