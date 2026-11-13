import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedCosts, findings } from '../public/app/src/domain/fixedcheck.js';

// Made-up household, November 2026: lines from the last 4 months.
const today = new Date(2026, 10, 12);
let n = 0;
const line = (description, amount, month, extra = {}) => ({ id: 'x' + (++n), type: 'expense', description, amount, tx_date: '2026-' + month + '-05', ...extra });
const txs = [
  ...['08', '09', '10', '11'].map((m) => line('פרטנר תקשורת', 136, m)),
  ...['09', '10', '11'].map((m) => line('NETFLIX.COM', 55, m)),
  ...['09', '10', '11'].map((m) => line('DISNEY PLUS', 33, m)),
  line('הראל ביטוח בריאות', 138, '09'), line('הראל ביטוח בריאות', 138, '10'), line('הראל ביטוח בריאות', 152, '11'),
  ...['09', '10', '11'].map((m) => line('מגדל ביטוח בריאות', 118, m)),
  ...['09', '10'].map((m) => line('איילון ביטוח רכב רכוש', 300, m)),
  line('ביטוח רכב חובה (תשלום 3 מתוך 12)', 246.5, '11', { nature: 'fixed' }),
  line('סופר בדוי', 400, '11'), line('בזק', 99, '06'),
  { ...line('פרטנר החזר', 136, '11'), type: 'income' }
];

test('fixed costs by kind: only what comes in at least 2 of the last 4 months (or is marked fixed)', () => {
  const kinds = fixedCosts(txs, { today });
  assert.deepEqual(kinds.map((k) => k.key), ['cell', 'subs', 'ins']);
  const cell = kinds.find((k) => k.key === 'cell');
  assert.deepEqual([cell.total, cell.items.length], [136, 1]);
  assert.equal(kinds.find((k) => k.key === 'subs').total, 88);
  const ins = kinds.find((k) => k.key === 'ins');
  assert.deepEqual(ins.items.map((i) => i.monthly), [300, 246.5, 152, 118], 'one charge marked fixed is enough');
  assert.equal(ins.items.find((i) => i.monthly === 152).before, 138);
  assert.ok(!kinds.some((k) => k.items.some((i) => /סופר|בזק/.test(i.name))), 'a supermarket, and a bill from 5 months ago, are not here');
});

test('what is worth a look: a price that went up, two streaming services, two health insurances, the cellular bill', () => {
  const found = findings(fixedCosts(txs, { today }));
  const types = found.map((f) => f.type);
  assert.ok(types.includes('up'));
  assert.match(found.find((f) => f.type === 'up').text, /הראל ביטוח בריאות עלה מ-₪138 ל-₪152/);
  assert.ok(types.includes('streams'));
  assert.match(found.find((f) => f.type === 'streams').text, /2 שירותי סטרימינג \(₪88 בחודש\)/);
  const h = found.find((f) => f.type === 'health');
  assert.equal(h.link.url, 'https://harb.cma.gov.il/');
  assert.ok(types.includes('cell'));
  // Nothing to say: nothing found.
  assert.deepEqual(findings(fixedCosts([line('NETFLIX.COM', 55, '10'), line('NETFLIX.COM', 55, '11')], { today })), []);
});

test('a subscription that stopped, or a policy that ended, is not a cost any more', () => {
  const kinds = fixedCosts([line('NETFLIX.COM', 33, '08'), line('NETFLIX.COM', 33, '09'), line('ספוטיפיי', 20, '10'), line('ספוטיפיי', 20, '11')], { today });
  assert.deepEqual(kinds.flatMap((k) => k.items.map((i) => i.name)), ['ספוטיפיי']);
});
