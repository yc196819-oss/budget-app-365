import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCards, cleanLast4, last4Valid, billingDayValid, cardLabel, usage, cardSub, defaultCard, paidWith } from '../public/app/src/domain/cards.js';

const today = new Date(2026, 9, 5); // 5 Oct 2026
const card = { id: 'c1', name: 'ויזה כאל', last4: '4821', billing_day: 10, credit_limit: 10000, bank_account_id: 'a1', owner_user_id: 'u2' };
const tx = (amount, tx_date, extra = {}) => ({ id: tx_date + amount, type: 'expense', amount, tx_date, card_id: 'c1', ...extra });

test('only active cards are listed (rows without the flag count as active)', () => {
  assert.deepEqual(activeCards([{ id: 1 }, { id: 2, is_active: false }, { id: 3, is_active: true }]).map((c) => c.id), [1, 3]);
  assert.deepEqual(activeCards(), []);
});

test('last 4 digits: empty, or exactly four digits; spaces and dots are dropped', () => {
  assert.equal(cleanLast4('4821'), '4821');
  assert.equal(cleanLast4(' 48 21 '), '4821');
  assert.equal(cleanLast4('••••4821'), '4821');
  assert.equal(cleanLast4(''), '');
  assert.equal(cleanLast4(null), '');
  assert.equal(cleanLast4('482'), null);
  assert.equal(cleanLast4('4580123412341234'), null, 'a full card number is refused, not cut');
  assert.equal(last4Valid('12345'), false);
  assert.equal(last4Valid(''), true);
});

test('billing day is 1–28', () => {
  assert.ok(billingDayValid(1) && billingDayValid('28'));
  assert.ok(!billingDayValid(0) && !billingDayValid(29) && !billingDayValid(2.5) && !billingDayValid(''));
});

test('label shows the last digits once', () => {
  assert.equal(cardLabel(card), 'ויזה כאל \u2066••••4821\u2069', 'the digits keep their order inside Hebrew text');
  assert.equal(cardLabel({ name: 'ויזה 4821', last4: '4821' }), 'ויזה 4821');
  assert.equal(cardLabel({ name: 'מאסטרקארד' }), 'מאסטרקארד');
  assert.equal(cardLabel(null), '');
});

test('usage: purchases not yet charged against the limit, near from 80%, over at 100%', () => {
  const txs = [tx(3000, '2026-09-20'), tx(1000, '2026-10-02'), tx(500, '2026-10-01', { card_id: 'c2' }), tx(700, '2026-10-01', { type: 'income' })];
  const u = usage(card, txs, today);
  assert.equal(u.used, 4000);
  assert.equal(u.limit, 10000);
  assert.equal(u.left, 6000);
  assert.equal(u.level, 'ok');
  assert.equal(usage(card, [tx(8000, '2026-10-01')], today).level, 'near');
  assert.equal(usage(card, [tx(10500, '2026-10-01')], today).level, 'over');
  assert.equal(usage(card, [tx(10500, '2026-10-01')], today).left, -500);
});

test('usage without a limit still gives the amount, no level', () => {
  const u = usage({ ...card, credit_limit: null }, [tx(300, '2026-10-01')], today);
  assert.equal(u.used, 300);
  assert.equal(u.limit, null);
  assert.equal(u.level, 'none');
});

test('the line under the name: whose card and the next charge date', () => {
  const cyc = { next: '2026-10-10' };
  assert.equal(cardSub(card, cyc, { u2: 'נעמי' }, 'u1'), 'של נעמי · יורד ב-10.10');
  assert.equal(cardSub(card, cyc, {}, 'u2'), 'שלי · יורד ב-10.10');
  assert.equal(cardSub({ ...card, owner_user_id: null }, { next: '2026-11-05' }), 'יורד ב-5.11');
});

test('a new expense starts with the last card used, or the only card', () => {
  const cards = [card, { id: 'c2', name: 'אמקס' }, { id: 'c3', name: 'ישן', is_active: false }];
  assert.equal(defaultCard(cards, 'c2'), 'c2');
  assert.equal(defaultCard(cards, 'c3'), null, 'a removed card is not picked');
  assert.equal(defaultCard(cards, null), null);
  assert.equal(defaultCard([card], null), 'c1');
  assert.equal(defaultCard([], 'c1'), null);
});

test('paid with a card: the card, its bank account and the credit method', () => {
  assert.deepEqual(paidWith(card), { card_id: 'c1', account_id: 'a1', payment_method: 'credit' });
  assert.deepEqual(paidWith(null), {});
});
