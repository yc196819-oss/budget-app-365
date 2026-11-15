// Pure logic for the Assets screen: what the household has and owes. No DOM,
// no network. Rows come from the same tables the current app uses:
//   bank_accounts { id, name, bank_name, balance, balance_updated_at }
//   investments   { id, name, asset_type, symbol, units, currency, cost, current_value, value_updated_at }
//   loans         { id, direction: 'iowe' | 'tome', counterparty, amount, loan_date, note, settled,
//                   monthly_amount, first_payment } (paid back month by month: amount is the
//                   debt when the payments start)
//   installments  { id, description, total_amount, payments_count, first_payment }

import { parseDate } from './money.js';
import { cardCycle } from './home.js';
import { INVEST } from './moves.js';

const num = (v) => Number(v) || 0;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

// Pension, study fund and provident funds are long-term money.
export function isLongTerm(inv) {
  return /פנסי|השתלמות|גמל|ביטוח מנהלים/.test(String(inv.asset_type || '') + ' ' + String(inv.name || ''));
}

// With a live quote and units, the value is units × price (× USD/ILS);
// otherwise the value typed in by hand.
export function investmentValue(inv, market) {
  const q = market && market.quotes && inv.symbol ? market.quotes[inv.symbol] : null;
  if (q && !q.error && num(inv.units) > 0) {
    const rate = q.currency === 'ILS' ? 1 : q.currency === 'ILA' ? 0.01 : num(market.usdIls);
    if (rate > 0) return { value: num(inv.units) * num(q.price) * rate, live: true, changePct: q.changePct ?? null };
  }
  return { value: num(inv.current_value), live: false, changePct: null };
}

export function gain(inv, value) {
  const cost = num(inv.cost);
  return cost > 0 ? { amount: value - cost, pct: ((value - cost) / cost) * 100 } : null;
}

// Payments left on an installment purchase.
export function installmentLeft(inst, today) {
  const count = num(inst.payments_count);
  const total = num(inst.total_amount);
  if (!count || !total || !inst.first_payment) return { left: 0, amount: 0, monthly: 0 };
  const f = parseDate(inst.first_payment);
  // Payments made: months from the first payment up to this month, counting a
  // payment as made once its day has come.
  let made = (today.getFullYear() - f.y) * 12 + (today.getMonth() - f.m) + (today.getDate() >= f.d ? 1 : 0);
  made = Math.max(0, Math.min(count, made));
  const monthly = total / count;
  return { left: count - made, amount: (count - made) * monthly, monthly };
}

export function openLoans(loans, today = new Date()) {
  return loans.filter((l) => !l.settled && loanPlan(l, today).left > 0);
}

// ── debts paid back month by month ──────────────────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;
const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// Payment k (from 0): the first payment's day, k months on (the 31st is the
// month's last day in a shorter month).
function payDate(f, k) {
  const y = f.y + Math.floor((f.m + k) / 12);
  const m = (f.m + k) % 12;
  return new Date(y, m, Math.min(f.d, new Date(y, m + 1, 0).getDate()));
}
const payAmount = (amount, monthly, k) => round2(Math.max(0, Math.min(monthly, amount - k * monthly)));

// Where a debt stands: how much is left today, how many payments were made
// and are left, the next one (date and sum) and the month of the last. With
// no monthly payment, just what was typed as left.
export function loanPlan(l, today = new Date()) {
  const amount = num(l.amount);
  const monthly = num(l.monthly_amount);
  if (!(monthly > 0) || !l.first_payment) return { plan: false, amount, left: amount };
  const f = parseDate(l.first_payment);
  const count = Math.max(1, Math.ceil(amount / monthly - 1e-9));
  const now = dayOnly(today);
  let paid = 0;
  while (paid < count && payDate(f, paid) <= now) paid++;
  const left = round2(Math.max(0, amount - paid * monthly));
  return {
    plan: true, amount, monthly, count, paid, left,
    next: paid < count ? payDate(f, paid) : null,
    nextAmount: paid < count ? payAmount(amount, monthly, paid) : 0,
    last: payDate(f, count - 1),
    done: left <= 0
  };
}

// The payment of a debt due in a month ({ y, m }), if any: its sum, its
// number and date.
export function loanDueIn(l, mo) {
  const amount = num(l.amount);
  const monthly = num(l.monthly_amount);
  if (l.settled || !(monthly > 0) || !l.first_payment) return null;
  const f = parseDate(l.first_payment);
  const k = (mo.y - f.y) * 12 + (mo.m - f.m);
  const count = Math.max(1, Math.ceil(amount / monthly - 1e-9));
  if (k < 0 || k >= count) return null;
  return { amount: payAmount(amount, monthly, k), n: k + 1, count, date: payDate(f, k) };
}

