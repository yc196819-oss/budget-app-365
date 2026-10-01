// Pure logic for the Home screen: this month's budget and pace, a forecast
// for the end of the month, what is coming up, cash in the bank and what
// needs attention. No DOM, no network.

import { isoDate, parseDate, monthShare, sameMerchant, categoryRows, totalsFor, monthsBack } from './money.js';
import { bestDuplicate } from './statement.js';
import { money } from './format.js';

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

const isExpense = (t) => t.type !== 'income';
const sum = (list, f = (x) => x) => list.reduce((s, x) => s + f(x), 0);
const dm = (iso) => { const d = parseDate(iso); return d.d + '.' + (d.m + 1); };

// Fixed lines of last month that have not shown up yet this month: they are
// expected on the same day of the month.
export function expectedFixed(txs, today) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const last = new Date(y, m - 1, 1);
  const prev = txs.filter((t) => t.nature === 'fixed' && t.spread !== 'year' && (() => { const d = parseDate(t.tx_date); return d.y === last.getFullYear() && d.m === last.getMonth(); })());
  const now = txs.filter((t) => { const d = parseDate(t.tx_date); return d.y === y && d.m === m; });
  const dim = daysInMonth(y, m);
  const out = [];
  for (const t of prev) {
    if (now.some((n) => n.type === t.type && sameMerchant(n.description, t.description))) continue;
    if (out.some((o) => o.type === t.type && sameMerchant(o.description, t.description))) continue;
    const day = Math.min(parseDate(t.tx_date).d, dim);
    // A payment whose day already passed may just be late; still expected this month.
    out.push({ date: isoDate(new Date(y, m, Math.max(day, today.getDate()))), day, description: t.description, amount: Number(t.amount) || 0, type: t.type, late: day < today.getDate() });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Average variable spending of the last 3 full months (before this one).
function avgVariable(txs, today) {
  const months = monthsBack(new Date(today.getFullYear(), today.getMonth() - 1, 1), 3);
  const vals = months.map((mo) => sum(txs.filter((t) => isExpense(t) && t.nature !== 'fixed'), (t) => monthShare(t, mo)));
  const used = vals.filter((v) => v > 0);
  return used.length ? sum(used) / used.length : 0;
}

export function monthPlan({ txs, budgets, today }) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const mo = { y, m };
  const dim = daysInMonth(y, m);
  const day = today.getDate();
  const exp = txs.filter(isExpense);
  const spent = sum(exp, (t) => monthShare(t, mo));
  const variableSpent = sum(exp.filter((t) => t.nature !== 'fixed'), (t) => monthShare(t, mo));
  const incomeSoFar = sum(txs.filter((t) => t.type === 'income'), (t) => monthShare(t, mo));
  const budget = sum(budgets, (b) => Number(b.monthly_amount) || 0);
  const coming = expectedFixed(txs, today);
  const fixedExpenseLeft = sum(coming.filter(isExpense), (t) => t.amount);
  const fixedIncomeLeft = sum(coming.filter((t) => t.type === 'income'), (t) => t.amount);

  // Pace of variable spending, leaning on the last 3 months early in the
  // month when a few days say little.
  const avg = avgVariable(txs, today);
  const w = day / dim;
  const pace = (variableSpent / day) * dim;
  const variableProjected = Math.max(variableSpent, avg > 0 ? w * pace + (1 - w) * avg : pace);
  const projectedExpense = spent + fixedExpenseLeft + (variableProjected - variableSpent);
  const projectedIncome = incomeSoFar + fixedIncomeLeft;

  const remaining = budget - spent;
  const daysLeft = dim - day + 1;
  return {
    month: mo,
    budget,
    hasBudget: budget > 0,
    spent,
    variableSpent,
    remaining,
    daysLeft,
    perDayLeft: budget > 0 ? Math.max(0, remaining - fixedExpenseLeft) / daysLeft : 0,
    spentPct: budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0,
    dayPct: Math.round((day / dim) * 100),
    avgVariable: avg,
    incomeSoFar,
    fixedExpenseLeft,
    fixedIncomeLeft,
    projectedExpense,
    projectedIncome,
    projectedEnd: projectedIncome - projectedExpense,
    // Without income data the end-of-month number means nothing.
    canForecast: projectedIncome > 0
  };
}

