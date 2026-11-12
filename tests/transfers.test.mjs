import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transferPairs, splitTransfers, markedPairs, isTransfer, asTransfer, typeBefore, pairKey } from '../public/app/src/domain/transfers.js';
import { withoutSaved } from '../public/app/src/domain/sources.js';
import { attention } from '../public/app/src/domain/home.js';
import { totalsFor } from '../public/app/src/domain/money.js';

// Made-up household: two bank accounts (A, B) and a card.
const out = (id, amount, tx_date, account_id = 'A', extra = {}) => ({ id, type: 'expense', amount, tx_date, account_id, description: 'העברה לחשבון', ...extra });
const inn = (id, amount, tx_date, account_id = 'B', extra = {}) => ({ id, type: 'income', amount, tx_date, account_id, description: 'הפקדה מחשבון', ...extra });

test('a pair: out of one account, into another, same amount, within 2 days', () => {
  const pairs = transferPairs([out('o1', 2000, '2026-11-03'), inn('i1', 2000, '2026-11-04')]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].out.id, 'o1');
  assert.equal(pairs[0].in.id, 'i1');
  assert.equal(pairs[0].amount, 2000);
  assert.equal(pairs[0].gap, 1);
  assert.equal(pairs[0].key, pairKey({ id: 'o1' }, { id: 'i1' }));
});

test('not a pair: same account, other amount, too far apart, a card line, or already marked', () => {
  assert.equal(transferPairs([out('o', 500, '2026-11-03'), inn('i', 500, '2026-11-03', 'A')]).length, 0);
  assert.equal(transferPairs([out('o', 500, '2026-11-03'), inn('i', 500.5, '2026-11-03')]).length, 0);
  assert.equal(transferPairs([out('o', 500, '2026-11-01'), inn('i', 500, '2026-11-04')]).length, 0);
  assert.equal(transferPairs([out('o', 500, '2026-11-03', 'A', { card_id: 'c1' }), inn('i', 500, '2026-11-03')]).length, 0);
  assert.equal(transferPairs([out('o', 500, '2026-11-03', 'A', { type: 'transfer_out' }), inn('i', 500, '2026-11-03')]).length, 0);
  // A line with no account (typed in by hand) is never paired.
  assert.equal(transferPairs([out('o', 500, '2026-11-03', null), inn('i', 500, '2026-11-03')]).length, 0);
});

test('each line in one pair only; the closest date wins', () => {
  const pairs = transferPairs([out('o1', 300, '2026-11-01'), out('o2', 300, '2026-11-03'), inn('i1', 300, '2026-11-03')]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].out.id, 'o2');
});

test('a pair the household said "no" to is not asked again', () => {
  const txs = [out('o1', 2000, '2026-11-03'), inn('i1', 2000, '2026-11-04')];
  assert.equal(transferPairs(txs, { no: new Set([pairKey(txs[0], txs[1])]) }).length, 0);
});

test('marked lines keep their direction and come back exactly on undo', () => {
  assert.equal(asTransfer({ type: 'expense' }), 'transfer_out');
  assert.equal(asTransfer({ type: 'income' }), 'transfer_in');
  assert.equal(typeBefore({ type: 'transfer_out' }), 'expense');
  assert.equal(typeBefore({ type: 'transfer_in' }), 'income');
  assert.ok(isTransfer({ type: 'transfer_in' }));
  assert.ok(!isTransfer({ type: 'income' }));
});

test('marked transfers are neither spent nor earned', () => {
  const txs = [out('o1', 2000, '2026-11-03', 'A', { type: 'transfer_out' }), inn('i1', 2000, '2026-11-04', 'B', { type: 'transfer_in' }), out('x', 100, '2026-11-05')];
  const split = splitTransfers(txs);
  assert.deepEqual(split.txs.map((t) => t.id), ['x']);
  assert.equal(split.transfers.length, 2);
  const tot = totalsFor(split.txs, [{ y: 2026, m: 10 }]);
  assert.equal(tot.expense, 100);
  assert.equal(tot.income, 0);
  const m = markedPairs(split.transfers);
  assert.equal(m.length, 1);
  assert.equal(m[0].out.id, 'o1');
  assert.equal(m[0].in.id, 'i1');
});

test('the same file uploaded again does not bring a marked transfer back', () => {
  const saved = [{ ...out('o1', 2000, '2026-11-03'), type: 'transfer_out' }];
  const again = [{ tx_date: '2026-11-03', amount: 2000, description: 'העברה לחשבון', account_id: 'A', type: 'expense' }];
  assert.equal(withoutSaved(again, saved).length, 0);
});

test('home asks about a transfer (never marks it), and not after "no"', () => {
  const today = new Date(2026, 10, 12);
  const plan = { canForecast: false, projectedEnd: 0 };
  const txs = [out('o1', 2000, '2026-11-03'), inn('i1', 2000, '2026-11-04')];
  const items = attention({ txs, categories: [], budgets: [], cards: [], today, plan, limit: 5 });
  const t = items.find((x) => x.kind === 'transfer');
  assert.ok(t);
  assert.match(t.title, /העברה בין החשבונות שלכם/);
  assert.equal(t.action.to, 'transfers');
  const after = attention({ txs, categories: [], budgets: [], cards: [], today, plan, limit: 5, dupeOk: new Set(['t:' + pairKey(txs[0], txs[1])]) });
  assert.equal(after.some((x) => x.kind === 'transfer'), false);
});

test('the household can widen how many days apart the two sides may be', async () => {
  const { transferDays } = await import('../public/app/src/domain/transfers.js');
  const txs = [out('o1', 900, '2026-11-01'), inn('i1', 900, '2026-11-05')];
  assert.equal(transferPairs(txs).length, 0);
  assert.equal(transferPairs(txs, { days: 4 }).length, 1);
  assert.equal(transferDays('7'), 7);
  assert.equal(transferDays('30'), 2, 'only the offered choices');
  const today = new Date(2026, 10, 12);
  const items = attention({ txs, categories: [], budgets: [], cards: [], today, plan: { canForecast: false }, limit: 5, transferDays: 7 });
  assert.ok(items.some((x) => x.kind === 'transfer'));
});
