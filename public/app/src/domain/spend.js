// How much went on one thing over the last 12 months: a category, a
// sub-category, or a business. Pure.
import { monthShare, merchantKey, MONTH_NAMES } from './money.js';

const isExpense = (t) => t.type !== 'income';

// What each month cost, for the transactions that match.
export function monthlySeries(txs, months, match = () => true) {
  const mine = (txs || []).filter((t) => isExpense(t) && match(t));
  return months.map((mo) => Math.round(mine.reduce((s, t) => s + monthShare(t, mo), 0)));
}

// The year at a glance: total, a month on average, the dearest month.
export function spendStats(series, months) {
  const total = series.reduce((s, v) => s + v, 0);
  let top = -1;
  series.forEach((v, i) => { if (v > 0 && (top < 0 || v > series[top])) top = i; });
  return {
    total,
    avg: months.length ? Math.round(total / months.length) : 0,
    topIndex: top,
    topMonth: top >= 0 ? MONTH_NAMES[months[top].m] : null
  };
}

// The words to search for "every purchase at this place": the chain's name
// (its first word), so "שופרסל דיל" and "שופרסל אקספרס" both count.
export function chainQuery(description) {
  const key = merchantKey(description);
  const first = key.split(' ')[0] || '';
  return first.length >= 3 ? first : key;
}
