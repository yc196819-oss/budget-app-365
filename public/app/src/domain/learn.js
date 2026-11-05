// "What the advisor learned": the AI reads a conversation and proposes
// updates (decisions to remember, goals, budgets, balances, loans,
// installments, income). By default the app applies them by itself and shows
// each, with undo; with that switched off, the person approves each item.
// This module checks every proposal against the household's real data,
// so only updates that make sense, and actually change something, reach the
// screen. Pure: no DOM, no network.

const MAX_ITEMS = 12;
const num = (v) => { const n = Number(String(v ?? '').replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };
const money = (v) => { const n = num(v); return n === null ? null : Math.round(n); };
const clean = (s, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (s) => clean(s).toLowerCase().replace(/["'״׳.,!?()-]/g, '').replace(/\s+/g, ' ');

// "2027-07-15" stays; "2027-07" becomes the 1st of the month; else null.
export function normDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return s;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return s + '-01';
  return null;
}

export const MEMORY_KINDS = ['decision', 'preference', 'goal', 'fact'];

// The current income the household expects (households.income_expectations,
// shared with the previous app): the sum of its lines.
export function expectedIncome(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((s, l) => s + (num(l && l.amount) || 0), 0);
}

// The income line an update belongs to: the line whose label shares a
// word with it ("משכורת דנה" ↔ "משכורת דנה – עבודה"), names first. -1 when
// none does (a new line). One line with a generic label (no name) is the
// household's total, so it is the one to change.
const WORDS_SKIP = new Set(['משכורת', 'הכנסה', 'חודשית', 'נטו', 'הערכה', 'של', 'שכר', 'ברוטו', 'צפויה']);
const wordsOf = (s) => norm(s).split(/[\s\-–—()·,]+/).filter((w) => w.length >= 2 && !WORDS_SKIP.has(w));
export function incomeLineIndex(lines, label) {
  const list = Array.isArray(lines) ? lines : [];
  const want = wordsOf(label);
  if (want.length) {
    const i = list.findIndex((l) => wordsOf(l && l.label).some((w) => want.includes(w)));
    if (i >= 0) return i;
  }
  if (!want.length && list.length === 1) return 0;
  if (list.length === 1 && !wordsOf(list[0] && list[0].label).length) return 0;
  return -1;
}

// What the AI is told about the household, so it can refer to real goals,
// categories and accounts. Only names and amounts, never transactions.
export function learnContext({ goals = [], categories = [], budgets = [], accounts = [], loans = [], income = [], memories = [] }) {
  const budgetOf = new Map(budgets.map((b) => [b.category_id, Number(b.monthly_amount) || 0]));
  return {
    goals: goals.map((g) => ({ id: g.id, name: g.name, target_amount: Number(g.target_amount) || 0, saved_amount: Number(g.saved_amount) || 0, target_date: g.target_date || null })),
    categories: categories.filter((c) => !c.parent_id && c.kind !== 'income').map((c) => ({ name: c.name, budget: budgetOf.get(c.id) || 0 })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance ?? null })),
    loans: loans.filter((l) => !l.settled).map((l) => ({ counterparty: l.counterparty, direction: l.direction, amount: Number(l.amount) || 0 })),
    income: (Array.isArray(income) ? income : []).map((l) => ({ label: l.label || '', amount: Number(l.amount) || 0 })),
    // No transactions here: a deletion the person asks for is matched on the
    // device against the real lines (normalizeOne), from the words they used.
    memories: memories.map((m) => (typeof m === 'string' ? m : m.text)).filter(Boolean).slice(0, 40)
  };
}

function findGoal(goals, name) {
  const n = norm(name);
  return n ? goals.find((g) => norm(g.name) === n) : null;
}

function findCategory(categories, name) {
  const n = norm(name);
  if (!n) return null;
  const roots = categories.filter((c) => !c.parent_id && c.kind !== 'income');
  return roots.find((c) => norm(c.name) === n) || roots.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name))) || null;
}

