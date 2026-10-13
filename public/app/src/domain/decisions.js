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
import { money } from './format.js';

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
  planned: 'סוכם, בתוכנית',
  bought: 'נקנה',
  withdrawn: 'בוטל',
  declined: 'החלטנו לא לקנות'
};

export const DEFAULT_THRESHOLD = 500;
const CLOSED = ['bought', 'withdrawn', 'declined'];

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
  if (isClosed(d) || d.status === 'planned') return d.status;
  const others = answerers(d, memberIds);
  if (others.length === 0) return 'open';
  const mine = votesFor(d, votes).filter((v) => others.includes(v.user_id));
  if (mine.some((v) => v.vote === 'talk')) return 'talk';
  if (mine.some((v) => v.vote === 'not_now')) return 'not_now';
  if (others.every((id) => mine.some((v) => v.user_id === id && v.vote === 'approve'))) return 'approved';
  return 'open';
}

// Decided together (planned) or final: nobody owes an answer any more.
export function waitingOn(d, votes, memberIds) {
  if (isClosed(d) || d.status === 'planned') return [];
  const answered = new Set(votesFor(d, votes).map((v) => v.user_id));
  return answerers(d, memberIds).filter((id) => !answered.has(id));
}

export function needsMyAnswer(d, votes, me, memberIds) {
  return waitingOn(d, votes, memberIds).includes(me);
}

// A reason is required unless approving: "no" without a why hurts.
export function voteValid(vote, note) {
  return !!VOTES[vote] && (vote === 'approve' || String(note || '').trim().length > 0);
}

export function needsCard(amount, threshold) {
  return Number(amount) >= (threshold ?? DEFAULT_THRESHOLD);
}

// The screen's groups, in the order they need attention. A card goes to
// history only when the couple has decided: bought, decided not to buy, or
// withdrawn. "Not now" and "let's talk" stay in the conversation until then;
// agreed and in the plan stays until it is bought.
export function groups(decisions, votes, me, memberIds) {
  const out = { mine: [], waiting: [], talk: [], approved: [], history: [] };
  const sorted = [...decisions].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  for (const d of sorted) {
    const st = outcome(d, votes, memberIds);
    if (isClosed(d)) out.history.push(d);
    else if (needsMyAnswer(d, votes, me, memberIds)) out.mine.push(d);
    else if (st === 'talk' || st === 'not_now') out.talk.push(d);
    else if (st === 'approved' || st === 'planned') out.approved.push(d);
    else out.waiting.push(d);
  }
  return out;
}

// Can the card be summed up as a decision now? Anything not final.
export const canConclude = (d) => !isClosed(d);

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

