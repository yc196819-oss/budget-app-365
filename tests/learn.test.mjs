import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDate, normalizeItems, isValid, worthLearning, learnContext, learnMessages, expectedIncome } from '../public/app/src/domain/learn.js';

const data = {
  today: '2026-10-01',
  goals: [{ id: 'g1', name: 'קרן חירום', target_amount: 30000, saved_amount: 12000, target_date: null }],
  categories: [
    { id: 'food', name: 'אוכל', kind: 'expense', parent_id: null },
    { id: 'cafe', name: 'מסעדות ואוכל בחוץ', kind: 'expense', parent_id: 'food' },
    { id: 'car', name: 'רכב', kind: 'expense', parent_id: null },
    { id: 'sal', name: 'משכורת', kind: 'income', parent_id: null }
  ],
  budgets: [{ category_id: 'food', monthly_amount: 3000 }],
  accounts: [{ id: 'a1', name: 'עו״ש', balance: 12000 }],
  loans: [{ counterparty: 'אחי', direction: 'tome', amount: 2000, settled: false }],
  income: [{ label: 'משכורות', amount: 18000 }],
  memories: [{ text: 'לא לוקחים הלוואות לחופשות' }]
};

test('dates: full dates stay, a month becomes its 1st, anything else is dropped', () => {
  assert.equal(normDate('2027-07-15'), '2027-07-15');
  assert.equal(normDate('2027-07'), '2027-07-01');
  assert.equal(normDate('יולי'), null);
  assert.equal(normDate('2027-13-01'), null);
  assert.equal(normDate(null), null);
});

test('a new goal is proposed with its amount and date; amounts like "8,000 ₪" are read', () => {
  const [g] = normalizeItems([{ kind: 'goal', name: 'חופשה ביוון', target_amount: '8,000 ₪', target_date: '2027-07' }], data);
  assert.equal(g.kind, 'goal');
  assert.equal(g.target_amount, 8000);
  assert.equal(g.target_date, '2027-07-01');
  assert.equal(g.saved_amount, 0);
  assert.equal(g.on, true);
  assert.ok(g.key);
});

test('a "new" goal that already exists becomes an update of only what changed', () => {
  const [u] = normalizeItems([{ kind: 'goal', name: 'קרן  חירום', target_amount: 30000, saved_amount: 15000 }], data);
  assert.equal(u.kind, 'goal_update');
  assert.equal(u.goal_id, 'g1');
  assert.deepEqual(u.set, { saved_amount: 15000 });
  assert.deepEqual(u.before, { saved_amount: 12000 });
});

test('goal updates need a real goal and a real change', () => {
  assert.equal(normalizeItems([{ kind: 'goal_update', goal_id: 'nope', set: { target_amount: 1 } }], data).length, 0);
  assert.equal(normalizeItems([{ kind: 'goal_update', goal_id: 'g1', set: { target_amount: 30000 } }], data).length, 0);
  const [u] = normalizeItems([{ kind: 'goal_update', goal_id: 'g1', set: { target_date: '2027-03-01', target_amount: 0 } }], data);
  assert.deepEqual(u.set, { target_date: '2027-03-01' });
});

test('budgets: only for existing expense categories, and only when the amount changes', () => {
  const items = normalizeItems([
    { kind: 'budget', category: 'רכב', amount: 800 },
    { kind: 'budget', category: 'אוכל', amount: 3000 },
    { kind: 'budget', category: 'משכורת', amount: 100 },
    { kind: 'budget', category: 'חיות', amount: 300 }
  ], data);
  assert.deepEqual(items.map((i) => [i.category_id, i.amount, i.before]), [['car', 800, 0]]);
});

test('balance goes to the one account, or the named one; unchanged balances are dropped', () => {
  const [b] = normalizeItems([{ kind: 'balance', balance: 9500 }], data);
  assert.deepEqual([b.account_id, b.balance, b.before], ['a1', 9500, 12000]);
  assert.equal(normalizeItems([{ kind: 'balance', balance: 12000 }], data).length, 0);
});