// ── cards and cash ─────────────────────────────────────────────────────

function billingDate(y, m, billingDay) {
  return new Date(y, m, Math.min(billingDay, daysInMonth(y, m)));
}

// Card purchases are charged on the card's billing day for the cycle
// before it. What is not charged yet: purchases from the start of the month
// of the last billing date that already passed (an estimate).
export function cardCycle(card, txs, today) {
  const day = Number(card.billing_day) || 10;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let last = billingDate(today.getFullYear(), today.getMonth(), day);
  if (last > t0) last = billingDate(today.getFullYear(), today.getMonth() - 1, day);
  let next = billingDate(today.getFullYear(), today.getMonth(), day);
  if (next < t0) next = billingDate(today.getFullYear(), today.getMonth() + 1, day);
  const since = isoDate(new Date(last.getFullYear(), last.getMonth(), 1));
  const nextCycleEnd = isoDate(new Date(next.getFullYear(), next.getMonth(), 0));
  const mine = txs.filter((t) => t.card_id === card.id && isExpense(t) && t.tx_date >= since);
  return {
    id: card.id,
    name: card.name,
    last: isoDate(last),
    next: isoDate(next),
    daysSinceLast: Math.round((t0 - last) / 86400000),
    pending: sum(mine, (t) => Number(t.amount) || 0),
    // What the next charge will be: the purchases of the month before it.
    nextAmount: sum(mine.filter((t) => t.tx_date <= nextCycleEnd), (t) => Number(t.amount) || 0)
  };
}

export function cashNow(accounts, cards, txs, today) {
  const withBalance = accounts.filter((a) => a.balance !== null && a.balance !== undefined && a.balance !== '');
  if (!withBalance.length) return { known: false };
  const balance = sum(withBalance, (a) => Number(a.balance) || 0);
  const ids = new Set(withBalance.map((a) => a.id));
  // Cards that are not linked to any account are assumed to be paid from these accounts.
  const linked = cards.filter((c) => !c.bank_account_id || ids.has(c.bank_account_id));
  const pending = sum(linked, (c) => cardCycle(c, txs, today).pending);
  const updated = withBalance.map((a) => a.balance_updated_at).filter(Boolean).sort()[0] || null;
  return { known: true, balance, pending, free: balance - pending, updatedAt: updated };
}

// ── upcoming and attention ─────────────────────────────────────────────

export function upcoming({ txs, cards, today, days = 14 }) {
  const until = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  const from = isoDate(today);
  const items = expectedFixed(txs, today)
    .filter((t) => t.date <= until)
    .map((t) => ({ date: t.date, label: dm(t.date), title: t.description, detail: t.type === 'income' ? 'הכנסה קבועה' : 'הוצאה קבועה', amount: t.type === 'income' ? t.amount : -t.amount }));
  for (const c of cards) {
    const cyc = cardCycle(c, txs, today);
    if (cyc.next < from || cyc.next > until) continue;
    items.push({ date: cyc.next, label: dm(cyc.next), title: c.name, detail: 'חיוב אשראי', amount: cyc.nextAmount ? -cyc.nextAmount : null });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Months before this one that ended in the red, counted back from last month.
export function minusStreak(txs, today) {
  let n = 0;
  for (let i = 1; i <= 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const mo = { y: d.getFullYear(), m: d.getMonth() };
    const tot = totalsFor(txs, [mo]);
    if (tot.income === 0 && tot.expense === 0) break;
    if (tot.net < 0) n++; else break;
  }
  return n;
}

// Pairs of lines from the last 45 days that look like the same payment.
export function suspectedDuplicates(txs, today) {
  const since = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 45));
  const recent = txs.filter((t) => t.tx_date >= since && isExpense(t)).sort((a, b) => (a.tx_date < b.tx_date ? -1 : 1));
  const out = [];
  for (let i = 0; i < recent.length; i++) {
    const t = recent[i];
    const hit = bestDuplicate({ ...t, date: t.tx_date, amount: Number(t.amount), type: t.type || 'expense' }, recent.slice(0, i));
    if (hit && hit.score >= 85) out.push({ tx: t, of: hit.tx });
  }
  return out;
}

