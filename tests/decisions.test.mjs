import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcome, waitingOn, needsMyAnswer, voteValid, needsCard, groups, pendingCount, monthIndex, impact, findPurchase, wantedLabel, endOfMonth, forAdvisor } from '../public/app/src/domain/decisions.js';

const members = ['u1', 'u2'];
const d = (o = {}) => ({ id: 'd1', created_by: 'u2', title: 'מכונת כביסה', amount: 2400, status: 'open', created_at: '2026-10-01T10:00:00Z', ...o });
const v = (vote, user = 'u1', id = 'd1', note = null) => ({ decision_id: id, user_id: user, vote, note });

test('the card is approved only when every partner approved; talk beats not-now', () => {
  assert.equal(outcome(d(), [], members), 'open');
  assert.equal(outcome(d(), [v('approve')], members), 'approved');
  assert.equal(outcome(d(), [v('not_now')], members), 'not_now');
  assert.equal(outcome(d(), [v('talk')], members), 'talk');
  const three = ['u1', 'u2', 'u3'];
  assert.equal(outcome(d(), [v('approve')], three), 'open', 'u3 has not answered');
  assert.equal(outcome(d(), [v('approve'), v('not_now', 'u3'), v('talk', 'u1')].slice(1), three), 'talk');
  // The opener's own "vote" does not count, and closed cards stay closed.
  assert.equal(outcome(d(), [v('not_now', 'u2')], members), 'open');
  assert.equal(outcome(d({ status: 'bought' }), [v('not_now')], members), 'bought');
  assert.equal(outcome(d(), [], ['u2']), 'open', 'alone: nobody to answer');
});

test('who still needs to answer', () => {
  assert.deepEqual(waitingOn(d(), [], members), ['u1']);
  assert.deepEqual(waitingOn(d(), [v('talk')], members), []);
  assert.equal(needsMyAnswer(d(), [], 'u1', members), true);
  assert.equal(needsMyAnswer(d(), [], 'u2', members), false, 'the opener does not answer');
  assert.equal(needsMyAnswer(d({ status: 'withdrawn' }), [], 'u1', members), false);
});

test('a reason is required unless approving', () => {
  assert.equal(voteValid('approve', ''), true);
  assert.equal(voteValid('not_now', '  '), false);
  assert.equal(voteValid('talk', 'בוא נדבר על הסכום'), true);
  assert.equal(voteValid('maybe', 'x'), false);
  assert.equal(voteValid(null, 'x'), false);
});

test('the agreed threshold decides when a card is needed', () => {
  assert.equal(needsCard(500, 500), true);
  assert.equal(needsCard(499, 500), false);
  assert.equal(needsCard(600, undefined), true);
});

test('groups: what waits for me first, then talk, waiting, approved; not-now and closed in history', () => {
  const list = [
    d({ id: 'a', created_at: '2026-09-01' }),
    d({ id: 'b', created_by: 'u1', created_at: '2026-09-02' }),
    d({ id: 'c', created_at: '2026-09-03' }),
    d({ id: 'e', created_at: '2026-09-04' }),
    d({ id: 'f', status: 'bought', created_at: '2026-09-05' }),
    d({ id: 'g', created_at: '2026-09-06' })
  ];
  const votes = [v('talk', 'u1', 'c', 'נדבר'), v('approve', 'u1', 'e'), v('not_now', 'u1', 'g', 'אחרי החגים')];
  const g = groups(list, votes, 'u1', members);
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, l]) => [k, l.map((x) => x.id)])), { mine: ['a'], waiting: ['b'], talk: ['c'], approved: ['e'], history: ['g', 'f'] });
  assert.equal(pendingCount(list, votes, 'u1', members), 1);
  assert.equal(pendingCount(list, votes, 'u2', members), 1, 'u2 answers the card u1 opened');
});

test('the wanted month, its label, and month ends', () => {
  const today = new Date(2026, 9, 15);
  assert.equal(monthIndex(null, today), 0);
  assert.equal(monthIndex('2026-11-30', today), 1);
  assert.equal(monthIndex('2028-01-01', today), 5);
  assert.equal(monthIndex('2026-01-01', today), 0);
  assert.equal(wantedLabel(null, today), 'החודש');
  assert.equal(wantedLabel('2026-11-30', today), 'בחודש הבא');
  assert.equal(wantedLabel('2027-01-10', today), 'בינואר');
  assert.equal(endOfMonth(today), '2026-10-31');
  assert.equal(endOfMonth(today, 1), '2026-11-30');
  assert.equal(endOfMonth(new Date(2026, 11, 3), 2), '2027-02-28');
});

test('impact: the month\'s room and the forecast balance with and without the purchase', () => {
  const today = new Date(2026, 9, 15);
  const data = { txs: [], budgets: [], goals: [], installments: [], accounts: [{ balance: 3000 }] };
  const fx = impact({ amount: 2000, wanted_by: '2026-11-30' }, data, today);
  assert.equal(fx.thisMonth, false);
  assert.equal(fx.month, 'נובמבר');
  assert.equal(fx.endBefore, 3000);
  assert.equal(fx.endAfter, 1000);
  assert.equal(fx.turnsNegative, false);
  assert.equal(impact({ amount: 4000 }, data, today).turnsNegative, true);
  assert.equal(impact({ amount: 100 }, { ...data, accounts: [] }, today).hasBalance, false);
});

test('a purchase that seems to have happened is found, near the amount, after the card opened', () => {
  const txs = [
    { id: 't1', type: 'expense', amount: 2390, tx_date: '2026-10-05', description: 'מחסני חשמל' },
    { id: 't2', type: 'expense', amount: 2400, tx_date: '2026-09-20', description: 'לפני הכרטיס' },
    { id: 't3', type: 'income', amount: 2400, tx_date: '2026-10-06' },
    { id: 't4', type: 'expense', amount: 3000, tx_date: '2026-10-07' }
  ];
  assert.equal(findPurchase(d(), txs).id, 't1');
  assert.equal(findPurchase(d(), txs, ['t1']), null, 'already linked to another card');
});

test('the advisor sees open decisions with their status, nothing else', () => {
  const out = forAdvisor([d({ note: 'פרטי' }), d({ id: 'x', status: 'bought' })], [v('approve')], members);
  assert.deepEqual(out, [{ title: 'מכונת כביסה', amount: 2400, wantedBy: null, status: 'approved' }]);
});