// The month's room: what is left, or by how much the budget is exceeded.
export function roomText(n) {
  return n < 0 ? 'חריגה של ' + money(n) : 'נשארים ' + money(n);
}
export function signedMoney(n) {
  return (n < 0 ? '−' : '') + money(n);
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

// The advisor joins the couple's conversation on one card: the question it
// is asked, with the purchase, why it is wanted, each partner's answer and
// what it does to the numbers. It is asked to weigh both sides, not to take
// one, and to end with a clear recommendation.
export function advisorQuestion(d, votes, memberIds, nameOf, fx, today = new Date(), hasThread = false, voices = null) {
  const lines = [
    `בני הזוג מתלבטים יחד על קנייה ומבקשים שתצטרף לשיחה שלהם, תעזור לכל אחד להישמע ותגיד את דעתך לפי הנתונים.`,
    `${nameOf(d.created_by)} רוצה לקנות: ${d.title}, ב-${money(d.amount)}, ${wantedLabel(d.wanted_by, today)}.`,
    d.note ? `למה זה חשוב לו/לה: ${d.note}` : null
  ];
  for (const id of answerers(d, memberIds)) {
    const v = votesFor(d, votes).find((x) => x.user_id === id);
    lines.push(v ? `${nameOf(id)} ענה/תה: ${VOTES[v.vote].label}${v.note ? ' — ' + v.note : ''}` : `${nameOf(id)} עוד לא ענה/תה.`);
  }
  if (fx) {
    if (fx.roomBefore !== null) lines.push(`בתקציב החודש: ${roomText(fx.roomBefore)} לפני הקנייה, ${roomText(fx.roomAfter)} אחריה.`);
    if (fx.hasBalance) lines.push(`בחשבון בסוף ${fx.month}: ${signedMoney(fx.endBefore)} בלי הקנייה, ${signedMoney(fx.endAfter)} איתה.${fx.turnsNegative ? ' הקנייה מכניסה את החשבון למינוס.' : ''}`);
  }
  if (hasThread) lines.push('בני הזוג כבר מדברים על זה (השיחה מופיעה למעלה). התייחס למה שנאמר, ובעיקר להודעה האחרונה, בלי לחזור על מה שכבר אמרת.');
  if (voices) {
    const quiet = voices.quiet ? nameOf(voices.quiet) : null;
    lines.push(`בשיחה עד עכשיו: ${voices.counts.map(([id, n]) => nameOf(id) + ' ' + n + ' הודעות').join(', ')}.${quiet ? ' ' + quiet + ' כתב/ה פחות; תן לו/ה מקום.' : ''}`);
  }
  lines.push(COUPLE_RULES);
  return lines.filter(Boolean).join('\n');
}

// How the advisor speaks in a couple's conversation: to both, with room for
// each, never as a judge.
const COUPLE_RULES = [
  'אתה מדבר עם זוג, לא מכריע ביניהם. פנה לשניהם בשמם.',
  'קודם שקף בחום, במשפט קצר לכל אחד, מה חשוב לו/לה ומה הוא/היא מרגיש/ה לפי מה שכתבו, בלי לפרש מעבר למה שנאמר. אם מישהו עוד לא אמר מה חשוב לו, הזמן אותו בשאלה פתוחה אחת.',
  'אחר כך המספרים: מה הקנייה עושה לתקציב, לתחזית וליעדים, בעובדות.',
  'בלי האשמה, בלי "צריך" ובלי לקחת צד. אם יש מתח, הכר בו בעדינות והצע דרך שבה שניהם מרוויחים (פשרה, תנאי, מועד).',
  'עד 6 משפטים קצרים, בעברית חמה ופשוטה. סיים בשורה שמתחילה ב"ההמלצה שלי:" — לקנות עכשיו, לחכות (ועד מתי), או לקנות בתנאי (איזה) — ואחריה שאלה אחת לשניהם שתעזור להחליט.'
].join('\n');

// The decision in words, to write into the card when closing it: what was
// agreed, why, and the practical steps. The advisor proposes; the couple edits.
export function summaryQuestion(d, votes, memberIds, nameOf, today = new Date()) {
  return [
    `בני הזוג מסכמים את ההחלטה על: ${d.title}, ${money(d.amount)}, ${wantedLabel(d.wanted_by, today)}.`,
    ...answerers(d, memberIds).map((id) => { const v = votesFor(d, votes).find((x) => x.user_id === id); return v ? `${nameOf(id)}: ${VOTES[v.vote].label}${v.note ? ' — ' + v.note : ''}` : null; }),
    'לפי השיחה למעלה, נסח סיכום החלטה קצר שמכבד את שניהם: מה הוחלט, ולמה במשפט, ו-1 עד 3 צעדים מעשיים (מי, מה, עד מתי). בלי פתיח ובלי "ההמלצה שלי". עד 4 שורות.'
  ].filter(Boolean).join('\n');
}

// Who has spoken in the conversation (people only), and who less: the
// advisor makes room for the quieter partner.
export function voiceBalance(thread, memberIds) {
  const counts = memberIds.map((id) => [id, thread.filter((m) => m.role !== 'ai' && m.author_id === id).length]);
  const total = counts.reduce((s, [, n]) => s + n, 0);
  if (total < 2 || counts.length < 2) return { counts, quiet: null };
  const sorted = [...counts].sort((a, b) => a[1] - b[1]);
  return { counts, quiet: sorted[0][1] * 2 < sorted[sorted.length - 1][1] ? sorted[0][0] : null };
}

// ── the conversation on a card: the partners and the advisor ──
//   message { id, decision_id, role: 'user'|'ai', author_id, text, created_at }

export function threadFor(d, messages) {
  return messages.filter((m) => m.decision_id === d.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

// Messages I have not seen: written by someone else, or the advisor's answer
// to someone else, after I last opened the conversation.
// Read receipts: my message is read when the partner's last read is after it.
export function readBy(msg, reads, me) {
  return reads.some((r) => r.decision_id === msg.decision_id && r.user_id !== me && r.seen_at >= msg.created_at);
}

// The conversation with a day line where the day changes: [{ day } | message].
export function withDays(thread, today = new Date()) {
  const key = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  const label = (iso) => {
    const d = new Date(iso);
    const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    return days === 0 ? 'היום' : days === 1 ? 'אתמול' : d.getDate() + ' ב' + MONTH_NAMES[d.getMonth()] + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '');
  };
  const out = [];
  let last = null;
  for (const m of thread) { const k = key(m.created_at); if (k !== last) { out.push({ day: label(m.created_at), key: 'day-' + k }); last = k; } out.push(m); }
  return out;
}

export function unreadCount(d, messages, me, seenAt) {
  return threadFor(d, messages).filter((m) => m.author_id !== me && (!seenAt || m.created_at > seenAt)).length;
}

export function unreadTotal(decisions, messages, me, seenOf) {
  return decisions.filter((d) => !isClosed(d) && unreadCount(d, messages, me, seenOf(d.id)) > 0).length;
}

// The conversation as the advisor gets it (the last 20 messages, with names).
export function threadHistory(thread, nameOf) {
  return thread.slice(-20).map((m) => (m.role === 'ai' ? { role: 'ai', text: m.text } : { role: 'user', text: m.text, author: nameOf(m.author_id) }));
}
