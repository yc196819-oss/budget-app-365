// Pure logic for the Assets screen: what the household has and owes. No DOM,
// no network. Rows come from the same tables the current app uses:
//   bank_accounts { id, name, bank_name, balance, balance_updated_at }
//   investments   { id, name, asset_type, symbol, units, currency, cost, current_value, value_updated_at }
//   loans         { id, direction: 'iowe' | 'tome', counterparty, amount, loan_date, note, settled }
//   installments  { id, description, total_amount, payments_count, first_payment }

import { parseDate } from './money.js';
import { cardCycle } from './home.js';

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

export function openLoans(loans) {
  return loans.filter((l) => !l.settled && num(l.amount) > 0);
}

export function summary({ accounts = [], investments = [], loans = [], installments = [], cards = [], txs = [], market = null, today }) {
  const cash = sum(accounts.filter((a) => a.balance !== null && a.balance !== undefined && a.balance !== ''), (a) => num(a.balance));
  const values = investments.map((i) => ({ inv: i, ...investmentValue(i, market) }));
  const longTerm = sum(values.filter((v) => isLongTerm(v.inv)), (v) => v.value);
  const invest = sum(values.filter((v) => !isLongTerm(v.inv)), (v) => v.value);
  const open = openLoans(loans);
  const owedToUs = sum(open.filter((l) => l.direction === 'tome'), (l) => num(l.amount));
  const loanDebt = sum(open.filter((l) => l.direction !== 'tome'), (l) => num(l.amount));
  const instDebt = sum(installments, (i) => installmentLeft(i, today).amount);
  const cardDebt = sum(cards, (c) => cardCycle(c, txs, today).pending);
  const assets = cash + invest + longTerm + owedToUs;
  const debts = loanDebt + instDebt + cardDebt;
  return {
    cash, invest, longTerm, owedToUs, loanDebt, instDebt, cardDebt,
    assets, debts, net: assets - debts,
    // "Daily" money: what is in the bank and what will go out of it soon.
    daily: { have: cash + owedToUs, owe: debts },
    hasAnything: accounts.length + investments.length + loans.length + installments.length + cards.length > 0
  };
}

// Symbols worth asking the server a quote for.
export function symbolsOf(investments) {
  return [...new Set(investments.map((i) => String(i.symbol || '').trim().toUpperCase()).filter((s) => /^[A-Z0-9.\-=^]{1,15}$/.test(s)))];
}
