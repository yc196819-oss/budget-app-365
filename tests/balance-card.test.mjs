import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBalance } from '../public/app/src/domain/balanceCard.js';

test('the advisor\'s balance: the lines from the AI, the totals added up here, never the AI\'s own sum', () => {
  const raw = 'בשורה התחתונה נשאר מעט.\n@@מאזן: {"title":"המאזן של דצמבר","start":[{"label":"יתרה של דנה","amount":-1200},{"label":"יתרה של יואב","amount":"-800"}],"income":[{"label":"משכורת דנה","amount":12000},{"label":"משכורת יואב","amount":"4,000"},{"label":"קצבה","amount":100}],"expenses":[{"label":"שכר דירה","amount":4500},{"label":"מעון","amount":2000},{"label":"","amount":50},{"label":"שגוי","amount":-3}],"total":99999,"note":"בלי ה-500 שאולי ייכנסו"}\n@@הצעות: עוד?';
  const b = parseBalance(raw);
  assert.equal(b.title, 'המאזן של דצמבר');
  assert.deepEqual(b.income.map((x) => x.amount), [12000, 4000, 100]);
  assert.deepEqual(b.expenses.map((x) => x.label), ['שכר דירה', 'מעון'], 'a line without a name or with a wrong amount is dropped');
  assert.equal(b.totalIncome, 16100);
  assert.equal(b.totalExpenses, 6500);
  assert.equal(b.totalStart, -2000);
  assert.equal(b.net, 9600);
  assert.equal(b.end, 7600, 'the balances, plus income, minus expenses');
  assert.equal(b.note, 'בלי ה-500 שאולי ייכנסו');
  assert.equal(parseBalance('אין כאן מאזן'), null);
  assert.equal(parseBalance('@@מאזן: {"income":[],"expenses":[]}'), null);
  assert.equal(parseBalance('@@מאזן: {לא json'), null);
});
