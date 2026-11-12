import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesToAsk, refundCandidates, asRefund, fromRefund, investAfter, isBit, isInvest, isRefund } from '../public/app/src/domain/moves.js';
import { attention } from '../public/app/src/domain/home.js';
import { totalsFor, categoryRows } from '../public/app/src/domain/money.js';
import { withoutSaved } from '../public/app/src/domain/sources.js';

// Made-up household, November 2026.
const today = new Date(2026, 10, 12);
const cats = [{ id: 'food', name: 'אוכל', kind: 'expense' }, { id: 'inv', name: 'השקעות', kind: 'expense' }];
const meal = { id: 'm', type: 'expense', amount: 500, tx_date: '2026-11-08', description: 'מסעדה בדויה', category_id: 'food' };
const gift = { id: 'g', type: 'expense', amount: 320, tx_date: '2026-11-02', description: 'מתנה', category_id: 'food' };
const bit = { id: 'b', type: 'income', amount: 250, tx_date: '2026-11-10', description: 'העברה ב BIT - יעל', account_id: 'a1' };
const sale = { id: 's', type: 'income', amount: 3000, tx_date: '2026-11-06', description: 'מכירת ניירות ערך', account_id: 'a1' };
const dep = { id: 'd', type: 'expense', amount: 1000, tx_date: '2026-11-04', description: 'העברה לבלינק', account_id: 'a1' };

test('Bit and investment lines are found by their words (and the investments category)', () => {
  assert.ok(isBit({ description: 'העברה ב BIT - יעל' }));
  assert.ok(isBit({ description: 'ביט העברת כספים' }));
  assert.ok(!isBit({ description: 'ביטוח רכב' }), 'insurance is not Bit');
  assert.ok(isInvest({ description: 'מכירת ניירות ערך' }));
  assert.ok(isInvest({ description: 'קניה נ"ע' }));
  assert.ok(isInvest({ description: 'משהו', category_id: 'inv' }, cats));
  assert.ok(!isInvest({ description: 'סופר בדוי' }, cats));
  const ask = linesToAsk([meal, gift, bit, sale, dep], { categories: cats, today });
  assert.deepEqual(ask.bit.map((t) => t.id), ['b']);
  assert.deepEqual(ask.invest.map((t) => t.id), ['s', 'd']);
  // Answered, or older than 60 days: not asked.
  assert.equal(linesToAsk([bit], { no: new Set(['b']), today }).bit.length, 0);
  assert.equal(linesToAsk([{ ...bit, tx_date: '2026-08-01' }], { today }).bit.length, 0);
});

test('a Bit refund: the expense it may be for, and the expense counts less', () => {
  assert.deepEqual(refundCandidates([meal, gift, bit], bit).map((t) => t.id), ['m', 'g'], 'half a meal before a nearer amount');
  const r = { ...bit, ...asRefund(bit, meal) };
  assert.ok(isRefund(r));
  assert.equal(r.amount, -250);
  const mo = [{ y: 2026, m: 10 }];
  assert.deepEqual(totalsFor([meal, r], mo), { expense: 250, income: 0, net: -250 });
  const food = categoryRows([meal, r], cats, [], mo).find((x) => x.id === 'food');
  assert.equal(food.spent, 250);
  // Back to income, exactly.
  assert.deepEqual({ ...r, ...fromRefund(r) }.amount, 250);
  assert.equal({ ...r, ...fromRefund(r) }.type, 'income');
  // The same file again does not bring the money in back.
  assert.equal(withoutSaved([{ ...bit, id: undefined }], [r]).length, 0);
});

test('an investment: a withdrawal lowers its value, a deposit raises value and cost; a live one is left to its units', () => {
  const inv = { id: 'i', name: 'קרן בדויה', current_value: 42000, cost: 30000 };
  assert.deepEqual((({ id, current_value }) => ({ id, current_value }))(investAfter(inv, 3000, 'out')), { id: 'i', current_value: 39000 });
  const up = investAfter(inv, 1000, 'in');
  assert.equal(up.current_value, 43000);
  assert.equal(up.cost, 31000);
  assert.equal(investAfter({ ...inv, symbol: 'SPY', units: 5 }, 1000, 'out'), null);
  assert.equal(investAfter(null, 1000, 'out'), null);
});

test('home asks about Bit and investments, one line each, and not after an answer', () => {
  const plan = { canForecast: false };
  const items = attention({ txs: [meal, bit, sale], categories: cats, budgets: [], cards: [], today, plan, limit: 6 });
  const b = items.find((x) => x.kind === 'bit');
  assert.match(b.title, /250.*נכנסו מביט/);
  assert.deepEqual(b.action, { label: 'לבחור', to: 'ask', id: 'b', kind: 'bit' });
  assert.match(items.find((x) => x.kind === 'invest').title, /משיכה או רווח/);
  const after = attention({ txs: [meal, bit, sale], categories: cats, budgets: [], cards: [], today, plan, limit: 6, dupeOk: new Set(['a:b', 'a:s']) });
  assert.equal(after.some((x) => x.kind === 'bit' || x.kind === 'invest'), false);
});

test('refund suggestions: three at most, nothing much bigger than four times the refund', () => {
  const big = { id: 'big', type: 'expense', amount: 1500, tx_date: '2026-11-09', description: 'רהיט' };
  const list = refundCandidates([meal, gift, big, { ...meal, id: 'm2', amount: 260 }, { ...meal, id: 'm3', amount: 900 }], bit).map((t) => t.id);
  assert.equal(list.length, 3);
  assert.ok(!list.includes('big'));
});
