// Pure logic for the advisor: the data summary sent with a question (the
// same shape the current app sends, so the server prompt understands it),
// parsing the reply, and conversation helpers. No DOM, no network.

import { MONTH_NAMES, monthShare, monthsBack } from './money.js';
import { monthPlan } from './home.js';
import { forecast, verdict } from './forecast.js';

const round = Math.round;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

// The server asks the model to end with this marker and 2-3 follow-ups.
export const SUGG_MARK = '@@הצעות:';

export function parseReply(raw) {
  const s = String(raw || '');
  const [body, sugg] = s.split(SUGG_MARK);
  // Anything after another "@@" marker (e.g. the current app's fix commands) is not shown.
  const text = body.split('@@')[0].trim();
  const suggestions = sugg ? sugg.split('|').map((x) => x.replace(/@@.*$/s, '').trim()).filter(Boolean).slice(0, 3) : [];
  return { text, suggestions };
}

// What the advisor gets: six months of income and spending, categories with
// their trend, budgets against spending, goals, decisions the household
// already made (memories), the forecast and the screen the person is on.
export function buildSummary({ txs, categories, budgets, goals = [], installments = [], income = [], userId, userName, memories = [], today = new Date(), screen = 'home' }) {
  const months = monthsBack(today, 6);
  const label = (mo) => MONTH_NAMES[mo.m] + ' ' + mo.y;
  const cur = months[months.length - 1];
  const exp = txs.filter((t) => t.type !== 'income');
  const roots = categories.filter((c) => !c.parent_id && c.kind !== 'income');
  const byParent = (id) => categories.filter((c) => c.parent_id === id);
  const inCat = (t, c) => t.category_id === c.id;
  const last6Months = months.map((mo) => {
    const income = sum(txs.filter((t) => t.type === 'income'), (t) => monthShare(t, mo));
    const expense = sum(exp, (t) => monthShare(t, mo));
    return { month: label(mo), income: round(income), expense: round(expense), balance: round(income - expense) };
  });
  const categorySpendingHistory = roots.map((c) => {
    const monthlyAmounts = months.map((mo) => ({ month: label(mo), amount: round(sum(exp.filter((t) => inCat(t, c)), (t) => monthShare(t, mo))) }));
    const total6Months = sum(monthlyAmounts, (x) => x.amount);
    if (total6Months <= 0) return null;
    const subcategoriesThisMonth = byParent(c.id)
      .map((s) => ({ subcategory: s.name, amount: round(sum(exp.filter((t) => t.subcategory_id === s.id), (t) => monthShare(t, cur))) }))
      .filter((x) => x.amount > 0);
    return { category: c.name, monthlyAmounts, total6Months, avgMonthly: round(total6Months / 6), subcategoriesThisMonth };
  }).filter(Boolean).sort((a, b) => b.total6Months - a.total6Months);
  const personalCategoryBreakdown = roots
    .map((c) => ({ category: c.name, amountThisMonth: round(sum(exp.filter((t) => inCat(t, c) && t.created_by === userId), (t) => monthShare(t, cur))) }))
    .filter((x) => x.amountThisMonth > 0)
    .sort((a, b) => b.amountThisMonth - a.amountThisMonth);
  const budgetsVsActual = budgets.map((b) => {
    const c = categories.find((x) => x.id === b.category_id);
    return c ? { category: c.name, monthlyBudget: Number(b.monthly_amount) || 0, spentSoFarThisMonth: round(sum(exp.filter((t) => inCat(t, c)), (t) => monthShare(t, cur))) } : null;
  }).filter(Boolean);
  const savingsGoals = goals.map((g) => ({ name: g.name, target: Number(g.target_amount) || 0, saved: Number(g.saved_amount) || 0, targetDate: g.target_date || null }));
  const plan = monthPlan({ txs, budgets, today });
  const fc = forecast({ txs, goals, installments, budgets, today });
  const v = verdict(fc);
  return {
    userName: userName || '',
    currentMonth: label(cur),
    screen,
    last6Months,
    categorySpendingHistory,
    personalCategoryBreakdown,
    budgetsVsActual,
    savingsGoals,
    memories: memories.slice(0, 30).map((m) => m.text),
    // What the household said it expects to earn each month (0 = not set).
    expectedMonthlyIncome: round((Array.isArray(income) ? income : []).reduce((s, l) => s + (Number(l && l.amount) || 0), 0)),
    thisMonth: { budget: round(plan.budget), spent: round(plan.spent), projectedEnd: plan.canForecast ? round(plan.projectedEnd) : null, daysLeft: plan.daysLeft },
    comingMonths: { verdict: v.title, months: fc.months.map((m) => ({ month: m.name, net: round(m.net) })) }
  };
}