function isKnownMemory(memories, text) {
  const n = norm(text);
  const nums = (s) => (String(s).match(/\d[\d,.]*/g) || []).map((x) => x.replace(/[,.]/g, '')).sort().join('|');
  const words = (s) => new Set(String(s).split(/\s+/).filter((w) => w.length > 2));
  return memories.some((m) => {
    const o = norm(typeof m === 'string' ? m : m.text);
    if (o === n || (o.length > 12 && (o.includes(n) || n.includes(o)))) return true;
    // "החוג 1,380 ל-3 חודשים, ואז 1,150" said twice in other words.
    if (nums(o) && nums(o) === nums(n)) { const a = words(o), b = words(n); const both = [...a].filter((w) => b.has(w)).length; return both / Math.max(1, Math.min(a.size, b.size)) >= 0.5; }
    return false;
  });
}

const GOAL_FIELDS = ['target_amount', 'saved_amount', 'target_date'];

function goalUpdate(goal, raw) {
  const set = {};
  const src = raw.set || raw;
  for (const f of GOAL_FIELDS) {
    if (src[f] === undefined || src[f] === null || src[f] === '') continue;
    const v = f === 'target_date' ? normDate(src[f]) : money(src[f]);
    if (v === null || (f !== 'target_date' && v < 0) || (f === 'target_amount' && v === 0)) continue;
    const before = f === 'target_date' ? goal[f] || null : Number(goal[f]) || 0;
    if (v !== before) set[f] = v;
  }
  return Object.keys(set).length ? { kind: 'goal_update', goal_id: goal.id, name: goal.name, set, before: Object.fromEntries(Object.keys(set).map((f) => [f, goal[f] ?? null])) } : null;
}

// One raw proposal from the AI → a checked item, or null when it does not
// fit the data (unknown goal, no amount, nothing would change).
function normalizeOne(raw, data) {
  const { goals = [], categories = [], budgets = [], accounts = [], loans = [], income = [], memories = [] } = data;
  const today = data.today || new Date().toISOString().slice(0, 10);
  switch (raw && raw.kind) {
    case 'memory': {
      const text = clean(raw.text);
      if (text.length < 4 || isKnownMemory(memories, text)) return null;
      return { kind: 'memory', text, memKind: MEMORY_KINDS.includes(raw.memKind || raw.type) ? (raw.memKind || raw.type) : 'decision' };
    }
    case 'goal': {
      const existing = findGoal(goals, raw.name);
      if (existing) return goalUpdate(existing, raw);
      const name = clean(raw.name, 60);
      const target = money(raw.target_amount ?? raw.amount);
      if (!name || !(target > 0)) return null;
      const saved = Math.max(0, money(raw.saved_amount) || 0);
      return { kind: 'goal', name, target_amount: target, saved_amount: Math.min(saved, target), target_date: normDate(raw.target_date ?? raw.date) };
    }
    case 'goal_update': {
      const goal = goals.find((g) => g.id === raw.goal_id) || findGoal(goals, raw.name);
      return goal ? goalUpdate(goal, raw) : null;
    }
    case 'budget': {
      const cat = findCategory(categories, raw.category);
      const amount = money(raw.amount);
      if (!cat || amount === null || amount < 0) return null;
      const before = Number((budgets.find((b) => b.category_id === cat.id) || {}).monthly_amount) || 0;
      if (amount === before) return null;
      return { kind: 'budget', category_id: cat.id, category: cat.name, amount, before };
    }
    case 'balance': {
      const acc = accounts.find((a) => a.id === raw.account_id) || (accounts.length === 1 ? accounts[0] : accounts.find((a) => norm(a.name) === norm(raw.account)));
      const balance = money(raw.balance ?? raw.amount);
      if (!acc || balance === null) return null;
      const before = acc.balance === null || acc.balance === undefined ? null : Number(acc.balance);
      if (before === balance) return null;
      return { kind: 'balance', account_id: acc.id, account: acc.name, balance, before };
    }
    case 'loan': {
      const counterparty = clean(raw.counterparty, 60);
      const amount = money(raw.amount);
      const direction = raw.direction === 'tome' ? 'tome' : 'iowe';
      if (!counterparty || !(amount > 0)) return null;
      if (loans.some((l) => !l.settled && norm(l.counterparty) === norm(counterparty) && Number(l.amount) === amount)) return null;
      return { kind: 'loan', direction, counterparty, amount };
    }
    case 'installment': {
      const description = clean(raw.description, 60);
      const total = money(raw.total_amount ?? raw.amount);
      const count = Math.round(num(raw.payments_count) || 0);
      if (!description || !(total > 0) || count < 2 || count > 120) return null;
      return { kind: 'installment', description, total_amount: total, payments_count: count, first_payment: normDate(raw.first_payment) || today };
    }
    case 'tx_delete': {
      // Only transactions that are really there, matched by name, amount and
      // (if given) date. Never applied by itself: shown for approval.
      const match = norm(raw.match || raw.description);
      const amount = money(raw.amount);
      const date = normDate(raw.date);
      if (match.length < 2) return null;
      const txs = (data.txs || []).filter((t) => norm(t.description).includes(match)
        && (amount === null || Math.abs(Number(t.amount) - amount) < 0.5)
        && (!date || String(t.tx_date).slice(0, 10) === date)).slice(0, 12);
      if (!txs.length) return null;
      return { kind: 'tx_delete', match: clean(raw.match || raw.description, 40), amount, date, reason: clean(raw.reason, 80),
        txs: txs.map((t) => ({ id: t.id, tx_date: t.tx_date, description: t.description, amount: Number(t.amount), type: t.type })) };
    }
    case 'income': {
      // One person's (or one source's) expected monthly income: it changes
      // that line only, never the household's other incomes.
      const amount = money(raw.amount);
      if (!(amount > 0)) return null;
      const label = clean(raw.label, 40) || 'הכנסה חודשית נטו';
      const i = incomeLineIndex(income, label);
      const line = i >= 0 ? income[i] : null;
      if (line && money(line.amount) === amount) return null;
      return { kind: 'income', label: line ? line.label || label : label, amount, before: line ? money(line.amount) : null };
    }
    default:
      return null;
  }
}

