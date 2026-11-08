import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastMonths, averages, suggestBudget, monthPace, paceOf, averageLeft, monthsUntil, monthlyFor, emergencyTarget, dateIn } from '../public/app/src/domain/goals.js';

// Made-up household: food and car, three whole months before 8.11.2026.
const today = new Date(2026, 10, 8);
const cats = [{ id: 'food', name: 'אוכל' }, { id: 'car', name: 'רכב' }, { id: 'sal', name: 'משכורת', kind: 'income' }];
let n = 0;
const tx = (o) => ({ id: 'g' + (++n), type: 'expense', amount: 100, category_id: 'food', ...o });
const txs = [
  tx({ tx_date: '2026-08-05', amount: 3000 }), tx({ tx_date: '2026-09-05', amount: 2700 }), tx({ tx_date: '2026-10-05', amount: 3300 }),
  tx({ tx_date: '2026-08-12', amount: 900, category_id: 'car' }), tx({ tx_date: '2026-10-12', amount: 600, category_id: 'car' }),
  tx({ tx_date: '2026-11-03', amount: 1200 }), tx({ tx_date: '2026-11-04', amount: 500, category_id: 'car' }),
  tx({ tx_date: '2026-08-01', amount: 12000, type: 'income', category_id: 'sal' }), tx({ tx_date: '2026-09-01', amount: 12000, type: 'income', category_id: 'sal' }), tx({ tx_date: '2026-10-01', amount: 12000, type: 'income', category_id: 'sal' })
];

test('the past months: whole months with spending only, newest first', () => {
  assert.deepEqual(pastMonths(txs, today), [{ y: 2026, m: 9 }, { y: 2026, m: 8 }, { y: 2026, m: 7 }]);
  // A new household with one month uploaded: one month, not three months of zeros.
  assert.deepEqual(pastMonths([tx({ tx_date: '2026-10-02' })], today), [{ y: 2026, m: 9 }]);
  assert.deepEqual(pastMonths([], today), []);
});

test('averages per category over those months', () => {
  const a = averages({ txs, categories: cats, today });
  assert.equal(a.byCat.get('food'), 3000);
  assert.equal(a.byCat.get('car'), 500);
  assert.equal(a.total, 3500);
  assert.equal(a.months.length, 3);
});

test('a suggested budget: a little under the average, in round numbers', () => {
  assert.equal(suggestBudget(3000), 2850);
  assert.equal(suggestBudget(3000, 0), 3000);
  assert.equal(suggestBudget(3000, 0.1), 2700);
  assert.equal(suggestBudget(130), 120, 'under ₪200 to the nearest ₪10');
  assert.equal(suggestBudget(4), 10, 'never 0 for a category with spending');
  assert.equal(suggestBudget(0), 0);
});

test('the month so far against the budgets', () => {
  assert.ok(Math.abs(monthPace(today) - 8 / 30) < 1e-9);
  const p = paceOf({ txs, categories: cats, budgets: [{ category_id: 'food', monthly_amount: 3000 }, { category_id: 'car', monthly_amount: 600 }], today });
  assert.equal(p.planned, 3600);
  assert.equal(p.spent, 1700);
  assert.equal(p.state, 'ahead', '1,700 spent by day 8 of 3,600 is ahead of pace');
  assert.equal(p.worst.id, 'food', 'food is ₪400 over its pace, the car ₪340');
  assert.equal(paceOf({ txs, categories: cats, budgets: [], today }).state, 'none');
});

test('left at the end of a month, on average', () => {
  const months = pastMonths(txs, today);
  assert.equal(averageLeft(txs, months), 12000 - 3500);
  assert.equal(averageLeft(txs.filter((t) => t.type !== 'income'), months), null, 'no income lines: unknown');
});

test('a goal: months until its date and the monthly amount to get there', () => {
  assert.equal(monthsUntil('2027-11-01', today), 12);
  assert.equal(monthsUntil('2026-11-20', today), 1, 'at least one month');
  assert.equal(monthlyFor({ target: 20000, saved: 2000, date: '2027-11-01', today }), 1500);
  assert.equal(monthlyFor({ target: 1000, saved: 1000, date: '2027-11-01', today }), 0);
  assert.equal(emergencyTarget(12633), 37900);
  assert.equal(dateIn(12, today), '2027-11-01');
});