// Questions to start with, per screen.
const STARTERS = {
  home: ['כמה אני יכול להוציא היום?', 'למה החודש יקר יותר?', 'מה הכי דחוף לטפל בו?'],
  money: ['איפה אפשר לקצץ החודש?', 'מה השתנה לעומת החודש שעבר?', 'יש מנויים שכדאי לבטל?'],
  plans: ['היעדים שלנו ריאליים?', 'איך סוגרים את הפער החודשי?', 'כמה לחסוך לחגים?'],
  assets: ['כדאי להחזיר הלוואה מוקדם?', 'דמי הניהול שלנו סבירים?', 'כמה כסף לשמור בעו״ש?']
};
export function starters(screen) {
  return STARTERS[screen] || STARTERS.home;
}

const SCREEN_NAMES = { home: 'בית', money: 'כסף', plans: 'תוכניות', assets: 'נכסים' };
export function newTitle(firstMessage, screen, today = new Date()) {
  const t = String(firstMessage || '').trim().replace(/\s+/g, ' ');
  const short = t.length > 40 ? t.slice(0, 38) + '…' : t;
  return (short || 'ייעוץ ' + (SCREEN_NAMES[screen] || '')) + ' — ' + today.getDate() + '.' + (today.getMonth() + 1);
}

// Messages from advisor_messages rows; conversations from before the
// per-message table keep theirs in advisor_conversations.messages.
export function normalizeMessages(rows, legacy, ownerId) {
  const list = (rows && rows.length ? rows : (Array.isArray(legacy) ? legacy.filter((m) => !m.pending).map((m) => ({ ...m, author_id: m.author_id || ownerId })) : []));
  return list
    .filter((m) => m.role === 'user' || m.role === 'ai' || m.role === 'advice')
    .map((m) => (m.role === 'advice'
      ? { id: m.id, role: 'ai', text: adviceText(m.data), author_id: m.author_id }
      : { id: m.id, role: m.role, text: m.role === 'ai' ? parseReply(m.text).text : String(m.text || ''), author_id: m.author_id }));
}

// The first "analysis" message of the current app is structured; shown as text.
export function adviceText(d) {
  if (!d || typeof d !== 'object') return '';
  const parts = [d.headline];
  if (Array.isArray(d.strengths) && d.strengths.length) parts.push('מה טוב: ' + d.strengths.join(' · '));
  if (Array.isArray(d.concerns) && d.concerns.length) parts.push('מה מדאיג: ' + d.concerns.join(' · '));
  if (Array.isArray(d.tips) && d.tips.length) parts.push('מה לעשות: ' + d.tips.join(' · '));
  return parts.filter(Boolean).join('\n');
}

// History sent with a question: user and advisor turns only.
export function historyFor(messages, memberName) {
  return messages.filter((m) => m.role === 'user' || m.role === 'ai').map((m) => ({ role: m.role, text: m.text, author: m.role === 'user' ? memberName(m.author_id) : undefined }));
}

// Server-sent events: "data: {...}\n\n" chunks -> objects. Returns the rest.
export function parseSse(buffer) {
  const events = [];
  let rest = buffer;
  let i;
  while ((i = rest.indexOf('\n\n')) >= 0) {
    const chunk = rest.slice(0, i);
    rest = rest.slice(i + 2);
    const line = chunk.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(6))); } catch (_err) { /* keep-alive */ }
  }
  return { events, rest };
}
