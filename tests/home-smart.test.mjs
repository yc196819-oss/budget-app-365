import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthPlan, recurringComing } from '../public/app/src/domain/home.js';

// A made-up family: rent and a monthly donation written by hand each month
// (never marked "fixed"), card lines, and in November only a few card lines so far.
const TODAY = new Date(2026, 10, 14, 10);
function family() {
  const txs = [];
  let n = 0;
  const add = (o) => txs.push({ id: 't' + (++n), type: 'expense', nature: 'variable', spread: 'month', ...o });
  for (const [m, rentDay] of [['08', 10], ['09', 10], ['10', 13]]) {
    add({ tx_date: '2026-' + m + '-' + rentDay, amount: 6200, category_id: 'housing', description: 'שכר דירה' });
    add({ tx_date: '2026-' + m + '-01', amount: 800, category_id: 'misc', description: 'הוראת קבע', nature: m === '10' ? 'fixed' : 'variable' });
    for (let d = 2; d <= 28; d += 2) add({ tx_date: '2026-' + m + '-' + String(d).padStart(2, '0'), amount: 300, category_id: 'food', description: 'סופר' });
  }
  // Treatments of different sums: not a monthly payment.
  add({ tx_date: '2026-09-11', amount: 1600, category_id: 'care', description: 'טיפול' });
  add({ tx_date: '2026-10-12', amount: 1350, category_id: 'care', description: 'טיפול' });
  for (let d = 1; d <= 10; d++) if (d % 2) add({ tx_date: '2026-11-' + String(d).padStart(2, '0'), amount: 118, category_id: 'food', description: 'סופר' });
  return txs;
}
const budgets = [{ monthly_amount: 19590 }];

test('a payment that came every month and not yet this one is spoken for', () => {
  const r = recurringComing(family(), TODAY);
  assert.deepEqual(r.map((x) => [x.category_id, x.amount]), [['housing', 6200], ['misc', 800]]);
  // The supermarket (many small lines) and treatments of different sums are not.
  assert.ok(!r.some((x) => x.category_id === 'food' || x.category_id === 'care'));
});

test('"left to spend": the budget less what went out and what is still coming (owner first)', () => {
  const txs = family();
  const old = monthPlan({ txs, budgets, today: TODAY });
  assert.equal(old.remaining, 19590 - 590, 'as before for everyone');
  const p = monthPlan({ txs, budgets, today: TODAY, smart: true });
  // The fixed line (800, marked fixed last month) and the rent (6,200), each once.
  assert.equal(p.committedLeft, 7000);
  assert.equal(p.remaining, 19590 - 590 - 7000);
  // Only ₪590 by the 14th, when about ₪4,000 usually goes out by now: the month looks missing.
  assert.equal(p.looksPartial, true);
  assert.equal(p.lastLine, '2026-11-09');
});

test('once the rent came this month, it is no longer expected', () => {
  const txs = family();
  txs.push({ id: 'x', type: 'expense', tx_date: '2026-11-12', amount: 6200, category_id: 'housing', description: 'שכר דירה' });
  const p = monthPlan({ txs, budgets, today: TODAY, smart: true });
  assert.ok(!p.recurring.some((r) => r.category_id === 'housing'));
});

test('a full month is not called partial', () => {
  const txs = family();
  for (let d = 1; d <= 14; d++) txs.push({ id: 'f' + d, type: 'expense', tx_date: '2026-11-' + String(d).padStart(2, '0'), amount: 300, category_id: 'food', description: 'סופר' });
  assert.equal(monthPlan({ txs, budgets, today: TODAY, smart: true }).looksPartial, false);
});
