import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { cleanupPlan, warningMail } = createRequire(import.meta.url)('../server/cleanup.js');

// Made-up accounts. Day numbers count back from "now".
const DAY = 86400000;
const now = Date.UTC(2026, 10, 13);
const u = (id, daysIdle, extra = {}) => ({ id, email: id + '@example.com', lastSeen: now - daysIdle * DAY, txs: 0, partners: 0, ...extra });

test('empty and idle for 76+ days: told first; deleted only 14 days after being told and 90 days idle', () => {
  const users = [u('fresh', 10), u('soon', 80), u('old', 120), u('told', 100), u('toldLate', 95)];
  const warned = new Map([['told', now - 15 * DAY], ['toldLate', now - 3 * DAY]]);
  const p = cleanupPlan(users, warned, now);
  assert.deepEqual(p.warn.map((x) => x.id), ['soon', 'old'], 'never deleted without a warning first');
  assert.deepEqual(p.remove.map((x) => x.id), ['told'], 'two weeks after the warning');
});

test('never: an account with transactions, a shared household, or the owner', () => {
  const users = [u('used', 200, { txs: 3 }), u('shared', 200, { partners: 1 }), u('owner', 200, { keep: true })];
  const p = cleanupPlan(users, new Map(users.map((x) => [x.id, now - 30 * DAY])), now);
  assert.deepEqual([p.warn.length, p.remove.length], [0, 0]);
});

test('signing in after the warning keeps the account (the old warning no longer counts)', () => {
  const back = u('back', 5);
  const p = cleanupPlan([back], new Map([['back', now - 20 * DAY]]), now);
  assert.deepEqual([p.warn.length, p.remove.length], [0, 0]);
  // Idle again later: a new warning first, not a deletion.
  const later = cleanupPlan([u('back', 80)], new Map([['back', now - 100 * DAY]]), now);
  assert.deepEqual([later.warn.length, later.remove.length], [1, 0]);
});

test('at most 20 deletions a night', () => {
  const users = Array.from({ length: 30 }, (_, i) => u('x' + i, 120));
  const p = cleanupPlan(users, new Map(users.map((x) => [x.id, now - 20 * DAY])), now);
  assert.equal(p.remove.length, 20);
});

test('the warning says when, and that signing in once keeps it', () => {
  const m = warningMail({ name: 'דנה', date: '27.11.2026', link: 'https://example.com/app/' });
  assert.match(m.subject, /27\.11\.2026/);
  assert.match(m.text, /שלום דנה/);
  assert.match(m.text, /מספיק להיכנס פעם אחת/);
  assert.match(m.html, /href="https:\/\/example\.com\/app\/"/);
});