const MONTH_WORDS = ['חודש אחד', 'חודשיים', '3 חודשים', '4 חודשים', '5 חודשים', '6 חודשים'];

// At most `limit` items, most important first. Each has an action:
// { to: 'money-cats' | 'money' | 'plans' | 'import' | 'tx', id? }
export function attention({ txs, categories, budgets, cards, today, plan, limit = 3 }) {
  const items = [];
  const mo = { y: today.getFullYear(), m: today.getMonth() };

  const streak = minusStreak(txs, today);
  if (streak >= 2) {
    items.push({ kind: 'streak', tone: 'danger', title: MONTH_WORDS[Math.min(streak, 6) - 1] + ' ברציפות במינוס', detail: plan.canForecast && plan.projectedEnd < 0 ? 'ובקצב הנוכחי גם החודש ייגמר במינוס של כ-' + money(-plan.projectedEnd) + '.' : 'כדאי לראות איפה אפשר לצמצם.', action: { label: 'לאן הלך הכסף', to: 'money-cats' } });
  } else if (plan.canForecast && plan.projectedEnd < 0) {
    items.push({ kind: 'pace', tone: 'danger', title: 'בקצב הזה החודש ייגמר במינוס', detail: 'של כ-' + money(-plan.projectedEnd) + ', לפי ההוצאות עד עכשיו והתשלומים הקבועים שעוד יגיעו.', action: { label: 'לאן הלך הכסף', to: 'money-cats' } });
  }

  for (const c of cards) {
    const cyc = cardCycle(c, txs, today);
    if (cyc.daysSinceLast <= 5) {
      items.push({ kind: 'bill', tone: 'accent', title: c.name + ' ירד ב-' + dm(cyc.last), detail: 'העלו את הפירוט שלו, כדי שהחודש יראה את כל ההוצאות האמיתיות.', action: { label: 'להעלות פירוט', to: 'import' } });
    }
  }

  const over = categoryRows(txs, categories, budgets, [mo]).filter((r) => r.budget > 0 && r.spent >= r.budget * 0.9).sort((a, b) => b.spent / b.budget - a.spent / a.budget);
  for (const r of over.slice(0, 2)) {
    items.push(r.over
      ? { kind: 'over', tone: 'danger', title: 'חריגה ב' + r.name, detail: 'הוצאתם ' + money(r.spent) + ' מתוך ' + money(r.budget) + ' שתוכננו לחודש.', action: { label: 'לפירוט', to: 'money-cats' } }
      : { kind: 'near', tone: 'warn', title: r.name + ': ' + Math.round((r.spent / r.budget) * 100) + '% מהתקציב', detail: 'נשארו ' + money(r.budget - r.spent) + ' עד סוף החודש.', action: { label: 'לפירוט', to: 'money-cats' } });
  }

  const dupes = suspectedDuplicates(txs, today);
  if (dupes.length) {
    const d = dupes[dupes.length - 1];
    items.push({ kind: 'dupe', tone: 'warn', title: 'חיוב כפול ב' + d.tx.description + '?', detail: money(d.tx.amount) + ' ב-' + dm(d.of.tx_date) + ' ושוב ב-' + dm(d.tx.tx_date) + '.', action: { label: 'לבדוק', to: 'tx', id: d.tx.id } });
  }

  const loose = txs.filter((t) => !t.category_id && monthShare(t, mo) > 0);
  if (loose.length) {
    items.push({ kind: 'loose', tone: 'accent', title: loose.length === 1 ? 'תנועה אחת בלי קטגוריה' : loose.length + ' תנועות בלי קטגוריה', detail: 'בלי קטגוריה הן לא נספרות בתקציב של אף קטגוריה.', action: { label: 'לסווג', to: 'tx', id: loose[0].id } });
  }
  return items.slice(0, limit);
}

// The top categories of the month, for "where did the money go".
export function topCategories(txs, categories, budgets, today, n = 3) {
  const rows = categoryRows(txs, categories, budgets, [{ y: today.getFullYear(), m: today.getMonth() }]).filter((r) => r.spent > 0);
  const total = sum(rows, (r) => r.spent);
  return { total, rows: rows.slice(0, n).map((r) => ({ ...r, share: total ? Math.round((r.spent / total) * 100) : 0 })) };
}