// properties: the family's apartments (their value is had, their mortgage owed).
export function summary({ accounts = [], investments = [], loans = [], installments = [], cards = [], txs = [], market = null, today, properties = [] }) {
  const cash = sum(accounts.filter((a) => a.balance !== null && a.balance !== undefined && a.balance !== ''), (a) => num(a.balance));
  const values = investments.map((i) => ({ inv: i, ...investmentValue(i, market) }));
  const longTerm = sum(values.filter((v) => isLongTerm(v.inv)), (v) => v.value);
  const invest = sum(values.filter((v) => !isLongTerm(v.inv)), (v) => v.value);
  const open = openLoans(loans, today);
  const owedToUs = sum(open.filter((l) => l.direction === 'tome'), (l) => loanPlan(l, today).left);
  const loanDebt = sum(open.filter((l) => l.direction !== 'tome'), (l) => loanPlan(l, today).left);
  const instDebt = sum(installments, (i) => installmentLeft(i, today).amount);
  const cardDebt = sum(cards, (c) => cardCycle(c, txs, today).pending);
  const realEstate = sum(properties, (p) => num(p.value));
  const mortgages = sum(properties, (p) => (p.mortgage ? num(p.mortgage.balance) : 0));
  const assets = cash + invest + longTerm + owedToUs + realEstate;
  const debts = loanDebt + instDebt + cardDebt + mortgages;
  return {
    cash, invest, longTerm, owedToUs, loanDebt, instDebt, cardDebt, realEstate, mortgages,
    assets, debts, net: assets - debts,
    // "Daily" money: what is in the bank and what will go out of it soon.
    daily: { have: cash + owedToUs, owe: loanDebt + instDebt + cardDebt },
    hasAnything: accounts.length + investments.length + loans.length + installments.length + cards.length > 0
  };
}

// Symbols worth asking the server a quote for.
export function symbolsOf(investments) {
  return [...new Set(investments.map((i) => String(i.symbol || '').trim().toUpperCase()).filter((s) => /^[A-Z0-9.\-=^]{1,15}$/.test(s)))];
}

// ── what went into investments, from the lines ──────────────────────────
// The lines sorted to the household's "השקעות" category (or one under it),
// and lines with no category whose words say investment (a fund, securities,
// a trading platform). Money out of the account is a deposit; money back in
// that category is a withdrawal. No return is counted: what was put in.
const ymOf = (iso) => String(iso || '').slice(0, 7);
const ymBack = (today, k) => { const d = new Date(today.getFullYear(), today.getMonth() - k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
export function investDeposits(txs = [], categories = [], today = new Date()) {
  const inv = new Set(categories.filter((c) => (c.kind || 'expense') !== 'income' && /השקע/.test(c.name || '')).map((c) => c.id));
  for (const c of categories) if (c.parent_id && inv.has(c.parent_id)) inv.add(c.id);
  const isInv = (t) => (t.category_id ? inv.has(t.category_id) || inv.has(t.subcategory_id) : t.type !== 'income' && INVEST.test(String(t.description || '')));
  const lines = txs.filter((t) => t.tx_date && isInv(t));
  const nowYm = ymBack(today, 0);
  const year = new Set(Array.from({ length: 12 }, (_, k) => ymBack(today, k + 1)));
  const deposits = lines.filter((t) => t.type !== 'income');
  const back = lines.filter((t) => t.type === 'income');
  const total = round2(sum(deposits, (t) => num(t.amount)));
  const withdrawn = round2(sum(back, (t) => num(t.amount)));
  const inYear = deposits.filter((t) => year.has(ymOf(t.tx_date)));
  const first = deposits.reduce((m, t) => (!m || t.tx_date < m ? t.tx_date : m), '');
  // The average is over the full months since the first deposit (up to 12),
  // so a fund opened 3 months ago is not divided by 12.
  const months = first ? Math.min(12, Math.max(1, Array.from(year).filter((ym) => ym >= ymOf(first)).length)) : 0;
  const lastYear = round2(sum(inYear, (t) => num(t.amount)));
  const byMonth = Array.from({ length: 6 }, (_, k) => { const ym = ymBack(today, 5 - k); return { ym, amount: round2(sum(deposits.filter((t) => ymOf(t.tx_date) === ym), (t) => num(t.amount))) }; });
  const where = new Map();
  for (const t of deposits) { const k = String(t.description || '').trim() || 'השקעה'; where.set(k, round2((where.get(k) || 0) + num(t.amount))); }
  return {
    any: deposits.length > 0,
    count: deposits.length,
    total, withdrawn, net: round2(total - withdrawn),
    lastYear,
    monthlyAvg: months ? Math.round(lastYear / months) : 0,
    months,
    thisMonth: round2(sum(deposits.filter((t) => ymOf(t.tx_date) === nowYm), (t) => num(t.amount))),
    first: first || null,
    byMonth,
    where: Array.from(where, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 4)
  };
}
