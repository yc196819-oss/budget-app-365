// Budget and goal suggestions from the household's own numbers. Pure.
// Nothing here is a national average or a rule of thumb about other
// families: only what this household really spent and kept.

import { categoryRows, monthShare } from './money.js';

const roundTo = (n, step) => Math.round(n / step) * step;

// The last `n` whole months before today that have any expense at all (a
// month before the first upload would pull every average down).
export function pastMonths(txs, today, n = 3) {
  const out = [];
  for (let back = 1; back <= 12 && out.length < n; back++) {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const mo = { y: d.getFullYear(), m: d.getMonth() };
    if (txs.some((t) => t.type !== 'income' && monthShare(t, mo) > 0)) out.push(mo);
  }
  return out;
}

// Per top category: the monthly average over those months, and the total.
export function averages({ txs, categories, today, n = 3 }) {
  const months = pastMonths(txs, today, n);
  const byCat = new Map();
  if (!months.length) return { months, byCat, total: 0 };
  for (const r of categoryRows(txs, categories, [], months)) {
    if (r.id) byCat.set(r.id, r.spent / months.length);
  }
  const total = [...byCat.values()].reduce((s, v) => s + v, 0);
  return { months, byCat, total };
}

// A budget a little under what is really spent: the average less 5%,
// rounded to ₪50 (₪10 under ₪200). Never 0 for a category with spending.
export function suggestBudget(avg, cut = 0.05) {
  const v = (Number(avg) || 0) * (1 - cut);
  if (v <= 0) return 0;
  return Math.max(10, v < 200 ? roundTo(v, 10) : roundTo(v, 50));
}

// How far into the month today is, 0..1.
export function monthPace(today) {
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return Math.min(1, today.getDate() / days);
}

// Where the month stands against the budgets that are set: spent, planned,
// where they "should" be by today, and the category furthest over its pace.
export function paceOf({ txs, categories, budgets, today }) {
  const mo = { y: today.getFullYear(), m: today.getMonth() };
  const pace = monthPace(today);
  const rows = categoryRows(txs, categories, budgets, [mo]).filter((r) => r.id && r.budget > 0);
  const planned = rows.reduce((s, r) => s + r.budget, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  let worst = null;
  for (const r of rows) {
    const ahead = r.spent - r.budget * pace;
    if (ahead > 0 && (!worst || ahead > worst.ahead)) worst = { id: r.id, name: r.name, ahead };
  }
  const expected = planned * pace;
  const state = !planned ? 'none' : spent > planned ? 'over' : spent > expected * 1.1 ? 'ahead' : 'ok';
  return { pace, planned, spent, expected, state, worst };
}

// What was left at the end of a month, on average: income less expenses,
// over the same months as the averages. null without income lines.
export function averageLeft(txs, months) {
  if (!months.length) return null;
  let income = 0;
  let spent = 0;
  for (const t of txs) {
    const v = months.reduce((s, mo) => s + monthShare(t, mo), 0);
    if (!v) continue;
    if (t.type === 'income') income += v; else spent += v;
  }
  if (!income) return null;
  return (income - spent) / months.length;
}

// Whole months from today until a goal's date (at least 1).
export function monthsUntil(dateIso, today) {
  const [y, m] = String(dateIso).split('-').map(Number);
  return Math.max(1, (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth()));
}

// How much to put aside each month to reach a goal in time.
export function monthlyFor({ target, saved = 0, date, today }) {
  const left = Math.max(0, (Number(target) || 0) - (Number(saved) || 0));
  if (!left || !date) return 0;
  return Math.ceil(left / monthsUntil(date, today) / 10) * 10;
}

// An emergency fund: three months of this household's own expenses.
export function emergencyTarget(totalAvg) {
  return totalAvg > 0 ? roundTo(totalAvg * 3, 100) : 0;
}

// A date `months` from today, on the first of that month.
export function dateIn(months, today) {
  const d = new Date(today.getFullYear(), today.getMonth() + months, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
}
