import test from 'node:test';
import assert from 'node:assert/strict';
import { listOf, itemsOf, listRows, whenText, cleanName } from '../public/app/src/domain/shopLists.js';

const lists = [{ id: 'L1', name: 'הרשימה שלי', created_at: '2026-11-01' }, { id: 'L2', name: 'לשבת', created_at: '2026-11-10' }, { id: 'L3', name: 'ישנה', created_at: '2026-10-01', archived_at: '2026-11-02' }];
const items = [
  { id: 'a', name: 'חלב', list_id: 'L1', done: true, created_at: '2026-11-15' },
  { id: 'b', name: 'לחם', list_id: null, done: false, created_at: '2026-11-15' },
  { id: 'c', name: 'חלות', list_id: 'L2', done: false, created_at: '2026-11-16T10:00:00' },
  { id: 'd', name: 'יין', list_id: 'L3', done: false, created_at: '2026-11-01' },
  { id: 'e', name: 'אורז', list_id: 'L1', done: true, cleared_at: '2026-11-14', created_at: '2026-11-10' }
];

test('an item without a list, or on a closed one, belongs to the first list; bought-and-finished items are on no list', () => {
  assert.equal(listOf(items[1], lists), 'L1');
  assert.equal(listOf(items[3], lists), 'L1');
  assert.deepEqual(itemsOf(items, 'L1', lists).map((i) => i.id), ['a', 'b', 'd']);
  assert.deepEqual(itemsOf(items, 'L2', lists).map((i) => i.id), ['c']);
  assert.equal(listOf(items[1], []), null);
});

test('the lists like chats: latest first, what is left to buy, how many bought; a closed list is not shown', () => {
  const rows = listRows(lists, items);
  assert.deepEqual(rows.map((r) => r.id), ['L2', 'L1']);
  assert.deepEqual([rows[1].count, rows[1].done, rows[1].preview], [3, 1, ['לחם', 'יין']]);
});

test('when, and a list name', () => {
  const now = new Date(2026, 10, 17, 12);
  assert.equal(whenText('2026-11-17T08:00:00', now), 'היום');
  assert.equal(whenText('2026-11-16T22:00:00', now), 'אתמול');
  assert.equal(whenText('2026-11-14T10:00:00', now), 'לפני 3 ימים');
  assert.equal(whenText('2026-11-01T10:00:00', now), '1.11');
  assert.equal(cleanName('  לשבת   הזאת '), 'לשבת הזאת');
  assert.equal(cleanName('   '), null);
});

test('compare first: the list with the most still to buy; nothing when all is bought', async () => {
  const { compareFirst } = await import('../public/app/src/domain/shopLists.js');
  const rows = [{ id: 'a', name: 'שבת', count: 3, done: 3 }, { id: 'b', name: 'שבועית', count: 8, done: 2 }, { id: 'c', name: 'פארם', count: 2, done: 0 }];
  assert.deepEqual([compareFirst(rows).id, compareFirst(rows).left], ['b', 6]);
  assert.equal(compareFirst([rows[0]]), null);
  assert.equal(compareFirst([]), null);
});
