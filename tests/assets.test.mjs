import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLongTerm, investmentValue, gain, installmentLeft, openLoans, summary, symbolsOf } from '../public/app/src/domain/assets.js';

const TODAY = new Date(2026, 9, 15);

test('pension, study fund and provident funds are long-term', () => {
  assert.equal(isLongTerm({ asset_type: 'פנסיה/השתלמות', name: 'מגדל' }), true);
  assert.equal(isLongTerm({ asset_type: 'אחר', name: 'קופת גמל להשקעה' }), true);
  assert.equal(isLongTerm({ asset_type: 'מניות/ETF', name: 'S&P 500' }), false);
});

test('investment value: live quote × units × USD rate, else the typed value', () => {
  const market = { usdIls: 3.7, quotes: { SPY: { price: 500, currency: 'USD', changePct: 1.2 }, TEVA: { price: 6000, currency: 'ILA' }, BAD: { error: 'x' } } };
  assert.deepEqual(investmentValue({ symbol: 'SPY', units: 2, current_value: 1 }, market), { value: 3700, live: true, changePct: 1.2 });
  assert.equal(investmentValue({ symbol: 'TEVA', units: 10 }, market).value, 600);
  assert.deepEqual(investmentValue({ symbol: 'BAD', units: 3, current_value: 999 }, market), { value: 999, live: false, changePct: null });
  assert.equal(investmentValue({ symbol: 'SPY', units: 0, current_value: 50 }, market).value, 50);
  assert.equal(investmentValue({ current_value: '1200.5' }, null).value, 1200.5);
});

test('gain against cost', () => {
  assert.deepEqual(gain({ cost: 1000 }, 1250), { amount: 250, pct: 25 });
  assert.equal(gain({ cost: 0 }, 10), null);
});

test('installments left, counting this month\'s payment once its day came', () => {
  const inst = { total_amount: 6000, payments_count: 6, first_payment: '2026-08-10' };
  assert.deepEqual(installmentLeft(inst, TODAY), { left: 3, amount: 3000, monthly: 1000 });
  assert.equal(installmentLeft(inst, new Date(2026, 9, 5)).left, 4);
  assert.equal(installmentLeft(inst, new Date(2027, 5, 1)).left, 0);
  assert.equal(installmentLeft({ ...inst, first_payment: '2026-12-01' }, TODAY).left, 6);
  assert.deepEqual(installmentLeft({}, TODAY), { left: 0, amount: 0, monthly: 0 });
});

test('summary: what we have, what we owe, net worth', () => {
  const s = summary({
    accounts: [{ id: 'a', balance: 10000 }, { id: 'b', balance: null }],
    investments: [{ name: 'S&P', current_value: 50000 }, { name: 'קרן השתלמות', asset_type: 'פנסיה/השתלמות', current_value: 80000 }],
    loans: [{ direction: 'iowe', amount: 20000 }, { direction: 'tome', amount: 1500 }, { direction: 'iowe', amount: 999, settled: true }],
    installments: [{ total_amount: 6000, payments_count: 6, first_payment: '2026-08-10' }],
    cards: [{ id: 'c1', billing_day: 10 }],
    txs: [{ card_id: 'c1', type: 'expense', amount: 700, tx_date: '2026-10-12' }],
    today: TODAY
  });
  assert.deepEqual(
    { cash: s.cash, invest: s.invest, longTerm: s.longTerm, owedToUs: s.owedToUs, loanDebt: s.loanDebt, instDebt: s.instDebt, cardDebt: s.cardDebt, net: s.net },
    { cash: 10000, invest: 50000, longTerm: 80000, owedToUs: 1500, loanDebt: 20000, instDebt: 3000, cardDebt: 700, net: 141500 - 23700 }
  );
  assert.equal(s.hasAnything, true);
  assert.equal(summary({ today: TODAY }).hasAnything, false);
});

test('open loans and symbols to quote', () => {
  assert.equal(openLoans([{ amount: 5 }, { amount: 5, settled: true }, { amount: 0 }]).length, 1);
  assert.deepEqual(symbolsOf([{ symbol: 'spy' }, { symbol: 'SPY' }, { symbol: 'BTC-USD' }, { symbol: '' }, { symbol: 'bad symbol!' }]), ['SPY', 'BTC-USD']);
});