// Every proposal checked, duplicates dropped, each with a stable key and
// switched on. `data`: the household (goals, categories, budgets, accounts,
// loans, income lines, memories) and optionally today (YYYY-MM-DD).
export function normalizeItems(raw, data) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    const item = normalizeOne(r, data);
    if (!item) continue;
    const id = item.kind + ':' + norm(item.text || item.name || item.category || item.account || item.counterparty || item.description || item.match || '') + (item.kind === 'tx_delete' ? ':' + item.amount + ':' + (item.date || '') : '');
    if (seen.has(id)) continue;
    seen.add(id);
    // A deletion is never pre-checked: the person ticks it.
    out.push({ ...item, key: id, on: item.kind !== 'tx_delete' });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// Whether an item, after the person's edits, can be saved.
export function isValid(item) {
  switch (item.kind) {
    case 'memory': return clean(item.text).length >= 4;
    case 'goal': return !!clean(item.name) && item.target_amount > 0;
    case 'goal_update': return Object.keys(item.set || {}).length > 0;
    case 'budget': return item.amount >= 0;
    case 'balance': return Number.isFinite(item.balance);
    case 'loan': return !!clean(item.counterparty) && item.amount > 0;
    case 'installment': return !!clean(item.description) && item.total_amount > 0 && item.payments_count >= 2;
    case 'income': return item.amount > 0;
    case 'tx_delete': return Array.isArray(item.txs) && item.txs.length > 0;
    default: return false;
  }
}

export const KIND_LABEL = {
  memory: { icon: '🧠', label: 'לזכור' },
  goal: { icon: '🎯', label: 'יעד חדש' },
  goal_update: { icon: '🎯', label: 'עדכון יעד' },
  budget: { icon: '📊', label: 'תקציב' },
  balance: { icon: '🏦', label: 'יתרה בבנק' },
  loan: { icon: '🤝', label: 'הלוואה' },
  installment: { icon: '💳', label: 'תשלומים' },
  income: { icon: '💼', label: 'הכנסה חודשית' },
  tx_delete: { icon: '🗑', label: 'מחיקת תנועות' }
};

