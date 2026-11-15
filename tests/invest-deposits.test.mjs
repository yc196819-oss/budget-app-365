import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investDeposits } from '../public/app/src/domain/assets.js';

const cats = [{ id: 'inv', name: 'השקעות', kind: 'expense' }, { id: 'inv-f', name: 'קרן', parent_id: 'inv', kind: 'expense' }, { id: 'food', name: 'מזון', kind: 'expense' }];
const today = new Date(2026, 10, 15);
// Made-up deposits: 1,000 a month from April to November, plus extras.
const txs = [];
for (let m = 3; m <= 10; m++) txs.push({ type: 'expense', amount: 1000, description: 'קרן בדויה', tx_date: '2026-' + String(m + 1).padStart(2, '0') + '-03', category_id: 'inv' });
txs.push({ type: 'expense', amount: 300, description: 'פסגות ניירות ערך', tx_date: '2026-09-12', category_id: null });
txs.push({ type: 'expense', amount: 200, description: 'תת קרן', tx_date: '2026-10-12', category_id: 'inv', subcategory_id: 'inv-f' });
txs.push({ type: 'income', amount: 400, description: 'משיכה מקרן', tx_date: '2026-10-20', category_id: 'inv' });
txs.push({ type: 'expense', amount: 999, description: 'סופר בדוי', tx_date: '2026-10-05', category_id: 'food' });
txs.push({ type: 'expense', amount: 50, description: 'מניות בדויות', tx_date: '2026-10-06', category_id: 'food' });

test('deposits: sorted to investments (or under it), or uncategorized with investment words', () => {
  const d = investDeposits(txs, cats, today);
  assert.equal(d.any, true);
  assert.equal(d.total, 8500, '8×1000 + 300 + 200; the food line with "מניות" was sorted elsewhere');
  assert.equal(d.withdrawn, 400);
  assert.equal(d.net, 8100);
  assert.equal(d.thisMonth, 1000);
});

test('the average is over the full months since the first deposit, not always 12', () => {
  const d = investDeposits(txs, cats, today);
  assert.equal(d.months, 7, 'April to October');
  assert.equal(d.lastYear, 7500);
  assert.equal(d.monthlyAvg, Math.round(7500 / 7));
});

test('six months of bars and where the money went', () => {
  const d = investDeposits(txs, cats, today);
  assert.deepEqual(d.byMonth.map((m) => m.ym), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(d.byMonth.map((m) => m.amount), [1000, 1000, 1000, 1300, 1200, 1000]);
  assert.equal(d.where[0].name, 'קרן בדויה');
  assert.equal(d.first, '2026-04-03');
});

test('no investment category and no such words: nothing', () => {
  const d = investDeposits([{ type: 'expense', amount: 5, description: 'קפה', tx_date: '2026-10-01', category_id: 'food' }], cats, today);
  assert.equal(d.any, false);
  assert.equal(d.monthlyAvg, 0);
});
