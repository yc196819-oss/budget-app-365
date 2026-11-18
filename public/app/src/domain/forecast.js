// "The coming months": a month-by-month forecast for half a year, built from
// what the household actually does. Pure.
//
// Each month: average income and variable spending of the last 3 full months,
// last month's fixed lines, yearly payments coming round again, installments,
// planned expenses (goals with a date) and holidays not planned yet. The
// current month uses the month plan (what already happened + the rest).

import { MONTH_NAMES, monthShare, parseDate } from './money.js';
import { monthPlan, cashNow } from './home.js';
import { holidaysBetween, holidayGoalName, lastHolidayExtra } from './calendar.js';
import { installmentOf, similarText } from './statement.js';
import { loanDueIn, investPattern } from './assets.js';

const sum = (list, f = (x) => x) => list.reduce((s, x) => s + f(x), 0);
const isExpense = (t) => t.type !== 'income';

function fullMonthsBefore(today, n) {
  return Array.from({ length: n }, (_, i) => { const d = new Date(today.getFullYear(), today.getMonth() - 1 - i, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
}

function average(txs, months, pick) {
  const vals = months.map((mo) => sum(txs.filter(pick), (t) => monthShare(t, mo))).filter((v) => v > 0);
  return vals.length ? sum(vals) / vals.length : 0;
}

// The same payee written two ways ("לייבוביץ" / "ליבוביץ"): the first word,
// without the vowel letters ו and י, is the same, and both are real words
// (4 letters or more). Then the regular similarity.
const skeleton = (w) => w.replace(/[וי]/g, '');
const firstWord = (d) => (String(d || '').replace(/[^\u05D0-\u05EAa-zA-Z ]/g, ' ').trim().split(/\s+/)[0] || '');
export function samePayee(a, b) {
  if (similarText(a, b)) return true;
  const A = firstWord(a), B = firstWord(b);
  if (A.length < 4 || B.length < 4) return false;
  const sa = skeleton(A), sb = skeleton(B);
  return sa.length >= 2 && sa === sb;
}

const monthOf = (t, months) => { const d = parseDate(t.tx_date); return months.findIndex((mo) => mo.y === d.y && mo.m === d.m); };

// The fixed payments of the last 3 full months, as items: lines with a
// similar description are one item (rent is rent, even when one month's
// line says "rent (updated)"). An item is fixed when any of its lines was
// marked fixed, in any of the months: a line imported later as "variable"
// does not turn the rent into a variable expense. It counts once, at its
// latest month's amount, when it was paid last month or in at least two
// of the three months (a one-time line marked fixed is not a payment).
export function fixedItems(txs, today) {
  const months = fullMonthsBefore(today, 3);
  const items = [];
  for (const t of txs) {
    if (!isExpense(t) || t.spread === 'year' || installmentOf(t.description)) continue;
    const k = monthOf(t, months);
    if (k < 0) continue;
    const desc = String(t.description || '').trim();
    let it = desc ? items.find((x) => samePayee(x.desc, desc)) : null;
    if (!it) { it = { desc, lines: [], fixed: false }; items.push(it); }
    it.lines.push({ t, k });
    if (t.nature === 'fixed') it.fixed = true;
  }
  return items.filter((it) => it.fixed && it.desc).map((it) => {
    const seen = new Set(it.lines.map((l) => l.k));
    const latest = Math.min(...seen);
    return { desc: it.desc, lines: it.lines.map((l) => l.t), months: seen.size, latest, amount: sum(it.lines.filter((l) => l.k === latest), (l) => Number(l.t.amount) || 0) };
  }).filter((it) => it.latest === 0 || it.months >= 2);
}

// Big one-time expenses of the last 3 full months: a variable line of
// ONE_OFF or more with nothing like it in the other months (furniture, a
// flight, a deposit to investments). Left out of the regular month, since
// they do not come back every month; the forecast says which ones.
export const ONE_OFF = 1500;
export function oneOffs(txs, today) {
  const months = fullMonthsBefore(today, 3);
  const lines = txs.filter((t) => isExpense(t) && t.spread !== 'year' && t.nature !== 'fixed' && !installmentOf(t.description) && monthOf(t, months) >= 0);
  return lines.filter((t) => (Number(t.amount) || 0) >= ONE_OFF && String(t.description || '').trim()
    && !lines.some((o) => o !== t && monthOf(o, months) !== monthOf(t, months) && samePayee(o.description || '', t.description)));
}

// The typical month of a list of monthly sums: the middle one of three (a
// month with a trip abroad does not set the regular month).
function median(vals) {
  const v = vals.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

// The household's regular month, from history.
// skip: lines kept out of the regular month (deposits to investments, which
// the forecast counts on their own line when they are regular).
export function baseline(allTxs, today, skip = null) {
  const txs = skip ? allTxs.filter((t) => !skip(t)) : allTxs;
  const months = fullMonthsBefore(today, 3);
  const items = fixedItems(txs, today);
  const fixedIds = new Set(items.flatMap((it) => it.lines));
  // Every line of a fixed item, in any month, is out of the variable average
  // (as is a line marked fixed that is not a regular payment).
  const isFixed = (t) => t.nature === 'fixed' || fixedIds.has(t) || items.some((it) => samePayee(it.desc, t.description || ''));
  const once = new Set(oneOffs(txs, today));
  return {
    income: average(txs, months, (t) => t.type === 'income'),
    fixed: sum(items, (it) => it.amount),
    // Yearly-spread lines are counted where they really fall (see yearly below).
    // Installment payments are counted from the deals instead (installmentsIn),
    // up to the last payment, so they are not in the regular month.
    // A typical month (the middle of the three), without big one-time lines.
    variable: median(months.map((mo) => sum(txs.filter((t) => isExpense(t) && t.spread !== 'year' && !installmentOf(t.description) && !isFixed(t) && !once.has(t)), (t) => monthShare(t, mo))))
  };
}

// Payments marked "spread over the year" come round again 12 months later.
function yearly(txs, mo) {
  return txs.filter((t) => isExpense(t) && t.spread === 'year' && (() => { const d = parseDate(t.tx_date); return d.y === mo.y - 1 && d.m === mo.m; })())
    .map((t) => ({ label: 'תשלום שנתי: ' + t.description, amount: -(Number(t.amount) || 0), kind: 'yearly' }));
}

// paidNow: this month's transactions; a deal whose payment is already among
// them is not counted again.
function installmentsIn(installments, mo, paidNow = []) {
  const out = [];
  for (const i of installments) {
    if (paidNow.some((t) => installmentOf(t.description) && similarText(t.description, i.description || ''))) continue;
    const count = Number(i.payments_count) || 0;
    const total = Number(i.total_amount) || 0;
    if (!count || !total || !i.first_payment) continue;
    const f = parseDate(i.first_payment);
    const k = (mo.y - f.y) * 12 + (mo.m - f.m);
    if (k >= 0 && k < count) out.push({ label: 'תשלומים: ' + (i.description || ''), amount: -(total / count), kind: 'installment' });
  }
  return out;
}

// A debt owed to the family, paid back month by month: each month's payment
// is expected income ("תשלום 3 מתוך 10"). This month, only a payment whose
// day has not come yet (one that came is in the month's income already).
function loansIn(loans, mo, today, first) {
  const out = [];
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const l of loans) {
    if (l.direction !== 'tome') continue;
    const due = loanDueIn(l, mo);
    if (!due || !(due.amount > 0) || (first && due.date < now)) continue;
    out.push({ label: 'החזר חוב: ' + (l.counterparty || '') + ' (תשלום ' + due.n + ' מתוך ' + due.count + ')', amount: due.amount, kind: 'debt' });
  }
  return out;
}

function plannedIn(goals, mo) {
  return goals.filter((g) => g.target_date && (() => { const d = parseDate(g.target_date); return d.y === mo.y && d.m === mo.m; })())
    .map((g) => ({ label: 'מתוכנן: ' + g.name, amount: -Math.max(0, (Number(g.target_amount) || 0) - (Number(g.saved_amount) || 0)), kind: 'planned' }))
    .filter((x) => x.amount < 0);
}

function holidaysIn(goals, txs, mo) {
  const out = [];
  for (const h of holidaysBetween(new Date(mo.y, mo.m, 1), new Date(mo.y, mo.m + 1, 0))) {
    if (goals.some((g) => g.name === holidayGoalName(h))) continue;
    const extra = lastHolidayExtra(h.key, h.date, txs);
    if (extra) out.push({ label: h.name + ' (לפי מה שהחג עלה בפעם הקודמת)', amount: -extra, kind: 'holiday', holiday: h });
  }
  return out;
}

// scenarios: [{ kind: 'buy' | 'income' | 'cut', amount, month: 0..5 }] — "what if", nothing is saved.
function scenarioLines(scenarios, i) {
  const out = [];
  for (const s of scenarios) {
    if (s.kind === 'buy' && s.month === i) out.push({ label: 'בדיקה: קנייה', amount: -s.amount, kind: 'scenario' });
    if (s.kind === 'income' && i >= s.month) out.push({ label: 'בדיקה: שינוי בהכנסה', amount: s.amount, kind: 'scenario' });
    if (s.kind === 'cut' && i >= s.month) out.push({ label: 'בדיקה: חיסכון בהוצאות', amount: s.amount, kind: 'scenario' });
  }
  return out;
}

// The household's forecast: the one calculation Plans, a shared decision
// and the advisor all show, so the same month has the same number
// everywhere. Starts from the free money now (balances minus card charges
// not taken yet), when balances are known.
export function householdForecast(data, today = new Date(), scenarios = []) {
  const cash = cashNow(data.accounts || [], data.cards || [], data.txs || [], today);
  return forecast({ txs: data.txs || [], goals: data.goals || [], installments: data.installments || [], loans: data.loans || [], categories: data.categories || [], budgets: data.budgets || [], income: data.income || [], today, startBalance: cash.known ? cash.free : null, scenarios });
}

// income: the household's expected monthly income lines (what they told the
// app or the advisor, one line per person). When set, it is the income of
// every coming month; this month, what has not come in yet is still expected
// (a salary not paid yet is not "no income").
export function forecast({ txs, goals = [], installments = [], loans = [], categories = [], budgets = [], income = [], today, startBalance = null, scenarios = [], months = 6 }) {
  // Deposits to investments: out of the average. Regular ones come back
  // every month on a line of their own; a one-off is not expected again.
  const invest = investPattern(txs, categories, today);
  const anyInvest = categories.length > 0 && txs.some((t) => isExpense(t) && invest.isInv(t));
  const base = baseline(txs, today, anyInvest ? (t) => isExpense(t) && invest.isInv(t) : null);
  const plan = monthPlan({ txs, budgets, today });
  const expected = sum(Array.isArray(income) ? income : [], (l) => Number(l && l.amount) || 0);
  const monthlyIncome = expected > 0 ? expected : base.income;
  let balance = startBalance ?? 0;
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const mo = { y: d.getFullYear(), m: d.getMonth() };
    let lines;
    if (i === 0) {
      // Only what is still to come this month moves the balance.
      lines = [
        { label: 'הכנסות שעוד יגיעו החודש', amount: Math.max(plan.projectedIncome, monthlyIncome) - plan.incomeSoFar, kind: 'income' },
        { label: 'הוצאות עד סוף החודש', amount: -(plan.projectedExpense - plan.spent), kind: 'expense' }
      ];
    } else {
      lines = [
        { label: expected > 0 ? 'הכנסה צפויה (כפי שעדכנתם)' : 'הכנסות (ממוצע 3 חודשים)', amount: monthlyIncome, kind: 'income' },
        { label: 'הוצאות קבועות', amount: -base.fixed, kind: 'fixed' },
        { label: 'הוצאות משתנות (חודש רגיל)', amount: -base.variable, kind: 'variable' },
        ...yearly(txs, mo),
        ...(invest.recurring ? [{ label: 'הפקדה קבועה להשקעות (לפי ' + invest.months + ' החודשים האחרונים)', amount: -invest.monthly, kind: 'saving' }] : [])
      ];
    }
    const paidNow = i === 0 ? txs.filter((t) => isExpense(t) && (() => { const d = parseDate(t.tx_date); return d.y === mo.y && d.m === mo.m; })()) : [];
    lines.push(...installmentsIn(installments, mo, paidNow), ...loansIn(loans, mo, today, i === 0), ...plannedIn(goals, mo), ...holidaysIn(goals, txs, mo), ...scenarioLines(scenarios, i));
    lines = lines.filter((l) => Math.round(l.amount) !== 0);
    const net = sum(lines, (l) => l.amount);
    balance += net;
    out.push({ index: i, month: mo, name: MONTH_NAMES[mo.m] + ' ' + mo.y, short: MONTH_NAMES[mo.m], lines, net, end: balance });
  }
  const skipped = oneOffs(anyInvest ? txs.filter((t) => !(isExpense(t) && invest.isInv(t))) : txs, today).map((t) => ({ description: t.description, amount: Number(t.amount) || 0, date: t.tx_date }));
  return { months: out, base, skipped, expectedIncome: expected, regularNet: monthlyIncome - base.fixed - base.variable - (invest.recurring ? invest.monthly : 0), investMonthly: invest.recurring ? invest.monthly : 0, hasBalance: startBalance !== null && startBalance !== undefined };
}

// One sentence on where the half year is heading.
export function verdict(fc) {
  const firstNeg = fc.months.find((m) => (fc.hasBalance ? m.end < 0 : m.net < 0));
  const gap = -fc.regularNet;
  if (fc.hasBalance && firstNeg) {
    return { tone: 'danger', title: 'מ' + firstNeg.short + ' החשבון צפוי להיות במינוס', text: gap > 0 ? 'בחודש רגיל יוצא כ-' + Math.round(gap).toLocaleString('en-US') + ' ₪ יותר ממה שנכנס.' : 'הסיבה: הוצאות גדולות שמתוכננות או צפויות באותו חודש.' };
  }
  if (gap > 0) {
    return { tone: fc.hasBalance ? 'warn' : 'danger', title: fc.hasBalance ? 'החודשים הקרובים בסדר, אבל המגמה יורדת' : 'בחודש רגיל יוצא יותר ממה שנכנס', text: 'בממוצע יוצא כ-' + Math.round(gap).toLocaleString('en-US') + ' ₪ יותר ממה שנכנס בכל חודש.' };
  }
  if (!fc.hasBalance && firstNeg) {
    return { tone: 'warn', title: firstNeg.short + ' צפוי להיות חודש כבד', text: 'ההוצאות בו צפויות להיות גדולות מההכנסות.' };
  }
  return { tone: 'ok', title: 'החודשים הקרובים נראים טוב', text: fc.hasBalance ? 'החשבון צפוי להישאר בפלוס בכל החצי שנה הקרובה.' : 'בכל חודש צפוי להישאר משהו.' };
}

// Where a cut would help most: the biggest variable categories of the last
// 3 months that are over their budget, or simply the biggest.
export function cutIdeas(txs, categories, budgets, today, n = 2) {
  const months = fullMonthsBefore(today, 3);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const budgetOf = new Map(budgets.map((b) => [b.category_id, Number(b.monthly_amount) || 0]));
  const spent = new Map();
  for (const t of txs) {
    if (!isExpense(t) || t.nature === 'fixed' || !t.category_id) continue;
    const c = byId.get(t.category_id);
    const top = c && c.parent_id ? c.parent_id : t.category_id;
    spent.set(top, (spent.get(top) || 0) + sum(months, (mo) => monthShare(t, mo)) / months.length);
  }
  return [...spent.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, avg]) => ({ id, name: byId.get(id).name, avg, budget: budgetOf.get(id) || 0, over: (budgetOf.get(id) || 0) > 0 && avg > budgetOf.get(id) }))
    .sort((a, b) => (b.over - a.over) || (b.avg - a.avg))
    .slice(0, n);
}
