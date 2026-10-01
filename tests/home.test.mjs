import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysInMonth, expectedFixed, monthPlan, cardCycle, cashNow, upcoming, minusStreak, suspectedDuplicates, attention, topCategories
} from '../public/app/src/domain/home.js';

// Today: 15 October 2026 (31-day month, half way).
const TODAY = new Date(2026, 9, 15);
let n = 0;
const tx = (o) => ({ id: 'x' + (++n), type: 'expense', amount: 100, spread: 'month', nature: 'variable', category_id: 'food', ...o });
const CATS = [
  { id: 'food', name: 'אוכל', kind: 'expense', parent_id: null },
  { id: 'home', name: 'בית', kind: 'expense', parent_id: null },
  { id: 'sal', name: 'משכורת', kind: 'income', parent_id: null }
];

test('daysInMonth', () => {
  assert.equal(daysInMonth(2026, 1), 28);
  assert.equal(daysInMonth(2028, 1), 29);
  assert.equal(daysInMonth(2026, 9), 31);
});

test('expectedFixed: last month\'s fixed lines that did not show up yet', () => {
  const txs = [
    tx({ description: 'משכנתא', amount: 4500, nature: 'fixed', tx_date: '2026-09-01' }),
    tx({ description: 'משכנתא', amount: 4500, nature: 'fixed', tx_date: '2026-10-01' }),
    tx({ description: 'משכורת', type: 'income', amount: 18000, nature: 'fixed', tx_date: '2026-09-28' }),
    tx({ description: 'ועד בית', amount: 150, nature: 'fixed', tx_date: '2026-09-10' }),
    tx({ description: 'ביטוח שנתי', amount: 1200, nature: 'fixed', spread: 'year', tx_date: '2026-09-05' }),
    tx({ description: 'סופר', amount: 300, tx_date: '2026-09-20' })
  ];
  const out = expectedFixed(txs, TODAY);
  assert.deepEqual(out.map((t) => [t.description, t.date, t.late]), [['ועד בית', '2026-10-15', true], ['משכורת', '2026-10-28', false]]);
});

test('expectedFixed clamps the day to a short month', () => {
  const out = expectedFixed([tx({ description: 'שכירות', nature: 'fixed', tx_date: '2026-01-31' })], new Date(2026, 1, 3));
  assert.equal(out[0].date, '2026-02-28');
});

test('monthPlan: budget left, pace and the end-of-month forecast', () => {
  const txs = [
    tx({ description: 'סופר', amount: 1500, tx_date: '2026-10-05' }),
    tx({ description: 'משכנתא', amount: 4500, nature: 'fixed', tx_date: '2026-10-01', category_id: 'home' }),
    tx({ description: 'משכורת', type: 'income', amount: 18000, nature: 'fixed', tx_date: '2026-09-28', category_id: 'sal' }),
    tx({ description: 'ביטוח', amount: 1200, spread: 'year', tx_date: '2026-06-01' }),
    // 3 earlier months of variable spending: 3000 each
    ...['2026-07-10', '2026-08-10', '2026-09-10'].map((d) => tx({ description: 'סופר', amount: 3000, tx_date: d }))
  ];
  const p = monthPlan({ txs, budgets: [{ category_id: 'food', monthly_amount: 4000 }, { category_id: 'home', monthly_amount: 4500 }], today: TODAY });
  assert.equal(p.budget, 8500);
  assert.equal(p.spent, 1500 + 4500 + 100);
  assert.equal(p.remaining, 8500 - 6100);
  assert.equal(p.daysLeft, 17);
  // the yearly insurance adds 1200/12 to every month from June
  assert.equal(p.avgVariable, 3100);
  assert.equal(p.fixedIncomeLeft, 18000);
  // variable: 1600 so far; pace 1600/15*31; blended with the 3100 average by 15/31
  const pace = (1600 / 15) * 31;
  const w = 15 / 31;
  const variable = w * pace + (1 - w) * 3100;
  assert.ok(Math.abs(p.projectedExpense - (6100 + variable - 1600)) < 0.01);
  assert.ok(Math.abs(p.projectedEnd - (18000 - p.projectedExpense)) < 0.01);
  assert.equal(p.canForecast, true);
  assert.equal(p.dayPct, 48);
});

