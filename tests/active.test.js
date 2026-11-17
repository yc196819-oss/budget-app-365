const test = require('node:test');
const assert = require('node:assert/strict');
const { activeHouseholds, loadActive } = require('../server/active');

const NOW = Date.parse('2026-11-17T10:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();

test('a household is active when one of its members opened the app in the last 14 days', () => {
  const mems = [{ household_id: 'h1', user_id: 'a' }, { household_id: 'h1', user_id: 'b' }, { household_id: 'h2', user_id: 'c' }, { household_id: 'h3', user_id: 'd' }];
  const evs = [{ user_id: 'b', at: day(3) }, { user_id: 'c', at: day(20) }, { user_id: 'zz', at: day(1) }];
  assert.deepEqual([...activeHouseholds(mems, evs, NOW)], ['h1']);
  assert.deepEqual([...activeHouseholds(mems, evs, NOW, 30)].sort(), ['h1', 'h2']);
});

test('a read error runs the jobs for every household rather than for none', async () => {
  const db = { from: (t) => ({ select: () => (t === 'memberships' ? Promise.resolve({ data: [{ household_id: 'h1', user_id: 'a' }, { household_id: 'h2', user_id: 'b' }] }) : { eq: () => ({ gte: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'down' } }) }) }) }) }) };
  const { all, active } = await loadActive(db);
  assert.deepEqual(all, ['h1', 'h2']);
  assert.deepEqual([...active], ['h1', 'h2']);
});
