import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, txRows, TX_COLUMNS, exportName, binLine, daysLeft } from '../public/app/src/domain/exporting.js';

test('the CSV opens in Excel with Hebrew, quotes what would break a row, and never runs a formula', () => {
  const csv = toCsv([{ a: 'שופרסל, סניף "דיל"', b: -50 }, { a: '=HYPERLINK("x")', b: null }, { a: 'שורה\nשנייה', b: { x: 1 } }], ['a', 'b']);
  assert.ok(csv.startsWith('﻿a,b\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], '"שופרסל, סניף ""דיל""",-50');
  assert.equal(lines[2], '"\'=HYPERLINK(""x"")",');
  assert.ok(csv.includes('"שורה\nשנייה","{""x"":1}"'));
});

test('transactions are exported newest first, with category names', () => {
  const rows = txRows([{ tx_date: '2026-01-01', category_id: 'f' }, { tx_date: '2026-03-01', category_id: 'f', subcategory_id: 's' }], [{ id: 'f', name: 'אוכל' }, { id: 's', name: 'סופר' }]);
  assert.deepEqual(rows.map((r) => [r.tx_date, r.category, r.subcategory]), [['2026-03-01', 'אוכל', 'סופר'], ['2026-01-01', 'אוכל', '']]);
  assert.ok(TX_COLUMNS.includes('category'));
  assert.equal(exportName('transactions', new Date(2026, 9, 5)), 'budget-transactions-2026-10-05.csv');
  assert.equal(exportName('all', new Date(2026, 9, 5)), 'budget-all-2026-10-05.json');
});

test('a deleted item reads as a line, with how many days are left to bring it back', () => {
  assert.deepEqual(binLine({ tbl: 'transactions', data: { description: 'ארומה', amount: 42, tx_date: '2026-10-20' } }), { icon: '🧾', kind: 'תנועה', title: 'ארומה', amount: 42, date: '2026-10-20' });
  assert.deepEqual(binLine({ tbl: 'goals', data: { name: 'חופשה', target_amount: 8000 } }).amount, 8000);
  assert.equal(binLine({ tbl: 'unknown', data: {} }).title, 'פריט');
  assert.equal(binLine({ tbl: 'trips', data: { destination: 'רומא' } }).amount, null);
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(daysLeft('2026-10-21T12:00:00Z', now), 29);
  assert.equal(daysLeft('2026-09-01T00:00:00Z', now), 0);
});
