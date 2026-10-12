import { CATS, detectTrips } from '../../domain/trips.js';
import { knownIds } from '../../data/trips.js';
import { MONTH_NAMES } from '../../domain/money.js';

// Shared by the trip screens.
export const COLORS = { lodging: '#D98B33', flights: '#F2B66D', shopping: '#C9A27A', transport: '#8FB3A5', food: '#E07A5F', attractions: '#B48EAD', other: '#8A7663' };
export const CAT_LIST = Object.entries(CATS);

const dm = (s) => +s.slice(8, 10) + '.' + +s.slice(5, 7);
export function dateRange(a, b) {
  return a.slice(0, 7) === b.slice(0, 7) ? +a.slice(8, 10) + '–' + +b.slice(8, 10) + ' ב' + MONTH_NAMES[+a.slice(5, 7) - 1] + ' ' + a.slice(0, 4) : dm(a) + '–' + dm(b) + '.' + b.slice(0, 4);
}
export const monthLabel = (ym) => MONTH_NAMES[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);

// The category name of a transaction (its sub-category first), for the trip lines.
export function categoryNamer(categories) {
  const byId = new Map((categories || []).map((c) => [c.id, c.name]));
  return (t) => byId.get(t.subcategory_id) || byId.get(t.category_id) || '';
}

// A saved folder as a trip: its transactions (still in the data), less the excluded.
export function folderTrip(row, txs) {
  const ids = new Set(row.transaction_ids || []);
  const items = txs.filter((t) => ids.has(t.id)).map((t) => ({ ...t, when: t.tx_date < row.start_date ? 'before' : 'during' }))
    .sort((a, b) => (a.tx_date < b.tx_date ? -1 : 1));
  return { id: row.id, country: row.country || '', start: row.start_date, end: row.end_date, items, name: row.name };
}

// Trips found in the data and not yet saved or dismissed, newest first, from the last year.
export function newTrips(txs, rows, today = new Date()) {
  const since = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
  return detectTrips(txs, { skip: knownIds(rows) }).filter((t) => t.end >= since).reverse();
}