test('memories: short or already-known ones are dropped, kind defaults to decision', () => {
  const items = normalizeItems([
    { kind: 'memory', text: 'לא לוקחים הלוואות לחופשות.' },
    { kind: 'memory', text: 'כן' },
    { kind: 'memory', text: 'מפרישים 10% מעשרות מכל הכנסה', memKind: 'preference' },
    { kind: 'memory', text: 'חוסכים 1,000 בחודש לרכב', memKind: 'weird' }
  ], data);
  assert.deepEqual(items.map((i) => [i.text, i.memKind]), [['מפרישים 10% מעשרות מכל הכנסה', 'preference'], ['חוסכים 1,000 בחודש לרכב', 'decision']]);
});

test('loans, installments and income are checked', () => {
  const items = normalizeItems([
    { kind: 'loan', direction: 'iowe', counterparty: 'בנק לאומי', amount: 40000 },
    { kind: 'loan', direction: 'tome', counterparty: 'אחי', amount: 2000 },
    { kind: 'loan', counterparty: 'x', amount: 0 },
    { kind: 'installment', description: 'מקרר', total_amount: 6000, payments_count: 12 },
    { kind: 'installment', description: 'טלפון', total_amount: 3000, payments_count: 1 },
    { kind: 'income', amount: 21000 },
    { kind: 'unknown', amount: 1 }
  ], data);
  assert.deepEqual(items.map((i) => i.kind), ['loan', 'installment', 'income']);
  assert.equal(items[1].first_payment, '2026-10-01');
  assert.deepEqual([items[2].amount, items[2].before], [21000, 18000]);
  assert.equal(normalizeItems([{ kind: 'income', amount: 18000 }], data).length, 0);
});

test('duplicates are dropped and the list is capped at 12', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'memory', text: 'החלטה מספר ' + i }));
  assert.equal(normalizeItems([...many], data).length, 12);
  assert.equal(normalizeItems([{ kind: 'goal', name: 'רכב', target_amount: 1 }, { kind: 'goal', name: 'רכב', target_amount: 2 }], data).length, 1);
  assert.deepEqual(normalizeItems('nonsense', data), []);
});

test('edited items are validated before saving', () => {
  assert.equal(isValid({ kind: 'goal', name: 'x', target_amount: NaN }), false);
  assert.equal(isValid({ kind: 'goal', name: 'x', target_amount: 5 }), true);
  assert.equal(isValid({ kind: 'budget', amount: 0 }), true);
  assert.equal(isValid({ kind: 'memory', text: '  ' }), false);
  assert.equal(isValid({ kind: 'installment', description: 'a', total_amount: 10, payments_count: 1 }), false);
});

test('the offer to save shows only after the person mentions an amount or a decision', () => {
  const msgs = [
    { role: 'user', text: 'מה המצב?' }, { role: 'ai', text: 'הוצאתם 3,000 על אוכל' },
    { role: 'user', text: 'החלטנו לחסוך לחופשה' }
  ];
  assert.equal(worthLearning(msgs.slice(0, 2)), false, 'amounts said by the advisor do not count');
  assert.equal(worthLearning(msgs), true);
  assert.equal(worthLearning(msgs, 3), false, 'already looked at');
  assert.equal(worthLearning([{ role: 'user', text: 'המשכורת עלתה ל-21 אלף' }]), true);
  assert.equal(worthLearning([{ role: 'user', text: 'יש לנו 12500 בעו"ש' }]), true);
});

test('the context sent to the AI has names and amounts, never transactions', () => {
  const ctx = learnContext({ ...data, txs: [{ description: 'שופרסל' }] });
  assert.deepEqual(ctx.categories, [{ name: 'אוכל', budget: 3000 }, { name: 'רכב', budget: 0 }]);
  assert.equal(ctx.income, 18000);
  assert.deepEqual(ctx.memories, ['לא לוקחים הלוואות לחופשות']);
  assert.equal(ctx.goals[0].id, 'g1');
  assert.doesNotMatch(JSON.stringify(ctx), /שופרסל/);
  assert.equal(expectedIncome(null), 0);
});

test('the conversation sent to the server: names on the person\'s messages, no pending ones', () => {
  const out = learnMessages([{ role: 'user', text: 'שלום', author_id: 'u1' }, { role: 'ai', text: '' , pending: true }, { role: 'ai', text: 'היי' }], () => 'יוסי');
  assert.deepEqual(out, [{ role: 'user', author: 'יוסי', text: 'שלום' }, { role: 'ai', author: undefined, text: 'היי' }]);
});
