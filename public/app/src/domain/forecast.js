// "The coming months": a month-by-month forecast for half a year, built from
// what the household actually does. Pure.
//
// Each month: average income and variable spending of the last 3 full months,
// last month's fixed lines, yearly payments coming round again, installments,
// planned expenses (goals with a date) and holidays not planned yet. The
// current month uses the month plan (what already happened + the rest).

import { MONTH_NAMES, monthShare, parseDate } from './money.js';
import { monthPlan } from './home.js';
import { holidaysBetween, holidayGoalName, lastHolidayExtra } from './calendar.js';

const sum = (list, f = (x) => x) => list.reduce((s, x) => s + f(x), 0);
const isExpense = (t) => t.type !== 'income';

function fullMonthsBefore(today, n) {
  return Array.from({ length: n }, (_, i) => { const d = new Date(today.getFullYear(), today.getMonth() - 1 - i, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
}

function average(txs, months, pick) {
  const vals = months.map((mo) => sum(txs.filter(pick), (t) => monthShare(t, mo))).filter((v) => v > 0);
  return vals.length ? sum(vals) / vals.length : 0;
}

// The household's regular month, from history.
export function baseline(txs, today) {
  const months = fullMonthsBefore(today, 3);
  const last = months[0];
  const fixedLines = txs.filter((t) => isExpense(t) && t.nature === 'fixed' && t.spread !== 'year' && (() => { const d = parseDate(t.tx_date); return d.y === last.y && d.m === last.m; })());
  return {
    income: average(txs, months, (t) => t.type === 'income'),
    fixed: sum(fixedLines, (t) => Number(t.amount) || 0),
    // Yearly-spread lines are counted where they really fall (see yearly below).
    variable: average(txs, months, (t) => isExpense(t) && t.nature !== 'fixed' && t.spread !== 'year')
  };
}

// Payments marked "spread over the year" come round again 12 months later.
function yearly(txs, mo) {
  return txs.filter((t) => isExpense(t) && t.spread === 'year' && (() => { const d = parseDate(t.tx_date); return d.y === mo.y - 1 && d.m === mo.m; })())
    .map((t) => ({ label: 'תשלום שנתי: ' + t.description, amount: -(Number(t.amount) || 0), kind: 'yearly' }));
}

function installmentsIn(installments, mo) {
  const out = [];
  for (const i of installments) {
    const count = Number(i.payments_count) || 0;
    const total = Number(i.total_amount) || 0;
    if (!count || !total || !i.first_payment) continue;
    const f = parseDate(i.first_payment);
    const k = (mo.y - f.y) * 12 + (mo.m - f.m);
    if (k >= 0 && k < count) out.push({ label: 'תשלומים: ' + (i.description || ''), amount: -(total / count), kind: 'installment' });
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

export function forecast({ txs, goals = [], installments = [], budgets = [], today, startBalance = null, scenarios = [], months = 6 }) {
  const base = baseline(txs, today);
  const plan = monthPlan({ txs, budgets, today });
  let balance = startBalance ?? 0;
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const mo = { y: d.getFullYear(), m: d.getMonth() };
    let lines;
    if (i === 0) {
      // Only what is still to come this month moves the balance.
      lines = [
        { label: 'הכנסות שעוד יגיעו החודש', amount: plan.projectedIncome - plan.incomeSoFar, kind: 'income' },
        { label: 'הוצאות עד סוף החודש', amount: -(plan.projectedExpense - plan.spent), kind: 'expense' }
      ];
    } else {
      lines = [
        { label: 'הכנסות (ממוצע 3 חודשים)', amount: base.income, kind: 'income' },
        { label: 'הוצאות קבועות', amount: -base.fixed, kind: 'fixed' },
        { label: 'הוצאות משתנות (ממוצע 3 חודשים)', amount: -base.variable, kind: 'variable' },
        ...yearly(txs, mo)
      ];
    }
    lines.push(...installmentsIn(installments, mo), ...plannedIn(goals, mo), ...holidaysIn(goals, txs, mo), ...scenarioLines(scenarios, i));
    lines = lines.filter((l) => Math.round(l.amount) !== 0);
    const net = sum(lines, (l) => l.amount);
    balance += net;
    out.push({ index: i, month: mo, name: MONTH_NAMES[mo.m] + ' ' + mo.y, short: MONTH_NAMES[mo.m], lines, net, end: balance });
  }
  return { months: out, base, regularNet: base.income - base.fixed - base.variable, hasBalance: startBalance !== null && startBalance !== undefined };
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
