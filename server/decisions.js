// "מחליטים ביחד" notifications: who gets told what. Pure, so the wording and
// the recipients can be tested without push keys.

const ICON = { approve: '✅', not_now: '⏳', talk: '💬' };
const LABEL = { approve: 'מאשר/ת', not_now: 'לא עכשיו', talk: 'בואו נדבר' };
const money = (n) => '₪' + Math.round(Number(n) || 0).toLocaleString('en-US');
const URL = '/app/#/together';

// event: opened | answered | message | advisor | bought | withdrawn.
// message: the newest conversation message, for 'message' and 'advisor'. Returns [{ to, title, body, url }].
function messagesFor(event, { decision, actorId, members, vote, message }) {
  const name = (id) => (members.find((m) => m.user_id === id) || {}).display_name || 'בן/בת הזוג';
  const others = members.map((m) => m.user_id).filter((id) => id !== actorId);
  const d = decision;
  switch (event) {
    case 'opened':
      return others.map((to) => ({ to, title: `🛒 ${name(actorId)} רוצה לקנות: ${d.title}`, body: `${money(d.amount)}${d.note ? ' · ' + String(d.note).slice(0, 80) : ''} — מה דעתך?`, url: URL }));
    case 'answered': {
      if (!vote) return [];
      const final = d.status === 'approved' ? ' (אושר)' : '';
      return others.map((to) => ({ to, title: `${ICON[vote.vote]} ${name(actorId)}: ${LABEL[vote.vote]}${final} — ${d.title}`, body: vote.note ? String(vote.note).slice(0, 120) : money(d.amount), url: URL }));
    }
    case 'bought':
      return others.map((to) => ({ to, title: `🛍️ ${d.title} נקנה`, body: money(d.amount), url: URL }));
    case 'message':
      return message ? others.map((to) => ({ to, title: `💬 ${name(actorId)} על ${d.title}`, body: String(message.text).slice(0, 140), url: URL })) : [];
    case 'advisor':
      return message ? others.map((to) => ({ to, title: `🤖 היועץ הצטרף לשיחה על: ${d.title}`, body: String(message.text).slice(0, 140), url: URL })) : [];
    case 'withdrawn':
      return others.map((to) => ({ to, title: `↩️ ${name(actorId)} ביטל/ה את הבקשה: ${d.title}`, body: '', url: URL }));
    default:
      return [];
  }
}

// Open cards older than a day that someone has not answered yet, reminded
// once. Returns [{ to, title, body, url, decisionId }].
function reminders({ decisions, votes, members, now = new Date() }) {
  const out = [];
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  for (const d of decisions) {
    if (d.status !== 'open' || d.reminded_at || new Date(d.created_at).getTime() > dayAgo) continue;
    const answered = new Set(votes.filter((v) => v.decision_id === d.id).map((v) => v.user_id));
    for (const m of members.filter((x) => x.household_id === d.household_id && x.user_id !== d.created_by && !answered.has(x.user_id))) {
      out.push({ to: m.user_id, decisionId: d.id, title: `⏳ מחכה לתשובה שלך: ${d.title}`, body: `${money(d.amount)} · כמה שניות, וזה סגור`, url: URL });
    }
  }
  return out;
}

module.exports = { messagesFor, reminders };
