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

import { investPattern } from '../public/app/src/domain/assets.js';
import { forecast } from '../public/app/src/domain/forecast.js';

const dep = (ym, amount, id) => ({ id, type: 'expense', amount, description: 'קרן בדויה', tx_date: ym + '-03', category_id: 'inv' });

test('regular: deposits in 3 of the last 4 full months; the usual sum is the middle one', () => {
  const p = investPattern([dep('2026-07', 900), dep('2026-08', 1000), dep('2026-10', 1200)], cats, today);
  assert.equal(p.recurring, true);
  assert.equal(p.monthly, 1000);
  assert.equal(p.months, 3);
});

test('a one-off deposit is not regular', () => {
  const p = investPattern([dep('2026-09', 20000)], cats, today);
  assert.equal(p.recurring, false);
  assert.equal(p.monthly, 0);
});

test('the forecast: regular deposits on a line of their own each month, out of the average', () => {
  const salary = (ym) => ({ type: 'income', amount: 10000, description: 'משכורת בדויה', tx_date: ym + '-10', category_id: null });
  const food = (ym) => ({ type: 'expense', amount: 3000, description: 'סופר בדוי', tx_date: ym + '-05', category_id: 'food' });
  const base = ['2026-07', '2026-08', '2026-09', '2026-10'].flatMap((ym) => [salary(ym), food(ym), dep(ym, 1000)]);
  const fc = forecast({ txs: base, categories: cats, today });
  const next = fc.months[1];
  assert.deepEqual(next.lines.filter((l) => l.kind === 'saving').map((l) => l.amount), [-1000]);
  assert.equal(next.lines.find((l) => l.kind === 'variable').amount, -3000, 'deposits not in the average too');
  assert.equal(fc.investMonthly, 1000);
  // A one-off: out of the average, and not expected again.
  const once = ['2026-08', '2026-09', '2026-10'].flatMap((ym) => [salary(ym), food(ym)]).concat([dep('2026-09', 20000)]);
  const fc2 = forecast({ txs: once, categories: cats, today });
  assert.equal(fc2.months[1].lines.filter((l) => l.kind === 'saving').length, 0);
  assert.equal(fc2.months[1].lines.find((l) => l.kind === 'variable').amount, -3000);
  // Without categories (as before): unchanged.
  const fc3 = forecast({ txs: base, today });
  assert.equal(fc3.months[1].lines.filter((l) => l.kind === 'saving').length, 0);
});
