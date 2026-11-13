import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixedCosts, findings } from '../public/app/src/domain/fixedcheck.js';
import { transferPairs } from '../public/app/src/domain/transfers.js';
import { linesToAsk, refundCandidates } from '../public/app/src/domain/moves.js';
import { usual, previousList } from '../public/app/src/domain/shopping.js';
const require = createRequire(import.meta.url);
const demo = require('../server/demo.js');

// The demo household's made-up categories, accounts and cards.
const C = (id, name, parent_id = null) => ({ id, name, parent_id });
const categories = [C('food', 'אוכל'), C('super', 'סופר', 'food'), C('out', 'מסעדות ואוכל בחוץ', 'food'), C('home', 'בית ודיור'), C('rent', 'שכירות / משכנתא', 'home'), C('bills', 'חשבונות', 'home'),
  C('health', 'בריאות'), C('hins', 'ביטוח בריאות', 'health'), C('car', 'רכב'), C('cins', 'ביטוח רכב', 'car'), C('fuel', 'דלק', 'car'), C('fun', 'פנאי ובידור'), C('culture', 'תרבות', 'fun'), C('salary', 'משכורת')];
const accounts = [{ id: 'accD', name: 'חשבון דוד' }, { id: 'accM', name: 'חשבון מיכל' }];
const cards = [{ id: 'cardD', bank_account_id: 'accD' }, { id: 'cardM', bank_account_id: 'accM' }];
const today = new Date('2026-11-13T09:00:00Z');
const txs = demo.buildTransactions({ today, categories, accounts, cards, userId: 'u-demo' }).map((t, i) => ({ id: 't' + i, ...t }));

test('a year of money up to today, never after it, every month with salaries', () => {
  const months = new Set(txs.map((t) => t.tx_date.slice(0, 7)));
  assert.equal(months.size, 12);
  assert.ok(txs.every((t) => t.tx_date <= '2026-11-13'));
  assert.ok(txs.some((t) => t.tx_date.startsWith('2026-11')), 'this month has lines');
  for (const m of months) if (m < '2026-11') assert.equal(txs.filter((t) => t.tx_date.startsWith(m) && /משכורת/.test(t.description)).length, 2, m);
  assert.ok(txs.every((t) => Number.isFinite(t.amount) && t.amount > 0));
  assert.ok(txs.filter((t) => t.subcategory_id === 'super').length >= 60, 'the supermarket, often');
});

test('the same day builds the same data', () => {
  const again = demo.buildTransactions({ today, categories, accounts, cards });
  assert.deepEqual(again.map((t) => t.description + t.amount), txs.map((t) => t.description + t.amount));
});

test('the advisor\'s fixed-cost check finds what is worth a look', () => {
  const f = findings(fixedCosts(txs, { categories, today: new Date(2026, 10, 13) }));
  const types = new Set(f.map((x) => x.type));
  assert.ok(types.has('streams'), 'two streaming services');
  assert.ok(types.has('health'), 'health insurance from two companies');
  assert.ok(types.has('up'), 'the cellular bill went up');
  assert.ok(types.has('cell'), 'cellular worth comparing');
});

test('the transfer between their own accounts, the Bit refund and the investment are asked about', () => {
  const pairs = transferPairs(txs, { days: 2 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].amount, 3000);
  const ask = linesToAsk(txs, { categories, today: new Date('2026-11-13T12:00:00') });
  assert.equal(ask.bit.length, 1);
  assert.equal(ask.invest.length, 1);
  const cands = refundCandidates(txs, ask.bit[0]);
  assert.equal(cands[0].description, 'מסעדת הגפן', 'the dinner is the first guess');
});

test('the shopping list has items now, a previous shopping and what they usually buy; the receipt is from last week', () => {
  const items = demo.buildShopping({ today }).map((r, i) => ({ id: 's' + i, ...r }));
  assert.ok(items.filter((i) => !i.cleared_at).length >= 8);
  assert.ok(previousList(items).length > 0);
  assert.ok(usual(items).length >= 4);
  const r = demo.buildReceipt({ today });
  assert.equal(r.bought_on, '2026-11-06');
  assert.ok(r.items.every((i) => i.price > 0 && i.name));
});