test('monthPlan without budgets or income says so instead of inventing numbers', () => {
  const p = monthPlan({ txs: [tx({ tx_date: '2026-10-02' })], budgets: [], today: TODAY });
  assert.equal(p.hasBudget, false);
  assert.equal(p.canForecast, false);
  assert.equal(p.perDayLeft, 0);
});

test('cardCycle: last and next billing dates and what is not charged yet', () => {
  const card = { id: 'c1', name: 'ויזה 4821', billing_day: 10 };
  const txs = [
    tx({ card_id: 'c1', amount: 200, tx_date: '2026-08-20' }),
    tx({ card_id: 'c1', amount: 300, tx_date: '2026-09-20' }),
    tx({ card_id: 'c1', amount: 50, tx_date: '2026-10-12' }),
    tx({ card_id: 'c2', amount: 999, tx_date: '2026-10-12' })
  ];
  const c = cardCycle(card, txs, TODAY);
  assert.equal(c.last, '2026-10-10');
  assert.equal(c.next, '2026-11-10');
  assert.equal(c.daysSinceLast, 5);
  assert.equal(c.pending, 50);
  assert.equal(c.nextAmount, 50);
  const before = cardCycle(card, txs.filter((t) => t.tx_date <= '2026-10-03'), new Date(2026, 9, 3));
  assert.equal(before.last, '2026-09-10');
  assert.equal(before.next, '2026-10-10');
  assert.equal(before.pending, 300);
  assert.equal(before.nextAmount, 300);
  assert.equal(cardCycle({ id: 'c', billing_day: 31 }, [], new Date(2026, 1, 10)).next, '2026-02-28');
});

test('cashNow: balance minus card charges that did not go out yet', () => {
  const accounts = [{ id: 'a1', balance: 10000, balance_updated_at: '2026-10-14T08:00:00Z' }, { id: 'a2', balance: null }];
  const cards = [{ id: 'c1', bank_account_id: 'a1', billing_day: 10 }, { id: 'c2', bank_account_id: 'a2', billing_day: 2 }];
  const txs = [tx({ card_id: 'c1', amount: 700, tx_date: '2026-10-12' }), tx({ card_id: 'c2', amount: 900, tx_date: '2026-10-12' })];
  assert.deepEqual(cashNow(accounts, cards, txs, TODAY), { known: true, balance: 10000, pending: 700, free: 9300, updatedAt: '2026-10-14T08:00:00Z' });
  assert.deepEqual(cashNow([{ id: 'a', balance: null }], [], [], TODAY), { known: false });
});

test('upcoming: fixed lines and card charges in the next two weeks, by date', () => {
  const txs = [
    tx({ description: 'ועד בית', amount: 150, nature: 'fixed', tx_date: '2026-09-20' }),
    tx({ description: 'משכורת', type: 'income', amount: 18000, nature: 'fixed', tx_date: '2026-09-28' }),
    tx({ card_id: 'c1', amount: 640, tx_date: '2026-09-25' })
  ];
  const out = upcoming({ txs, cards: [{ id: 'c1', name: 'מאסטרקארד', billing_day: 2 }, { id: 'c2', name: 'ויזה', billing_day: 10 }], today: TODAY });
  assert.deepEqual(out.map((u) => [u.label, u.title, u.amount]), [['20.10', 'ועד בית', -150], ['28.10', 'משכורת', 18000]]);
  const later = upcoming({ txs, cards: [{ id: 'c1', name: 'מאסטרקארד', billing_day: 2 }], today: new Date(2026, 8, 30) });
  assert.deepEqual(later.find((u) => u.title === 'מאסטרקארד'), { date: '2026-10-02', label: '2.10', title: 'מאסטרקארד', detail: 'חיוב אשראי', amount: -640 });
});

