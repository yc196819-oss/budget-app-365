import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loanPlan, loanDueIn, openLoans, summary } from '../public/app/src/domain/assets.js';
import { forecast } from '../public/app/src/domain/forecast.js';
import { buildSummary } from '../public/app/src/domain/advisor.js';

// Made-up: "דני" owes 5,000, paying 500 on the 10th, from 10/1/2026.
const dani = { id: 'l1', direction: 'tome', counterparty: 'דני', amount: 5000, monthly_amount: 500, first_payment: '2026-01-10', settled: false };

test('without a monthly payment: what was typed is what is left', () => {
  assert.deepEqual(loanPlan({ amount: 1200 }, new Date(2026, 5, 1)), { plan: false, amount: 1200, left: 1200 });
});

test('each payment day that came takes the payment off', () => {
  const before = loanPlan(dani, new Date(2026, 0, 9));
  assert.equal(before.paid, 0); assert.equal(before.left, 5000); assert.equal(before.count, 10);
  assert.equal(loanPlan(dani, new Date(2026, 0, 10)).left, 4500, 'the payment day itself counts');
  const p = loanPlan(dani, new Date(2026, 3, 15));
  assert.equal(p.paid, 4); assert.equal(p.left, 3000);
  assert.deepEqual([p.next.getFullYear(), p.next.getMonth(), p.next.getDate()], [2026, 4, 10]);
  assert.equal(p.nextAmount, 500);
  assert.deepEqual([p.last.getFullYear(), p.last.getMonth()], [2026, 9]);
});

test('paid off: nothing left, and it leaves the open debts', () => {
  const p = loanPlan(dani, new Date(2026, 9, 10));
  assert.equal(p.left, 0); assert.equal(p.done, true); assert.equal(p.next, null);
  assert.equal(openLoans([dani], new Date(2026, 9, 10)).length, 0);
  assert.equal(openLoans([dani], new Date(2026, 9, 9)).length, 1);
});

test('a sum that does not divide: the last payment is the rest', () => {
  const l = { ...dani, amount: 1250 };
  assert.equal(loanPlan(l, new Date(2026, 0, 1)).count, 3);
  assert.deepEqual([0, 1, 2, 3].map((k) => (loanDueIn(l, { y: 2026, m: k }) || {}).amount ?? null), [500, 500, 250, null]);
  assert.equal(loanPlan(l, new Date(2026, 2, 10)).left, 0);
});

test('the 31st is the last day of a shorter month', () => {
  const l = { ...dani, first_payment: '2026-01-31' };
  assert.equal(loanDueIn(l, { y: 2026, m: 1 }).date.getDate(), 28);
  assert.equal(loanPlan(l, new Date(2026, 1, 28)).paid, 2);
});

test('the payment due in a month says which one it is; none before or after', () => {
  assert.deepEqual((({ amount, n, count }) => ({ amount, n, count }))(loanDueIn(dani, { y: 2026, m: 2 })), { amount: 500, n: 3, count: 10 });
  assert.equal(loanDueIn(dani, { y: 2025, m: 11 }), null);
  assert.equal(loanDueIn(dani, { y: 2026, m: 10 }), null);
  assert.equal(loanDueIn({ ...dani, settled: true }, { y: 2026, m: 2 }), null);
});

test('the assets count only what is left', () => {
  const s = summary({ loans: [dani, { direction: 'iowe', amount: 3000, monthly_amount: 1000, first_payment: '2026-01-05' }], today: new Date(2026, 1, 15) });
  assert.equal(s.owedToUs, 4000);
  assert.equal(s.loanDebt, 1000);
});

test('the forecast: a debt owed to us is expected income each month, until it ends', () => {
  const fc = forecast({ txs: [], loans: [dani, { direction: 'iowe', counterparty: 'בנק בדוי', amount: 900, monthly_amount: 300, first_payment: '2026-01-05' }], today: new Date(2026, 7, 5) });
  const debt = fc.months.map((m) => m.lines.filter((l) => l.kind === 'debt').map((l) => [l.label, l.amount]));
  assert.deepEqual(debt.slice(0, 3), [[['החזר חוב: דני (תשלום 8 מתוך 10)', 500]], [['החזר חוב: דני (תשלום 9 מתוך 10)', 500]], [['החזר חוב: דני (תשלום 10 מתוך 10)', 500]]]);
  assert.deepEqual(debt.slice(3), [[], [], []], 'none after the last');
  // This month, a payment whose day passed already came in: not expected again.
  const late = forecast({ txs: [], loans: [dani], today: new Date(2026, 7, 11) });
  assert.equal(late.months[0].lines.filter((l) => l.kind === 'debt').length, 0);
});

test('the advisor hears what is left and the monthly payment', () => {
  const s = buildSummary({ txs: [], categories: [], budgets: [], loans: [dani], today: new Date(2026, 3, 15) });
  assert.deepEqual(s.loans, [{ with: 'דני', amount: 3000, direction: 'owed_to_us', monthly: 500, payments_left: 6 }]);
});
