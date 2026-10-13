import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalLine } from '../public/app/src/domain/news.js';

const today = new Date(2026, 9, 13);
const m = (back, day = 10) => { const d = new Date(today.getFullYear(), today.getMonth() - back, day); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const cats = [{ id: 'super', name: 'סופר' }, { id: 'mort', name: 'משכנתא' }];

test('prices: groceries now against a year ago, from the household\'s own lines', () => {
  const txs = [1, 2, 3].map((b) => ({ tx_date: m(b), amount: 3100, type: 'expense', category_id: 'super' }))
    .concat([12, 13, 14].map((b) => ({ tx_date: m(b), amount: 2750, type: 'expense', category_id: 'super' })));
  assert.match(personalLine('prices', { txs, categories: cats }, today), /₪3,100 .*₪2,750 .*\+13%/);
  assert.equal(personalLine('prices', { txs: [], categories: cats }, today), null);
});

test('rate: a mortgage payment in the lines; currency: a planned trip; nothing to say: null', () => {
  const txs = [1, 2].map((b) => ({ tx_date: m(b), amount: 4200, type: 'expense', category_id: 'mort' }));
  assert.match(personalLine('rate', { txs, categories: cats }, today), /₪4,200 בחודש.*פריים/);
  const goals = [{ icon: '✈️', name: 'חופשה ברומניה', target_amount: 12000, target_date: '2027-05-01' }];
  assert.match(personalLine('currency', { txs: [], goals }, today), /חופשה ברומניה \(₪12,000\)/);
  assert.equal(personalLine('tax', { txs }, today), null);
  assert.equal(personalLine('currency', { txs: [], goals: [] }, today), null);
});
