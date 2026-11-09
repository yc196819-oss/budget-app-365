import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greeting, ago, areas, record } from '../public/app/src/domain/admin.js';

test('the greeting fits the hour and the date is written in Hebrew', () => {
  assert.deepEqual(greeting(new Date(2026, 10, 9, 8, 0)), { hello: 'בוקר טוב', date: 'יום שני, 9 בנובמבר' });
  assert.equal(greeting(new Date(2026, 10, 9, 19, 0)).hello, 'ערב טוב');
  assert.equal(greeting(new Date(2026, 10, 9, 23, 30)).hello, 'לילה טוב');
});

test('how long ago, in plain words', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  assert.equal(ago('2026-03-10T11:59:50Z', now), 'עכשיו');
  assert.equal(ago('2026-03-10T11:45:00Z', now), 'לפני 15 דק׳');
  assert.equal(ago('2026-03-10T10:00:00Z', now), 'לפני שעתיים');
  assert.equal(ago('2026-03-09T08:00:00Z', now), 'אתמול');
});

test('actions are grouped by part of the app, biggest first, without app openings', () => {
  const a = areas([{ name: 'app_open', count: 500 }, { name: 'tx_add', count: 30 }, { name: 'import_done', count: 10 }, { name: 'advisor_ask', count: 40 }, { name: 'shop_add', count: 20 }, { name: 'weird', count: 0 }]);
  assert.deepEqual(a.map((x) => x.key).sort(), ['advisor', 'money', 'shop']);
  assert.equal(a[2].key, 'shop');
  assert.equal(a.reduce((s, x) => s + x.n, 0), 100);
  assert.equal(a.find((x) => x.key === 'shop').pct, 20);
  assert.deepEqual(areas([]), []);
});

test('a record: the busiest day of the month first, otherwise of two weeks', () => {
  const days = (arr) => arr.map((active, i) => ({ day: 'd' + i, active }));
  assert.deepEqual(record(days([...Array(29).fill(3), 9])), { today: 9, span: 'month' });
  assert.deepEqual(record(days([12, ...Array(28).fill(3), 9])), { today: 9, span: 'twoWeeks' });
  assert.equal(record(days([...Array(29).fill(3), 3])), null);
  assert.equal(record(days([1, 2, 3])), null);
});