// The person said something worth saving since `from` (an index into the
// messages): an amount, or words of a decision or plan. Cheap, no AI call;
// used to offer "save what I learned?" after a reply.
const LEARN_WORDS = /(החלטנו|סיכמנו|נחליט|מעכשיו|מתכננים|מתכננת|מתכנן|רוצים לחסוך|לחסוך ל|יעד|תקציב|משכורת|הכנסה|הלוואה|לקחנו|תשלומים|קנינו|נקנה|יתרה|בחשבון יש|חוסכים|נחסוך|לא נוגעים|חשוב לנו)/;
// "Don't update" (or "just a question") in the last message: nothing is
// learned from it.
export const NO_LEARN = /(אל|לא|בלי|אין)\s+(ל|ת|צריך\s+ל)?עדכן|אל\s+תשמור|לא\s+לשמור|רק\s+שאלה/;
export function worthLearning(messages, from = 0) {
  const mine = (messages || []).filter((m) => m.role === 'user');
  if (mine.length && NO_LEARN.test(mine[mine.length - 1].text || '')) return false;
  return (messages || []).slice(from).some((m) => m.role === 'user' && (LEARN_WORDS.test(m.text || '') || /\d{3,}|\d+[,.]\d{3}|\d+\s*(אלף|₪|ש"ח|שח)/.test(m.text || '')));
}

// The conversation as the server expects it, newest 30 messages.
export function learnMessages(messages, nameOf) {
  return (messages || []).filter((m) => (m.role === 'user' || m.role === 'ai') && m.text && !m.pending)
    .slice(-30).map((m) => ({ role: m.role, author: m.role === 'user' ? nameOf(m.author_id) : undefined, text: String(m.text).slice(0, 1500) }));
}

// One line saying what was updated, for the "I updated from our talk" note.
const ils = (n) => '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');
const GOAL_WORD = { target_amount: 'סכום', saved_amount: 'נחסך', target_date: 'תאריך' };
export function describeItem(item) {
  switch (item.kind) {
    case 'memory': return 'זוכר: ' + item.text;
    case 'goal': return 'יעד חדש: ' + item.name + ' · ' + ils(item.target_amount) + (item.target_date ? ' עד ' + item.target_date.split('-').reverse().join('.') : '');
    case 'goal_update': return 'יעד ' + item.name + ': ' + Object.entries(item.set).map(([f, v]) => GOAL_WORD[f] + ' ' + (f === 'target_date' ? String(v).split('-').reverse().join('.') : ils(v))).join(', ');
    case 'budget': return 'תקציב ' + item.category + ': ' + ils(item.amount) + (item.before ? ' (היה ' + ils(item.before) + ')' : '');
    case 'balance': return 'יתרה ב' + item.account + ': ' + ils(item.balance) + (item.before !== null && item.before !== undefined ? ' (היה ' + ils(item.before) + ')' : '');
    case 'loan': return (item.direction === 'tome' ? 'חייבים לכם: ' : 'אתם חייבים ל') + item.counterparty + ' ' + ils(item.amount);
    case 'installment': return 'עסקה בתשלומים: ' + item.description + ' · ' + item.payments_count + ' × ' + ils(item.total_amount / item.payments_count);
    case 'tx_delete': return 'למחוק ' + (item.txs.length === 1 ? 'תנועה אחת' : item.txs.length + ' תנועות') + ': ' + item.txs.map((t) => t.description + ' ' + ils(t.amount) + ' (' + String(t.tx_date).slice(5, 10).split('-').reverse().join('.') + ')').join(', ');
    case 'income': return 'הכנסה צפויה · ' + (item.label || 'משק הבית') + ': ' + ils(item.amount) + (item.before ? ' (היה ' + ils(item.before) + ')' : ' (חדש)');
    default: return '';
  }
}
