import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRepairs, estimatedDate, normName } from '../public/app/src/domain/repair.js';

// Made-up households. A card statement read badly: every purchase got the
// day the card was charged (10.10).
let n = 0;
const tx = (o) => ({ id: 't' + (++n), type: 'expense', card_id: 'card-a', import_id: 'imp-new', tx_date: '2026-10-10', amount: 50, description: 'חנות', ...o });

function household() {
  n = 0;
  const earlier = [
    // An earlier upload of the same card, with real dates.
    tx({ import_id: 'imp-old', tx_date: '2026-09-05', description: 'מאפיית הדר 12', amount: 42.5 }),
    tx({ import_id: 'imp-old', tx_date: '2026-09-12', description: 'דלק פז', amount: 300 }),
    // A coffee bought every week at the same price.
    tx({ import_id: 'imp-old', tx_date: '2026-09-03', description: 'קפה נמרוד', amount: 14 }),
    tx({ import_id: 'imp-old', tx_date: '2026-09-17', description: 'קפה נמרוד', amount: 14 })
  ];
  const bad = [
    tx({ description: 'מאפיית הדר', amount: 42.5 }), // already there: dropped
    tx({ description: 'דלק פז!', amount: 300 }), // already there: dropped
    tx({ description: 'קפה נמרוד', amount: 14 }), // could be another coffee: moved
    ...Array.from({ length: 7 }, (_, i) => tx({ description: 'ספרים ' + 'אבגדהוז'[i], amount: 20 + i })),
    tx({ tx_date: '2026-09-28', description: 'בית מרקחת', amount: 33 }) // its own date: left alone
  ];
  return { earlier, bad, txs: [...earlier, ...bad] };
}

test('a statement dated by the charge day: duplicates dropped, the rest moved to the month before', () => {
  const { bad, txs } = household();
  const [r] = findRepairs(txs);
  assert.equal(r.kind, 'chargedate');
  assert.equal(r.day, '2026-10-10');
  assert.equal(r.moveTo, '2026-09-30');
  assert.equal(r.count, 10);
  assert.deepEqual(r.drop, [bad[0].id, bad[1].id]);
  assert.equal(r.dropTotal, 342.5);
  assert.equal(r.move.length, 8);
  assert.ok(r.move.includes(bad[2].id), 'the weekly coffee is moved, never dropped');
  assert.ok(!r.move.includes(bad[10].id) && !r.drop.includes(bad[10].id), 'a line with its own date is left alone');
});

test('nothing to fix in a normal statement, in a small file, or once kept as is', () => {
  const { earlier, txs } = household();
  assert.deepEqual(findRepairs(earlier), []);
  const spread = Array.from({ length: 20 }, (_, i) => tx({ import_id: 'imp-x', tx_date: '2026-10-' + String(i + 1).padStart(2, '0') }));
  assert.deepEqual(findRepairs(spread), []);
  const few = Array.from({ length: 6 }, () => tx({ import_id: 'imp-y' }));
  assert.deepEqual(findRepairs(few), []);
  const [r] = findRepairs(txs);
  assert.deepEqual(findRepairs(txs, new Set([r.key])), []);
  // Incomes are never moved.
  assert.deepEqual(findRepairs(Array.from({ length: 10 }, () => tx({ import_id: 'imp-z', type: 'income' }))), []);
});

test('a file that was not a statement: dozens of ₪1 lines, reported once, not also for its dates', () => {
  const junk = Array.from({ length: 17 }, () => tx({ import_id: 'imp-junk', card_id: null, tx_date: '2026-10-28', amount: 1, description: 'שורה ארוכה מתוך מסמך שאינו פירוט' }));
  const list = findRepairs(junk);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'junk');
  assert.equal(list[0].count, 17);
  assert.equal(list[0].ids.length, 17);
});

test('the estimated date: a charge early in the month pays for the month before', () => {
  assert.equal(estimatedDate('2026-10-10'), '2026-09-30');
  assert.equal(estimatedDate('2026-10-02'), '2026-09-30');
  assert.equal(estimatedDate('2026-03-15'), '2026-02-28');
  assert.equal(estimatedDate('2026-01-05'), '2025-12-31');
  assert.equal(estimatedDate('2026-10-28'), '2026-10-15');
  assert.equal(normName('דלק פז 123!'), 'דלקפז');
});

test('once fixed, the moved lines (now on one day) are never reported again', () => {
  const { txs } = household();
  const [r] = findRepairs(txs);
  const gone = new Set(r.drop);
  const after = txs.filter((t) => !gone.has(t.id)).map((t) => (r.move.includes(t.id) ? { ...t, tx_date: r.moveTo, source: 'repaired' } : t));
  assert.deepEqual(findRepairs(after), []);
});

test('a big shopping day in a real statement is not a mistake', () => {
  n = 0;
  const day = Array.from({ length: 10 }, (_, i) => tx({ import_id: 'imp-real', description: 'קניון ' + i, amount: 30 + i }));
  const rest = Array.from({ length: 4 }, (_, i) => tx({ import_id: 'imp-real', tx_date: '2026-10-0' + (i + 1), description: 'מכולת ' + i }));
  assert.deepEqual(findRepairs([...day, ...rest]), [], '10 of 14 lines on one day is 71%: not certain');
  const spread = [...day, ...Array.from({ length: 2 }, (_, i) => tx({ import_id: 'imp-real', tx_date: '2026-10-0' + (i + 1) })), ...Array.from({ length: 2 }, (_, i) => tx({ import_id: 'imp-real', tx_date: '2026-10-2' + (i + 1) }))];
  assert.deepEqual(findRepairs(spread), [], 'spread over 5 days: a real statement');
  const nine = Array.from({ length: 9 }, () => tx({ import_id: 'imp-9' }));
  assert.deepEqual(findRepairs(nine), [], 'fewer than 10 lines: never');
});
