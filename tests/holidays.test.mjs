import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidayDates, holidaysBetween, nextHoliday, previousOccurrence } from '../public/app/src/domain/calendar.js';

// The dates the app used to keep by hand, 2025–2029: the Hebrew calendar
// gives exactly these, and goes on for every year after.
const BY_HAND = {
  pesach: ['2025-04-13', '2026-04-02', '2027-04-22', '2028-04-11', '2029-03-31'],
  shavuot: ['2025-06-02', '2026-05-22', '2027-06-11', '2028-05-31', '2029-05-20'],
  roshHashana: ['2025-09-23', '2026-09-12', '2027-10-02', '2028-09-21', '2029-09-10'],
  sukkot: ['2025-10-07', '2026-09-26', '2027-10-16', '2028-10-05', '2029-09-24'],
  chanukah: ['2025-12-15', '2026-12-05', '2027-12-25', '2028-12-13', '2029-12-02']
};

test('holiday dates from the Hebrew calendar match the old table, and go on after 2029', () => {
  for (const [key, dates] of Object.entries(BY_HAND)) {
    for (const d of dates) assert.equal(holidayDates(Number(d.slice(0, 4)))[key], d, key + ' ' + d);
  }
  const y2031 = holidayDates(2031);
  assert.deepEqual(Object.keys(y2031).sort(), ['chanukah', 'pesach', 'roshHashana', 'shavuot', 'sukkot']);
  assert.equal(y2031.pesach, '2031-04-08');
  assert.equal(y2031.roshHashana, '2031-09-18');
});

test('holidays in a range, the next one, and the one before', () => {
  assert.deepEqual(holidaysBetween(new Date(2030, 8, 1), new Date(2030, 9, 31)).map((h) => h.key), ['roshHashana', 'sukkot']);
  const n = nextHoliday(new Date(2031, 2, 25));
  assert.equal(n.key, 'pesach');
  assert.equal(n.inDays, 14);
  assert.equal(previousOccurrence('pesach', '2031-04-08'), '2030-04-18');
});
