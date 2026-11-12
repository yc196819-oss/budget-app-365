import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, guideSteps, guideProgress, looseTxs, looseGroups, needsImportNotice, IMPORT_FIX_AT } from '../public/app/src/domain/guide.js';

const TODAY = new Date('2026-11-02T12:00:00Z');
const tx = (o) => ({ id: 't' + Math.random(), type: 'expense', amount: 10, tx_date: '2026-10-20', source: 'pdf', category_id: 'c', ...o });

test('a new household starts at the statement, and every step ticks from the data', () => {
  const empty = guideProgress(guideSteps({ txs: [], budgets: [], cards: [], income: [], members: { u1: 'א' } }, { today: TODAY }));
  assert.equal(empty.next.key, 'import');
  assert.deepEqual([empty.finished, empty.total], [0, STEPS.length]);

  const data = { txs: [tx({}), tx({ category_id: null, description: 'ארומה' })], budgets: [{ monthly_amount: 3000 }], cards: [], income: [{ amount: 18000 }], members: { u1: 'א' } };
  const s = guideSteps(data, { today: TODAY });
  const done = Object.fromEntries(s.map((x) => [x.key, x.done]));
  assert.deepEqual(done, { import: true, sort: false, income: true, budget: true, card: false, ask: false });
  assert.equal(guideProgress(s).next.key, 'sort', 'one line without a category is the next step');
});

test('skipped steps leave the count, a question asked on the device counts, and all done hides the guide', () => {
  const data = { txs: [tx({})], budgets: [{ monthly_amount: 1 }], cards: [{ id: 'c1' }], income: [{ amount: 1 }], members: { u1: 'א', u2: 'ב' } };
  assert.equal(guideProgress(guideSteps(data, { today: TODAY })).next.key, 'ask');
  const p = guideProgress(guideSteps(data, { asked: true, today: TODAY }));
  assert.equal(p.complete, true);
  const sk = guideProgress(guideSteps({ ...data, cards: [] }, { asked: true, skipped: new Set(['card']), today: TODAY }));
  assert.deepEqual([sk.complete, sk.total], [true, STEPS.length - 1]);
  assert.ok(!STEPS.some((x) => x.key === 'partner'), 'inviting a partner is not a step any more');
});

test('lines without a category: recent only, one group per merchant and type, biggest first', () => {
  const txs = [
    tx({ id: 'a', category_id: null, description: 'ארומה תל אביב', amount: 30 }),
    tx({ id: 'b', category_id: null, description: 'ארומה', amount: 25 }),
    tx({ id: 'c', category_id: null, description: 'משכנתא', amount: 6000 }),
    tx({ id: 'd', category_id: null, description: 'ארומה', type: 'income', amount: 5 }),
    tx({ id: 'e', category_id: null, description: 'ישן', tx_date: '2025-01-01' })
  ];
  const loose = looseTxs(txs, TODAY);
  assert.deepEqual(loose.map((t) => t.id), ['a', 'b', 'c', 'd']);
  const g = looseGroups(loose);
  assert.deepEqual(g.map((x) => [x.description, x.type, x.ids.length, x.total]), [['משכנתא', 'expense', 1, 6000], ['ארומה תל אביב', 'expense', 2, 55], ['ארומה', 'income', 1, 5]]);
});

test('the apology shows once, only to those who imported before the fix', () => {
  const before = [tx({ created_at: '2026-11-01T18:14:44Z' })];
  assert.equal(needsImportNotice(before, false), true);
  assert.equal(needsImportNotice(before, true), false);
  assert.equal(needsImportNotice([tx({ created_at: IMPORT_FIX_AT.replace('02T', '03T') })], false), false);
  assert.equal(needsImportNotice([tx({ source: 'manual', created_at: '2026-10-01T00:00:00Z' })], false), false);
});
