import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shortName, historyItems, lastPaid, receiptsSummary } from '../public/app/src/domain/receipts.js';

const require = createRequire(import.meta.url);
const { parseReceipt, PROMPT } = require('../server/receipts.js');
const today = new Date('2026-11-13T10:00:00Z');

// Made-up receipts.
test('the AI answer becomes a safe receipt: non-products, bad numbers and junk are dropped', () => {
  const r = parseReceipt('```json\n' + JSON.stringify({
    store: 'סופר לדוגמה', date: '2026-11-10', total: '84.30',
    items: [
      { name: 'חלב 3% 1 ליטר', qty: 2, price: 13.8 },
      { name: 'סה"כ', qty: 1, price: 84.3 },
      { name: 'מע"מ', price: 12 },
      { name: 'שקית', price: 0.1 },
      { name: '', price: 5 },
      { name: 'לחם אחיד', qty: 'x', price: '₪7.20' },
      { name: 'משהו יקר מדי', qty: 1, price: 999999 },
      { name: '<script>טונה</script>', qty: 500, price: 20 }
    ]
  }) + '\n```', { today });
  assert.equal(r.store, 'סופר לדוגמה');
  assert.equal(r.date, '2026-11-10');
  assert.equal(r.total, 84.3);
  assert.deepEqual(r.items.map((i) => i.name), ['חלב 3% 1 ליטר', 'לחם אחיד', 'משהו יקר מדי', 'script טונה /script']);
  assert.equal(r.items[1].qty, 1, 'an unreadable quantity is one');
  assert.equal(r.items[1].price, 7.2);
  assert.equal(r.items[2].price, null, 'an absurd price is dropped, the line stays');
  assert.equal(r.items[3].qty, 1, 'a quantity over 99 is a misread');
  assert.ok(PROMPT.includes('JSON'));
});

test('not a receipt, unreadable, no lines, and a date that cannot be', () => {
  assert.deepEqual(parseReceipt('{"error":"not_receipt"}'), { error: 'not_receipt' });
  assert.deepEqual(parseReceipt('sorry, I cannot'), { error: 'unreadable' });
  assert.deepEqual(parseReceipt('{"items":[{"name":"סה\\"כ","price":5}]}'), { error: 'no_items' });
  assert.equal(parseReceipt('{"date":"2031-01-01","items":[{"name":"קמח","price":5}]}', { today }).date, null);
  assert.equal(parseReceipt('{"date":"10/11/26","items":[{"name":"קמח","price":5}]}', { today }).date, null);
  assert.equal(parseReceipt('text before {"items":[{"name":"קמח","price":5}]} after', { today }).items.length, 1);
});

test('a receipt line becomes a short list name', () => {
  assert.equal(shortName('חלב תנובה 3% 1 ליטר'), 'חלב תנובה 3%');
  assert.equal(shortName('קמח לבן 1 ק"ג סוגת'), 'קמח לבן סוגת');
  assert.equal(shortName('ביצים L 12 יח\''), 'ביצים L');
  assert.equal(shortName('7290000000001 טונה בשמן 4*160'), 'טונה בשמן');
  assert.equal(shortName('500גרם פסטה'), 'פסטה');
});

test('the receipt teaches "what you usually buy": each name once, with how many', () => {
  const items = historyItems({ items: [{ name: 'חלב תנובה 3% 1 ליטר', qty: 2 }, { name: 'חלב תנובה 3% 1 ליטר', qty: 1 }, { name: 'לחם אחיד', qty: 1 }, { name: '12', qty: 1 }] });
  assert.deepEqual(items, [{ name: 'חלב תנובה 3%', qty: '×2', aisle: 'dairy' }, { name: 'לחם אחיד', qty: null, aisle: 'bakery' }]);
});

test('what you paid last time: the newest receipt that has it, per unit', () => {
  const receipts = [
    { store: 'רשת ישנה', bought_on: '2026-10-01', items: [{ name: 'חלב 3% קרטון', qty: 1, price: 6.5 }] },
    { store: 'רשת חדשה', bought_on: '2026-11-10', items: [{ name: 'חלב תנובה 3% 1 ליטר', qty: 2, price: 13.8 }, { name: 'לחם', qty: 1, price: null }] }
  ];
  assert.deepEqual(lastPaid('חלב 3%', receipts), { price: 6.9, name: 'חלב תנובה 3% 1 ליטר', store: 'רשת חדשה', date: '2026-11-10' });
  assert.equal(lastPaid('לחם', receipts), null, 'no price on the line');
  assert.equal(lastPaid('חלב 1%', receipts), null);
  assert.equal(receiptsSummary(receipts).last.store, 'רשת חדשה');
  assert.equal(receiptsSummary(receipts).lines, 3);
});
