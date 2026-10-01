// Pure logic for importing a card or bank statement. No DOM, no network.
// An imported item looks like:
//   { key, date: 'YYYY-MM-DD', description, amount: >0, type: 'expense'|'income',
//     category_id, subcategory_id, auto: 'history'|'ai'|null, dupe: 'likely'|'maybe'|null, dupeOf, include }

import { isoDate, guessCategory, sameMerchant } from './money.js';

// ── cells ──────────────────────────────────────────────────────────────

const clean = (v) => String(v == null ? '' : v).replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();

// "₪1,234.50", "-12", "12.00-" (trailing minus), "(12)", 1234.5 -> number, or null
export function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = clean(v).replace(/[₪$€]|ש"ח|ש״ח|NIS|ILS/gi, '').replace(/\s/g, '');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (s.endsWith('-')) { sign = -sign; s = s.slice(0, -1); }
  if (s.startsWith('-')) { sign = -sign; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) return null;
  return sign * Number(s.replace(/,/g, ''));
}

// Excel stores dates as days since 1899-12-30.
function fromExcelSerial(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function validYmd(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return y >= 2000 && y <= 2100 && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// "15/08/2026", "15.8.26", "2026-08-15", 46249 (Excel) -> "2026-08-15", or null
export function normalizeDate(v) {
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(clean(v))) {
    const n = Number(v);
    return n > 32000 && n < 80000 ? fromExcelSerial(n) : null;
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : null;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validYmd(y, +m[2], +m[1]) ? y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : null;
  }
  return null;
}

// ── CSV ────────────────────────────────────────────────────────────────

export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0];
  const delim = ['\t', ';', ','].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => clean(c)));
}

// ── statement tables ───────────────────────────────────────────────────
// Card companies export a table with a header row somewhere below a title.
// Some files hold several tables (one per card or per month), each with its
// own header, so the header is looked for again on every row.

const DATE_WORDS = ['תאריך עסקה', 'תאריך רכישה', 'תאריך העסקה', 'תאריך ערך', 'תאריך', 'date'];
const DESC_WORDS = ['שם בית העסק', 'שם בית עסק', 'בית העסק', 'בית עסק', 'שם העסק', 'תיאור', 'פרטים', 'הפעולה', 'description', 'merchant'];
const CHARGE_WORDS = ['סכום חיוב', 'סכום לחיוב', 'סכום החיוב', 'סכום בש"ח', 'סכום בש״ח', 'סכום'];
const DEBIT_WORDS = ['חובה'];
const CREDIT_WORDS = ['זכות'];
const AMOUNT_WORDS = ['amount'];
const SKIP_ROW = /סה"כ|סה״כ|סך הכל|total|יתרה/i;

