// The first steps of a new household, in the order that makes the app useful
// fastest: real numbers first (a statement), then what the numbers mean
// (categories, income, budgets), then the rest. Each step is done when the
// data says so, so the guide picks up where the person left off, on any
// device and after signing in again. Pure.

import { sameMerchant } from './money.js';

const DAY = 86400000;

export const STEPS = [
  { key: 'import', title: 'מעלים פירוטי אשראי של 6 חודשים', why: 'ההמלצה שלנו: 6 החודשים האחרונים, מכל כרטיסי האשראי. ככה היועץ רואה את התמונה המלאה, והתחזית מדויקת מהיום הראשון. אקסל, PDF או צילום מסך מהאתר של חברת האשראי או הבנק. אפשר כמה קבצים, אחד אחרי השני.', time: '2 דקות', cta: 'להעלות פירוטים' },
  { key: 'sort', title: 'מסווגים את מה שנשאר', why: 'תנועה בלי קטגוריה לא נספרת בשום תקציב. היועץ מציע לכל בית עסק, אתם רק מאשרים.', time: 'דקה', cta: 'לסווג עכשיו' },
  { key: 'income', title: 'כמה נכנס בחודש?', why: 'בערך, נטו. ככה נדע כמה נשאר לכם להוציא החודש ולאן החודש הולך.', time: '10 שניות', cta: 'לשמור' },
  { key: 'budget', title: 'תקציב לכמה קטגוריות', why: 'לא צריך לכולן. מתחילים מ-2-3 שהכי חשובות (אוכל, בילויים), ונקבל התראה לפני שחורגים.', time: 'דקה', cta: 'לקבוע תקציב' },
  { key: 'card', title: 'כל כרטיסי האשראי ויום החיוב', why: 'כל כרטיס של שניכם, עם שם ויום חיוב, כדי ששום חיוב לא יפתיע. ככה נראה מראש כמה ירד מהעו"ש ומתי. יש כמה חשבונות בנק? מוסיפים את כולם במסך הנכסים, ורואים הכל במקום אחד.', time: '30 שניות', cta: 'להוסיף כרטיס' },
  { key: 'ask', title: 'שאלה ראשונה ליועץ', why: 'למשל: "איפה הכי קל לנו לחסוך?" הוא רואה את המספרים שלכם ועונה עליהם.', time: '30 שניות', cta: 'לשאול את היועץ' },
  { key: 'partner', title: 'מזמינים את בן או בת הזוג', why: 'כל אחד מוסיף מהטלפון שלו, ושניכם רואים את אותה תמונה.', time: '10 שניות', cta: 'לשלוח הזמנה', optional: true }
];

// Transactions without a category, in the last `days`.
export function looseTxs(txs, today = new Date(), days = 120) {
  const since = today.getTime() - days * DAY;
  return (txs || []).filter((t) => !t.category_id && new Date(t.tx_date).getTime() >= since);
}

// state: { txs, budgets, cards, income, members } and what only the device
// knows: { asked, skipped: Set }. Returns the steps with done / skipped.
export function guideSteps(data, { asked = false, skipped = new Set(), today = new Date() } = {}) {
  const txs = data.txs || [];
  const imported = txs.some((t) => t.source && t.source !== 'manual') || txs.length >= 15;
  const done = {
    import: imported,
    sort: txs.length > 0 && looseTxs(txs, today).length === 0,
    income: Array.isArray(data.income) && data.income.some((i) => Number(i.amount) > 0),
    budget: (data.budgets || []).some((b) => Number(b.monthly_amount) > 0),
    card: (data.cards || []).length > 0,
    ask: !!asked,
    partner: Object.keys(data.members || {}).length > 1
  };
  return STEPS.map((s) => ({ ...s, done: !!done[s.key], skipped: !done[s.key] && skipped.has(s.key) }));
}

export function guideProgress(steps) {
  const counted = steps.filter((s) => !s.skipped);
  const finished = counted.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.skipped) || null;
  return { finished, total: counted.length, next, complete: !next };
}

// ── sorting what has no category ──────────────────────────────────────
// One group per merchant (and type), biggest first, so one choice sorts
// every line of that merchant.
export function looseGroups(txs, limit = 150) {
  const groups = [];
  for (const t of txs) {
    const type = t.type === 'income' ? 'income' : 'expense';
    const g = groups.find((x) => x.type === type && sameMerchant(x.description, t.description));
    if (g) { g.ids.push(t.id); g.total += Number(t.amount) || 0; }
    else groups.push({ key: 'g' + groups.length, type, description: t.description, amount: Number(t.amount) || 0, ids: [t.id], total: Number(t.amount) || 0 });
  }
  return groups.sort((a, b) => b.total - a.total).slice(0, limit);
}

// ── the one-time notice about the import problem ─────────────────────
// Statements imported before the fix (Nov 2, 2026) may have been read in part.
export const IMPORT_FIX_AT = '2026-11-02T00:00:00Z';
export function needsImportNotice(txs, dismissed) {
  if (dismissed) return false;
  return (txs || []).some((t) => t.source && t.source !== 'manual' && t.created_at && t.created_at < IMPORT_FIX_AT);
}
