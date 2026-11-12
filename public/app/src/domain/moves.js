// Money in from Bit, and money moved to or from an investment: the app asks
// what it was, never decides by itself. Pure.
//
// Bit money in can be:
//   a refund of an expense: the line becomes a minus expense in that
//     expense's category (nature 'refund'), so the expense counts less;
//   income: left as it is;
//   the household's own money (a Bit balance taken out): a transfer.
// Investment money in can be a withdrawal (a transfer, and the investment's
// value goes down) or a gain (income). Money out can be a deposit (a
// transfer, the value goes up) or an ordinary expense.

import { isTransfer } from './transfers.js';

export const REFUND = 'refund';
export const isRefund = (t) => !!t && t.nature === REFUND;

const BIT = /(^|[^א-ת])ביט([^א-ת]|$)|\bbit\b|bit\s*-|paybox|פייבוקס/i;
const INVEST = /ניירות ערך|נ["״׳']ע(?![א-ת])|השקע|קרן נאמנות|קרן כספית|תיק מניות|מניות|גמל להשקעה|פיקדון|פקדון|ברוקר|interactive brokers|אקסלנס|מיטב|פסגות|אלטשולר|בלינק/i;

const daysAgo = (iso, today) => (today - new Date(String(iso).slice(0, 10) + 'T12:00:00')) / 86400000;
const recent = (t, today, days) => { const d = daysAgo(t.tx_date, today); return d >= 0 && d <= days; };
const open = (t, no) => t && t.id && !isTransfer(t) && !isRefund(t) && !no.has(t.id) && Number(t.amount) > 0;

export const isBit = (t) => BIT.test(String(t.description || ''));
// An investment line: its words, or the household's "השקעות" category.
export function isInvest(t, categories = []) {
  if (INVEST.test(String(t.description || ''))) return true;
  const cat = categories.find((c) => c.id === t.category_id || c.id === t.subcategory_id);
  return !!cat && /השקע/.test(cat.name || '');
}

// Lines to ask about, newest first: Bit money in, and money to or from an
// investment, in the last `days` days. A line the household answered is in
// `no` (its id) and not asked again.
export function linesToAsk(txs, { categories = [], no = new Set(), today = new Date(), days = 60 } = {}) {
  const bit = [], invest = [];
  for (const t of txs || []) {
    if (!open(t, no) || !recent(t, today, days)) continue;
    if (isInvest(t, categories)) invest.push(t);
    else if (t.type === 'income' && isBit(t)) bit.push(t);
  }
  const newest = (a, b) => String(b.tx_date).localeCompare(String(a.tx_date));
  return { bit: bit.sort(newest), invest: invest.sort(newest) };
}

// The expenses a Bit refund may be for: up to 45 days before it, from the
// refund's amount to four times it, the closest in amount first (a refund of half a meal
// is common, so twice the amount comes before a much bigger one).
export function refundCandidates(txs, line, { limit = 3 } = {}) {
  const amt = Number(line.amount) || 0;
  const at = new Date(String(line.tx_date).slice(0, 10) + 'T12:00:00');
  const score = (t) => { const r = (Number(t.amount) || 0) / amt; return Math.min(Math.abs(r - 1), Math.abs(r - 2)); };
  return (txs || [])
    // Up to four times the refund: a much bigger purchase is rarely shared.
    .filter((t) => t.id !== line.id && t.type !== 'income' && !isTransfer(t) && !isRefund(t) && Number(t.amount) >= amt && Number(t.amount) <= amt * 4)
    .filter((t) => { const d = daysAgo(t.tx_date, at); return d >= 0 && d <= 45; })
    .sort((a, b) => score(a) - score(b) || String(b.tx_date).localeCompare(String(a.tx_date)))
    .slice(0, limit);
}

// The change that makes a line a refund of an expense: a minus expense in
// the expense's category. And back.
export function asRefund(line, expense) {
  return { type: 'expense', amount: -Math.abs(Number(line.amount) || 0), nature: REFUND, category_id: expense.category_id || null, subcategory_id: expense.subcategory_id || null };
}
export function fromRefund(line) {
  return { type: 'income', amount: Math.abs(Number(line.amount) || 0), nature: 'variable', category_id: null, subcategory_id: null };
}

// An investment's value after money moved: down for a withdrawal, up for a
// deposit (and its cost too). An investment priced live (units of a
// symbol) keeps its value: the household updates the units.
export function investAfter(inv, amount, dir) {
  if (!inv) return null;
  if (inv.symbol && Number(inv.units) > 0) return null;
  const a = Math.abs(Number(amount) || 0);
  const value = Math.max(0, (Number(inv.current_value) || 0) + (dir === 'in' ? a : -a));
  const out = { id: inv.id, current_value: Math.round(value * 100) / 100, value_updated_at: new Date().toISOString() };
  if (dir === 'in') out.cost = Math.round(((Number(inv.cost) || 0) + a) * 100) / 100;
  return out;
}