function findCol(header, words) {
  for (const w of words) {
    const i = header.findIndex((h) => h === w.toLowerCase());
    if (i >= 0) return i;
  }
  for (const w of words) {
    const i = header.findIndex((h) => h.includes(w.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

export function detectHeader(row) {
  const header = row.map((c) => clean(c).toLowerCase());
  if (header.filter(Boolean).length < 3) return null;
  const date = findCol(header, DATE_WORDS);
  const desc = findCol(header, DESC_WORDS);
  // Prefer the charged amount (in shekels) over the original transaction amount.
  const charge = findCol(header, CHARGE_WORDS);
  const amount = charge >= 0 ? charge : findCol(header, AMOUNT_WORDS);
  const debit = findCol(header, DEBIT_WORDS);
  const credit = findCol(header, CREDIT_WORDS);
  if (date < 0 || desc < 0 || date === desc) return null;
  if (amount < 0 && debit < 0) return null;
  return { date, desc, amount, debit, credit };
}

export function rowsToTransactions(rows) {
  const out = [];
  let cols = null;
  for (const row of rows) {
    const header = detectHeader(row);
    if (header) { cols = header; continue; }
    if (!cols) continue;
    const description = clean(row[cols.desc]);
    const date = normalizeDate(row[cols.date]);
    if (!date || !description || SKIP_ROW.test(description)) continue;
    let value;
    if (cols.debit >= 0 || cols.credit >= 0) {
      const debit = cols.debit >= 0 ? parseAmount(row[cols.debit]) : null;
      const credit = cols.credit >= 0 ? parseAmount(row[cols.credit]) : null;
      if (debit) value = Math.abs(debit);
      else if (credit) value = -Math.abs(credit);
      else value = cols.amount >= 0 ? parseAmount(row[cols.amount]) : null;
    } else value = parseAmount(row[cols.amount]);
    if (!value) continue;
    // On a card statement a charge is positive and a refund is negative.
    out.push({ date, description, amount: Math.round(Math.abs(value) * 100) / 100, type: value < 0 ? 'income' : 'expense' });
  }
  return out;
}

// ── categories ─────────────────────────────────────────────────────────

export function rootOf(id, byId) {
  let c = byId.get(id);
  for (let i = 0; c && c.parent_id && i < 10; i++) c = byId.get(c.parent_id);
  return c || null;
}

// The category tree as text for the AI prompt, so it picks real ids.
export function categoryTreeText(categories) {
  const kids = new Map();
  for (const c of categories) {
    if (!c.parent_id) continue;
    if (!kids.has(c.parent_id)) kids.set(c.parent_id, []);
    kids.get(c.parent_id).push(c);
  }
  const walk = (c, depth) => ['  '.repeat(depth) + '- ' + c.name + ' (id:' + c.id + ')', ...(kids.get(c.id) || []).flatMap((k) => walk(k, depth + 1))];
  const roots = (kind) => categories.filter((c) => !c.parent_id && (kind === 'income' ? c.kind === 'income' : c.kind !== 'income'));
  return 'קטגוריות הוצאה:\n' + roots('expense').flatMap((c) => walk(c, 0)).join('\n')
    + '\n\nקטגוריות הכנסה:\n' + roots('income').flatMap((c) => walk(c, 0)).join('\n');
}

// Keeps only ids of this household's categories. A sub-category given as
// category_id becomes the sub-category of its root.
export function cleanCategory(type, category_id, subcategory_id, byId) {
  let cat = category_id ? byId.get(category_id) : null;
  let sub = subcategory_id ? byId.get(subcategory_id) : null;
  if (cat && cat.parent_id) { sub = sub || cat; cat = rootOf(cat.id, byId); }
  if (!cat && sub) cat = rootOf(sub.id, byId);
  if (cat && (cat.kind === 'income') !== (type === 'income')) { cat = null; sub = null; }
  if (sub && (!cat || rootOf(sub.id, byId)?.id !== cat.id || sub.id === cat.id)) sub = null;
  return { category_id: cat ? cat.id : null, subcategory_id: sub ? sub.id : null };
}

export function importPrompt(categories, today) {
  return 'חלץ את כל התנועות מהפירוט הבא (כרטיס אשראי או חשבון בנק). תאריך היום: ' + isoDate(today) + '. '
    + 'לכל תנועה בחר קטגוריה מהרשימה, ברמה הכי ספציפית שקיימת. השאר את שם בית העסק מלא כפי שהוא מופיע. '
    + 'זיכוי או החזר הם type "income". אל תכלול שורות סיכום.\n\n' + categoryTreeText(categories)
    + '\n\nהחזר JSON בלבד, בלי markdown, מערך:\n[{"date":"YYYY-MM-DD","description":"...","amount":מספר חיובי,"type":"expense"|"income","category_id":"id של קטגוריית השורש או null","subcategory_id":"id של תת-קטגוריה או null"}]';
}

export function categorizePrompt(categories) {
  return 'לפניך רשימת בתי עסק מפירוט אשראי, שורה לכל אחד: מספר | תיאור | סכום | סוג. '
    + 'בחר לכל אחד קטגוריה מהרשימה, ברמה הכי ספציפית שקיימת. אם לא ברור, החזר null.\n\n' + categoryTreeText(categories)
    + '\n\nהחזר JSON בלבד, בלי markdown, מערך:\n[{"i":מספר,"category_id":"id של קטגוריית השורש או null","subcategory_id":"id של תת-קטגוריה או null"}]';
}

export function categorizeText(items) {
  return items.map((t, i) => i + ' | ' + t.description + ' | ' + t.amount + ' | ' + (t.type === 'income' ? 'הכנסה' : 'הוצאה')).join('\n');
}

// What the AI returned for a whole statement -> clean items.
export function fromAi(list, categories) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (Array.isArray(list) ? list : [])
    .map((t) => {
      const type = t && t.type === 'income' ? 'income' : 'expense';
      const amount = Math.round(Math.abs(Number(t && t.amount) || 0) * 100) / 100;
      const date = normalizeDate(t && t.date);
      const cat = cleanCategory(type, t && t.category_id, t && t.subcategory_id, byId);
      return { date, description: clean(t && t.description) || 'ייבוא', amount, type, ...cat, auto: cat.category_id ? 'ai' : null };
    })
    .filter((t) => t.amount > 0 && t.date);
}

// One line per merchant that still needs a category: what is sent to the AI.
export function waitingMerchants(items, limit = 200) {
  const out = [];
  for (const t of items) {
    if (t.category_id || out.some((o) => o.type === t.type && sameMerchant(o.description, t.description))) continue;
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

// Applies the AI's [{ i, category_id, subcategory_id }] (i indexes `sent`) to
// every waiting line of the same merchant.
export function applyAiCategories(items, sent, answers, categories) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const picks = [];
  for (const a of Array.isArray(answers) ? answers : []) {
    const t = sent[Number(a && a.i)];
    if (!t) continue;
    const cat = cleanCategory(t.type, a.category_id, a.subcategory_id, byId);
    if (cat.category_id) picks.push({ t, cat });
  }
  return items.map((it) => {
    if (it.category_id) return it;
    const p = picks.find(({ t }) => t.type === it.type && sameMerchant(t.description, it.description));
    return p ? { ...it, ...p.cat, auto: 'ai' } : it;
  });
}

// What this household chose for the same merchant before wins over anything else.
export function categorizeFromHistory(items, history) {
  const byType = { expense: history.filter((t) => t.type !== 'income'), income: history.filter((t) => t.type === 'income') };
  return items.map((t) => {
    const g = guessCategory(t.description, byType[t.type]);
    return g ? { ...t, category_id: g.category_id, subcategory_id: g.subcategory_id, auto: 'history' } : t;
  });
}

// Choosing a category for one line also fills the other lines of the same
// merchant that are still waiting.
export function setItemCategory(items, key, category_id, subcategory_id) {
  const target = items.find((t) => t.key === key);
  if (!target) return items;
  return items.map((t) => {
    if (t.key === key) return { ...t, category_id, subcategory_id, auto: null };
    if (!t.category_id && t.type === target.type && sameMerchant(t.description, target.description)) return { ...t, category_id, subcategory_id, auto: null };
    return t;
  });
}

// ── duplicates ─────────────────────────────────────────────────────────
// Same rule as the current app: same type and amount within 3 days, scored
// up by same day and a shared word. 75+ is "likely", 60-74 is "maybe".

const dupNorm = (s) => String(s || '').replace(/\(?\s*תשלום\s*\d+\s*מתוך\s*\d+\s*\)?/g, ' ').replace(/["'׳״().,:\-_/\\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export function similarText(a, b) {
  const A = dupNorm(a);
  const B = dupNorm(b);
  if (!A || !B) return false;
  if (A === B || A.includes(B) || B.includes(A)) return true;
  const words = new Set(B.split(' ').filter((w) => w.length > 1));
  return A.split(' ').some((w) => w.length > 1 && words.has(w));
}

function dayDiff(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round(Math.abs(Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

export function bestDuplicate(item, pool) {
  let best = null;
  for (const ex of pool) {
    if ((ex.type || 'expense') !== item.type) continue;
    if (Math.abs(Number(ex.amount) - item.amount) > 0.01) continue;
    const date = ex.tx_date || ex.date;
    if (!date) continue;
    const dd = dayDiff(date, item.date);
    if (dd > 3) continue;
    const score = 50 + (dd === 0 ? 25 : dd === 1 ? 15 : 5) + (similarText(ex.description, item.description) ? 10 : 0);
    if (score >= 60 && (!best || score > best.score)) best = { tx: ex, score };
  }
  return best;
}

// Flags lines that already exist in the household, or twice in the same file.
// Likely duplicates start unchecked.
export function flagDuplicates(items, existing) {
  const seen = [];
  return items.map((t) => {
    const hit = bestDuplicate(t, existing) || bestDuplicate(t, seen);
    const dupe = hit ? (hit.score >= 75 ? 'likely' : 'maybe') : null;
    if (dupe !== 'likely') seen.push(t);
    return { ...t, dupe, dupeOf: hit ? { date: hit.tx.tx_date || hit.tx.date, description: hit.tx.description || '' } : null, include: dupe !== 'likely' };
  });
}

// ── whole flow ─────────────────────────────────────────────────────────

export function withKeys(items) {
  return items.map((t, i) => ({ ...t, key: 'i' + i }));
}

export function prepare(items, history) {
  return flagDuplicates(withKeys(items), history);
}

export function summary(items) {
  const chosen = items.filter((t) => t.include);
  return {
    found: items.length,
    chosen: chosen.length,
    auto: chosen.filter((t) => t.category_id).length,
    waiting: chosen.filter((t) => !t.category_id).length,
    likely: items.filter((t) => t.dupe === 'likely').length,
    maybe: items.filter((t) => t.dupe === 'maybe').length,
    expense: chosen.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    income: chosen.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
    from: chosen.reduce((m, t) => (!m || t.date < m ? t.date : m), null),
    to: chosen.reduce((m, t) => (!m || t.date > m ? t.date : m), null)
  };
}

// The rows to insert into `transactions`.
export function toRows(items) {
  return items.filter((t) => t.include).map((t) => ({
    type: t.type,
    amount: t.amount,
    description: t.description,
    tx_date: t.date,
    category_id: t.category_id || null,
    subcategory_id: t.subcategory_id || null,
    nature: 'variable',
    spread: 'month',
    source: 'pdf'
  }));
}
