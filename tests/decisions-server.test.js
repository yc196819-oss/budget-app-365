const { test } = require('node:test');
const assert = require('node:assert/strict');
const { messagesFor, reminders } = require('../server/decisions');

const members = [{ user_id: 'u1', display_name: 'יוסי', household_id: 'h1' }, { user_id: 'u2', display_name: 'דני', household_id: 'h1' }];
const decision = { id: 'd1', household_id: 'h1', created_by: 'u2', title: 'מכונת כביסה', amount: 2400, note: 'הישנה נשברה', status: 'open', created_at: '2026-09-28T10:00:00Z', reminded_at: null };

test('a new card goes to the partner, with who, what and how much', () => {
  const [m, ...rest] = messagesFor('opened', { decision, actorId: 'u2', members });
  assert.equal(rest.length, 0);
  assert.equal(m.to, 'u1');
  assert.equal(m.title, '🛒 דני רוצה לקנות: מכונת כביסה');
  assert.match(m.body, /₪2,400 · הישנה נשברה — מה דעתך\?/);
  assert.equal(m.url, '/app/#/together');
});

test('an answer goes to the others, with the reason', () => {
  const [m] = messagesFor('answered', { decision: { ...decision, status: 'not_now' }, actorId: 'u1', members, vote: { vote: 'not_now', note: 'אחרי החגים' } });
  assert.equal(m.to, 'u2');
  assert.equal(m.title, '⏳ יוסי: לא עכשיו — מכונת כביסה');
  assert.equal(m.body, 'אחרי החגים');
  const [ok] = messagesFor('answered', { decision: { ...decision, status: 'approved' }, actorId: 'u1', members, vote: { vote: 'approve', note: null } });
  assert.equal(ok.title, '✅ יוסי: מאשר/ת (אושר) — מכונת כביסה');
  assert.deepEqual(messagesFor('answered', { decision, actorId: 'u1', members, vote: null }), []);
  assert.deepEqual(messagesFor('hack', { decision, actorId: 'u1', members }), []);
});

test('reminders: once, a day after opening, only to whoever has not answered', () => {
  const now = new Date('2026-10-01T06:00:00Z');
  const fresh = { ...decision, id: 'd2', created_at: '2026-09-30T20:00:00Z' };
  const reminded = { ...decision, id: 'd3', reminded_at: '2026-09-30T06:00:00Z' };
  const answered = { ...decision, id: 'd4' };
  const list = reminders({ decisions: [decision, fresh, reminded, answered], votes: [{ decision_id: 'd4', user_id: 'u1' }], members, now });
  assert.deepEqual(list.map((m) => [m.decisionId, m.to]), [['d1', 'u1']]);
  assert.match(list[0].title, /מחכה לתשובה שלך: מכונת כביסה/);
});

test('a message on the card and the advisor joining go to the other partner', () => {
  const [m, ...rest] = messagesFor('message', { decision, actorId: 'u1', members, message: { role: 'user', text: 'אולי נחכה לחודש הבא?' } });
  assert.equal(rest.length, 0);
  assert.equal(m.to, 'u2');
  assert.equal(m.title, '💬 יוסי על מכונת כביסה');
  assert.equal(m.body, 'אולי נחכה לחודש הבא?');
  const [a] = messagesFor('advisor', { decision, actorId: 'u1', members, message: { role: 'ai', text: 'ההמלצה שלי: לחכות לדצמבר.' } });
  assert.equal(a.to, 'u2');
  assert.equal(a.title, '🤖 היועץ הצטרף לשיחה על: מכונת כביסה');
  assert.match(a.body, /לחכות לדצמבר/);
  assert.deepEqual(messagesFor('message', { decision, actorId: 'u1', members, message: null }), []);
});