test('minusStreak counts red months back from last month', () => {
  const txs = [
    tx({ type: 'income', amount: 1000, tx_date: '2026-06-01' }),
    tx({ amount: 500, tx_date: '2026-06-02' }),
    tx({ type: 'income', amount: 1000, tx_date: '2026-07-01' }), tx({ amount: 1500, tx_date: '2026-07-02' }),
    tx({ type: 'income', amount: 1000, tx_date: '2026-08-01' }), tx({ amount: 1500, tx_date: '2026-08-02' }),
    tx({ type: 'income', amount: 1000, tx_date: '2026-09-01' }), tx({ amount: 1500, tx_date: '2026-09-02' }),
    tx({ amount: 99999, tx_date: '2026-10-02' })
  ];
  assert.equal(minusStreak(txs, TODAY), 3);
  assert.equal(minusStreak([], TODAY), 0);
});

test('suspectedDuplicates: same amount, same or next day, similar text', () => {
  const txs = [
    tx({ id: 'a', description: 'פז אילת', amount: 300, tx_date: '2026-10-10' }),
    tx({ id: 'b', description: 'פז', amount: 300, tx_date: '2026-10-10' }),
    tx({ id: 'c', description: 'ארומה', amount: 18, tx_date: '2026-10-11' }),
    tx({ id: 'd', description: 'קפה', amount: 18, tx_date: '2026-10-13' })
  ];
  const out = suspectedDuplicates(txs, TODAY);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].tx.id, out[0].of.id], ['b', 'a']);
});

test('attention: most important first, at most three, each with an action', () => {
  const txs = [
    tx({ type: 'income', amount: 1000, tx_date: '2026-08-01', category_id: 'sal' }), tx({ amount: 1500, tx_date: '2026-08-02' }),
    tx({ type: 'income', amount: 1000, tx_date: '2026-09-01', category_id: 'sal' }), tx({ amount: 1500, tx_date: '2026-09-02' }),
    tx({ amount: 4100, tx_date: '2026-10-03' }),
    tx({ amount: 60, tx_date: '2026-10-04', category_id: null, description: 'משהו' })
  ];
  const budgets = [{ category_id: 'food', monthly_amount: 4000 }];
  const plan = monthPlan({ txs, budgets, today: TODAY });
  const items = attention({ txs, categories: CATS, budgets, cards: [{ id: 'c1', name: 'ויזה 4821', billing_day: 10 }], today: TODAY, plan });
  assert.deepEqual(items.map((i) => i.kind), ['streak', 'bill', 'over']);
  assert.match(items[0].title, /חודשיים ברציפות במינוס/);
  assert.equal(items[1].action.to, 'import');
  assert.match(items[2].title, /חריגה באוכל/);
  const all = attention({ txs, categories: CATS, budgets, cards: [], today: TODAY, plan, limit: 9 });
  assert.deepEqual(all.map((i) => i.kind), ['streak', 'over', 'loose']);
  assert.equal(all[2].action.to, 'tx');
});

test('attention is empty when all is well', () => {
  const txs = [tx({ type: 'income', amount: 9000, tx_date: '2026-10-01', category_id: 'sal' }), tx({ amount: 100, tx_date: '2026-10-02' })];
  const plan = monthPlan({ txs, budgets: [], today: TODAY });
  assert.deepEqual(attention({ txs, categories: CATS, budgets: [], cards: [], today: TODAY, plan }), []);
});

test('topCategories: biggest first with their share', () => {
  const txs = [tx({ amount: 300, tx_date: '2026-10-02' }), tx({ amount: 100, tx_date: '2026-10-02', category_id: 'home' })];
  const t = topCategories(txs, CATS, [], TODAY);
  assert.equal(t.total, 400);
  assert.deepEqual(t.rows.map((r) => [r.id, r.share]), [['food', 75], ['home', 25]]);
});

test('expectedFixed matches lines without a description by category', () => {
  const txs = [
    tx({ type: 'income', amount: 9000, nature: 'fixed', tx_date: '2026-09-10', category_id: 'sal', description: '' }),
    tx({ type: 'income', amount: 9000, nature: 'fixed', tx_date: '2026-10-10', category_id: 'sal', description: '' }),
    tx({ amount: 300, nature: 'fixed', tx_date: '2026-09-20', category_id: 'home', description: '123' })
  ];
  assert.deepEqual(expectedFixed(txs, TODAY).map((t) => t.category_id), ['home']);
});
