// "מחליטים ביחד": a purchase above the amount the couple agreed on gets a
// card, and every partner other than the one who wants it answers: approve,
// not now, or let's talk. Pure: no DOM, no network.
//
//   decision { id, created_by, title, amount, category_id, wanted_by, note,
//              status, goal_id, transaction_id, created_at }
//   vote     { decision_id, user_id, vote: 'approve'|'not_now'|'talk', note }

import { monthPlan } from './home.js';
import { forecast } from './forecast.js';
import { MONTH_NAMES, parseDate } from './money.js';

export const VOTES = {
  approve: { icon: '✅', label: 'מאשר/ת', tone: 'var(--income)' },
  not_now: { icon: '⏳', label: 'לא עכשיו', tone: 'var(--warn, #c98a12)' },
  talk: { icon: '💬', label: 'בואו נדבר', tone: 'var(--accent)' }
};

export const STATUS = {
  open: 'מחכה לתשובה',
  approved: 'אושר',
  not_now: 'לא עכשיו',
  talk: 'נדבר על זה',
  bought: 'נקנה',
  withdrawn: 'בוטל'
};

export const DEFAULT_THRESHOLD = 500;
const CLOSED = ['bought', 'withdrawn'];

export const isClosed = (d) => CLOSED.includes(d.status);
export const votesFor = (d, votes) => votes.filter((v) => v.decision_id === d.id);

// The partners who answer: every member except the one who opened the card.
export function answerers(d, memberIds) {
  return memberIds.filter((id) => id !== d.created_by);
}

// Where the card stands, from the answers: any "let's talk" wins (it needs a
// conversation), then any "not now", and it is approved only when every
// partner approved. Bought and withdrawn are final.
export function outcome(d, votes, memberIds) {
  if (isClosed(d)) return d.status;
  const others = answerers(d, memberIds);
  if (others.length === 0) return 'open';
  const mine = votesFor(d, votes).filter((v) => others.includes(v.user_id));
  if (mine.some((v) => v.vote === 'talk')) return 'talk';
  if (mine.some((v) => v.vote === 'not_now')) return 'not_now';
  if (others.every((id) => mine.some((v) => v.user_id === id && v.vote === 'approve'))) return 'approved';
  return 'open';
}

export function waitingOn(d, votes, memberIds) {
  if (isClosed(d)) return [];
  const answered = new Set(votesFor(d, votes).map((v) => v.user_id));
  return answerers(d, memberIds).filter((id) => !answered.has(id));
}

export function needsMyAnswer(d, votes, me, memberIds) {
  return !isClosed(d) && waitingOn(d, votes, memberIds).includes(me);
}

// A reason is required unless approving: "no" without a why hurts.
export function voteValid(vote, note) {
  return !!VOTES[vote] && (vote === 'approve' || String(note || '').trim().length > 0);
}

export function needsCard(amount, threshold) {
  return Number(amount) >= (threshold ?? DEFAULT_THRESHOLD);
}

// The screen's groups, in the order they need attention.
export function groups(decisions, votes, me, memberIds) {
  const out = { mine: [], waiting: [], talk: [], approved: [], history: [] };
  const sorted = [...decisions].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  for (const d of sorted) {
    const st = outcome(d, votes, memberIds);
    if (isClosed(d) || st === 'not_now') out.history.push(d);
    else if (needsMyAnswer(d, votes, me, memberIds)) out.mine.push(d);
    else if (st === 'talk') out.talk.push(d);
    else if (st === 'approved') out.approved.push(d);
    else out.waiting.push(d);
  }
  return out;
}

export function pendingCount(decisions, votes, me, memberIds) {
  return decisions.filter((d) => needsMyAnswer(d, votes, me, memberIds)).length;
}

// Months from this month to the wanted date (0 = this month), within the
// half-year forecast; no date means this month.
export function monthIndex(wantedBy, today) {
  if (!wantedBy) return 0;
  const w = parseDate(wantedBy);
  const k = (w.y - today.getFullYear()) * 12 + (w.m - today.getMonth());
  return Math.max(0, Math.min(5, k));
}

// What the purchase does to the money: this month's room when it is bought
// this month, and the forecast balance at the end of its month.
export function impact({ amount, wanted_by }, data, today) {
  const amt = Number(amount) || 0;
  const i = monthIndex(wanted_by, today);
  const start = (data.accounts || []).filter((a) => a.balance !== null && a.balance !== undefined && a.balance !== '');
  const startBalance = start.length ? start.reduce((s, a) => s + Number(a.balance), 0) : null;
  const args = { txs: data.txs || [], goals: data.goals || [], installments: data.installments || [], budgets: data.budgets || [], today, startBalance };
  const before = forecast(args).months[i];
  const after = forecast({ ...args, scenarios: [{ kind: 'buy', amount: amt, month: i }] }).months[i];
  const plan = monthPlan({ txs: data.txs || [], budgets: data.budgets || [], today });
  return {
    month: MONTH_NAMES[before.month.m],
    thisMonth: i === 0,
    roomBefore: i === 0 && plan.hasBudget ? plan.remaining : null,
    roomAfter: i === 0 && plan.hasBudget ? plan.remaining - amt : null,
    endBefore: before.end,
    endAfter: after.end,
    hasBalance: startBalance !== null,
    turnsNegative: startBalance !== null && before.end >= 0 && after.end < 0
  };
}

// An approved purchase that seems to have happened: an expense within 10% of
// the amount, dated from the day the card was opened, not already linked.
export function findPurchase(d, txs, linked = []) {
  const amt = Number(d.amount) || 0;
  const from = String(d.created_at || '').slice(0, 10);
  const taken = new Set(linked);
  const hits = txs.filter((t) => t.type !== 'income' && !taken.has(t.id) && t.tx_date >= from && Math.abs((Number(t.amount) || 0) - amt) <= amt * 0.1);
  hits.sort((a, b) => Math.abs(a.amount - amt) - Math.abs(b.amount - amt));
  return hits[0] || null;
}

// "When": this month, next month, or a date the person picked.
export function wantedLabel(wantedBy, today) {
  if (!wantedBy) return 'החודש';
  const i = monthIndex(wantedBy, today);
  const w = parseDate(wantedBy);
  return i === 0 ? 'החודש' : i === 1 ? 'בחודש הבא' : 'ב' + MONTH_NAMES[w.m];
}

export function endOfMonth(today, plus = 0) {
  const d = new Date(today.getFullYear(), today.getMonth() + plus + 1, 0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// What the advisor sees: open and recent decisions, no notes about people.
export function forAdvisor(decisions, votes, memberIds) {
  return decisions.filter((d) => !isClosed(d)).slice(0, 10).map((d) => ({
    title: d.title, amount: Number(d.amount) || 0, wantedBy: d.wanted_by || null, status: outcome(d, votes, memberIds)
  }));
}
