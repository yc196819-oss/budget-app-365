// A balance the advisor writes as a card ("how much comes in, how much goes
// out"): income lines, expense lines and, if given, balances to start from.
// The AI gives the lines; the totals and the balance are added up here, so a
// sum is never the AI's arithmetic.
export const BALANCE_MARK = '@@מאזן:';

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const amount = (v) => { const n = Math.round(Number(String(v).replace(/[,₪\s]/g, ''))); return Number.isFinite(n) ? n : null; };
const lines = (a, signed) => (Array.isArray(a) ? a : []).map((x) => ({ label: clean(x && x.label, 60), amount: amount(x && x.amount) }))
  .filter((x) => x.label && x.amount !== null && (signed ? x.amount !== 0 : x.amount > 0)).slice(0, 20);

export function parseBalance(raw) {
  const s = String(raw || '');
  const at = s.indexOf(BALANCE_MARK);
  if (at < 0) return null;
  let rest = s.slice(at + BALANCE_MARK.length);
  const end = rest.indexOf('@@');
  if (end >= 0) rest = rest.slice(0, end);
  const from = rest.indexOf('{');
  const to = rest.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  let j;
  try { j = JSON.parse(rest.slice(from, to + 1)); } catch (_e) { return null; }
  if (!j || typeof j !== 'object') return null;
  const income = lines(j.income, false);
  const expenses = lines(j.expenses, false);
  // Balances to start from: with their sign (an overdraft is negative).
  const start = lines(j.start, true);
  if (!income.length && !expenses.length) return null;
  const sum = (a) => a.reduce((t, x) => t + x.amount, 0);
  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  const totalStart = sum(start);
  return {
    title: clean(j.title, 60) || 'מאזן',
    income, expenses, start,
    totalIncome, totalExpenses, totalStart,
    net: totalIncome - totalExpenses,
    end: totalStart + totalIncome - totalExpenses,
    note: clean(j.note, 200)
  };
}
