import test from 'node:test';
import assert from 'node:assert/strict';
import { priceRises } from '../public/app/src/domain/rises.js';

const TODAY = new Date(2026, 10, 17);
const tx = (id, d, amount, description = 'ביטוח בדוי בע"מ') => ({ id, type: 'expense', tx_date: d, amount, description });

test('a steady monthly payment that went up 5% and ₪10 or more: shown with the yearly cost', () => {
  const r = priceRises([tx('a', '2026-08-03', 180), tx('b', '2026-09-03', 180), tx('c', '2026-10-03', 181), tx('d', '2026-11-03', 202)], TODAY);
  assert.equal(r.length, 1);
  assert.deepEqual({ from: r[0].from, to: r[0].to, pct: r[0].pct, perYear: r[0].perYear, key: r[0].key }, { from: 181, to: 202, pct: 12, perYear: 252, key: 'rise:d' });
});

test('not a rise: too small, an old rise, a shop charged twice a month, or no steady months before', () => {
  assert.deepEqual(priceRises([tx('a', '2026-09-03', 50), tx('b', '2026-10-03', 50), tx('c', '2026-11-03', 55)], TODAY), [], 'under ₪10');
  assert.deepEqual(priceRises([tx('a', '2026-06-03', 180), tx('b', '2026-07-03', 180), tx('c', '2026-08-03', 220)], TODAY), [], 'months ago');
  assert.deepEqual(priceRises([tx('a', '2026-09-03', 180), tx('a2', '2026-09-20', 90), tx('b', '2026-10-03', 180), tx('c', '2026-11-03', 220)], TODAY), [], 'twice a month');
  assert.deepEqual(priceRises([tx('a', '2026-09-03', 120), tx('b', '2026-10-03', 180), tx('c', '2026-11-03', 220)], TODAY), [], 'not steady');
});
