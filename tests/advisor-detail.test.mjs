import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spendingDetail, buildSummary } from '../public/app/src/domain/advisor.js';

const TODAY = new Date(2026, 10, 2);
const cats = [{ id: 'food', name: 'אוכל', kind: 'expense' }, { id: 'subs', name: 'מנויים', kind: 'expense' }];
const tx = (d, desc, amount, category_id = 'food', type = 'expense') => ({ tx_date: d, description: desc, amount, category_id, type });

test('the advisor sees where the money went by business, what repeats monthly, and the latest lines', () => {
  const txs = [
    tx('2026-08-10', 'נטפליקס', 54.9, 'subs'), tx('2026-09-10', 'נטפליקס', 54.9, 'subs'), tx('2026-10-10', 'נטפליקס', 59.9, 'subs'),
    tx('2026-09-05', 'שופרסל דיל 123', 400), tx('2026-10-05', 'שופרסל דיל 456', 650), tx('2026-10-20', 'שופרסל דיל', 120),
    tx('2026-10-28', 'משכורת', 18000, null, 'income'), tx('2025-01-01', 'ישן', 9999)
  ];
  const d = spendingDetail({ txs, categories: cats, today: TODAY });
  assert.equal(d.topMerchants[0].merchant.startsWith('שופרסל'), true);
  assert.equal(d.topMerchants[0].total3Months, 1170);
  assert.equal(d.topMerchants[0].charges, 3);
  assert.ok(!d.topMerchants.some((m) => m.merchant === 'ישן'), 'older than 3 months is left out');
  assert.deepEqual(d.recurring, [{ merchant: 'נטפליקס', category: 'מנויים', monthly: 57 }]);
  assert.equal(d.recentTransactions[0].what, 'משכורת');
  assert.equal(d.recentTransactions[0].type, 'income');
  assert.equal(d.recentTransactions.length, 8);
});

test('the summary carries accounts, open loans and cards, never card numbers', () => {
  const s = buildSummary({ txs: [], categories: cats, budgets: [], accounts: [{ name: 'עו"ש', balance: 5000 }], cards: [{ name: 'ויזה', last4: '4821', billing_day: 10 }], loans: [{ counterparty: 'אבא', amount: 2000, direction: 'iowe', settled: false }, { counterparty: 'x', amount: 1, settled: true }], today: TODAY });
  assert.deepEqual(s.accounts, [{ name: 'עו"ש', balance: 5000 }]);
  assert.deepEqual(s.loans, [{ with: 'אבא', amount: 2000, direction: 'we_owe' }]);
  assert.ok(!JSON.stringify(s).includes('4821'));
});

import { yearTotals } from '../public/app/src/domain/advisor.js';
test('the advisor knows the last 12 months by sub-category and by business', () => {
  const cats = [{ id: 'car', name: 'רכב' }, { id: 'fuel', name: 'דלק', parent_id: 'car' }];
  const txs = [
    { type: 'expense', amount: 300, description: 'סונול רמות', tx_date: '2026-10-05', category_id: 'car', subcategory_id: 'fuel' },
    { type: 'expense', amount: 250, description: 'סונול גבעת שאול', tx_date: '2026-06-05', category_id: 'car', subcategory_id: 'fuel' },
    { type: 'expense', amount: 999, description: 'ישן מאוד', tx_date: '2024-01-01', category_id: 'car', subcategory_id: 'fuel' }
  ];
  const y = yearTotals({ txs, categories: cats, today: new Date('2026-11-07T12:00:00') });
  assert.deepEqual(y.byCategory[0], { what: 'רכב ← דלק', total: 550, avgMonthly: 46 });
  assert.deepEqual(y.byBusiness[0], { business: 'סונול', total: 550, charges: 2 });
});
