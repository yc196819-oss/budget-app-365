// What people say when adding money by voice ("שילמתי שמונים שקל בסופר",
// "קיבלתי משכורת 21 אלף") turned into an amount, a description and
// expense/income, and a long recording with several of them split into
// separate transactions. Works for typed text and keyboard dictation too.
// Pure.

const UNITS = {
  'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4,
  'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10
};
const TEENS = { 'אחת עשרה': 11, 'אחד עשר': 11, 'שתים עשרה': 12, 'שנים עשר': 12, 'חמש עשרה': 15, 'חמישה עשר': 15 };
const TENS = { 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50, 'שישים': 60, 'שבעים': 70, 'שמונים': 80, 'תשעים': 90 };
const HUNDREDS = { 'מאה': 100, 'מאתיים': 200, 'שלוש מאות': 300, 'ארבע מאות': 400, 'חמש מאות': 500, 'שש מאות': 600, 'שבע מאות': 700, 'שמונה מאות': 800, 'תשע מאות': 900 };
const THOUSANDS = { 'אלף': 1000, 'אלפיים': 2000, 'שלושת אלפים': 3000, 'ארבעת אלפים': 4000, 'חמשת אלפים': 5000, 'ששת אלפים': 6000, 'שבעת אלפים': 7000, 'שמונת אלפים': 8000, 'תשעת אלפים': 9000, 'עשרת אלפים': 10000 };

// Word phrases, longest first, so "שלוש מאות" wins over "שלוש".
const PHRASES = Object.entries({ ...THOUSANDS, ...HUNDREDS, ...TEENS, ...TENS, ...UNITS }).sort((a, b) => b[0].length - a[0].length);

const INCOME = /(קיבלתי|קיבלנו|נכנס|נכנסה|נכנסו|הכנסה|משכורת|שכר|החזר|זיכוי|בונוס|מתנה שקיבל|העבירו לי|העבירו לנו)/;
const EXPENSE = /(שילמתי|שילמנו|קניתי|קנינו|הוצאתי|הוצאנו|עלה לי|עלה לנו|עלתה לי|עלו לי)/;
const DAYS = [[/(^|\s)שלשום(?=\s|$)/, 2], [/(^|\s)אתמול(?=\s|$)/, 1], [/(^|\s)היום(?=\s|$)/, 0]];
const FILLER = /(^|\s)(שלשום|אתמול|היום|שילמתי|שילמנו|קניתי|קנינו|הוצאתי|הוצאנו|עלה לי|עלה לנו|עלתה לי|קיבלתי|קיבלנו|נכנס לי|נכנס לנו|נכנסו|נכנסה|נכנס|תוסיף|תוסיפי|להוסיף|הוסף|תרשום|תרשמי|לרשום|בערך|בסך הכל|רק)(?=\s|$)/g;
const CURRENCY = /(שקלים|שקל|ש"ח|ש״ח|שח|₪|nis)/gi;

// Hebrew number words → digits, inside the text ("מאה וחמישים" → "150",
// "21 אלף" → "21000", "אלף וחמש מאות" → "1500").
export function wordsToNumbers(text) {
  let s = ' ' + String(text || '').replace(/\s+/g, ' ') + ' ';
  // "ב-12" / "ב12" / "ל-300": the preposition goes, the amount stays.
  s = s.replace(/(\s)[בל]-?(?=\d)/g, '$1');
  // "21 אלף" / "2.5 אלף"
  s = s.replace(/(\d+(?:\.\d+)?)\s*(אלף|אלפים)(?=\s)/g, (_m, n) => String(Math.round(Number(n) * 1000)));
  // A run of number words joined by "ו" ("מאה ושלושים וחמש"), maybe with a
  // preposition in front ("במאתיים" → "250" for "for two hundred").
  const word = PHRASES.map(([w]) => w.replace(/ /g, '\\s')).join('|');
  const run = new RegExp(`(^|\\s)[בל]?((?:ו?(?:${word}))(?:\\s(?:ו?(?:${word})))*)(?=\\s)`, 'g');
  s = s.replace(run, (_m, pre, phrase) => {
    let total = 0;
    let rest = phrase;
    while (rest) {
      rest = rest.replace(/^\s*ו?/, '');
      const hit = PHRASES.find(([w]) => rest.startsWith(w));
      if (!hit) break;
      total += hit[1];
      rest = rest.slice(hit[0].length);
    }
    return total ? pre + total : pre + phrase;
  });
  return s.trim();
}

// { amount, description, type: 'expense'|'income' } or null when there is no
// amount. With { details: true } also whether the type and the day were said
// explicitly, and daysAgo ("אתמול" = 1), for splitting a long recording.
export function parseSpoken(text, { details = false } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const isIncome = INCOME.test(raw);
  const type = isIncome ? 'income' : 'expense';
  const day = DAYS.find(([re]) => re.test(raw));
  let s = wordsToNumbers(raw);
  const m = s.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
  if (!(amount > 0)) return null;
  // "46 בורקס" keeps its letters: only a currency word marks a preposition (below).
  s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  // "80 שקל בסופר" / "שקל על דלק": the place after the currency loses its preposition.
  s = s.replace(/(?:שקלים|שקל|ש"ח|ש״ח|שח|₪)\s+(?:על\s+|ב(?=\S{2,})|ל(?=\S{2,}))/g, ' ');
  const description = s.replace(CURRENCY, ' ').replace(FILLER, ' ').replace(/^\s*(על|ב|ל)\s+/, ' ').replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!description) return null;
  if (!details) return { amount, description, type };
  return { amount, description, type, typeSaid: isIncome || EXPENSE.test(raw), daysAgo: day ? day[1] : null };
}

const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

// A segment with several amounts is cut between them: before a word that
// starts with "ו" if there is one, else by the segment's own order (amount
// first: "80 סופר 46 קפה", or description first: "סופר 80 קפה 46").
function cutByAmounts(segment) {
  const words = segment.split(' ').filter(Boolean);
  const at = words.map((w, i) => (AMOUNT.test(w) ? i : -1)).filter((i) => i >= 0);
  if (at.length < 2) return [segment];
  const amountFirst = at[0] === words.findIndex((w) => !FILLER_WORD.test(w));
  const cuts = [];
  for (let k = 0; k < at.length - 1; k++) {
    const between = [];
    for (let i = at[k] + 1; i < at[k + 1]; i++) between.push(i);
    const vav = between.find((i) => /^ו\S{2,}/.test(words[i]));
    cuts.push(vav !== undefined ? vav : amountFirst ? at[k + 1] : at[k] + 1);
  }
  const out = [];
  let from = 0;
  for (const c of cuts) { out.push(words.slice(from, c)); from = c; }
  out.push(words.slice(from));
  return out.map((ws) => ws.map((w, i) => (i === 0 && /^ו\S{2,}/.test(w) && !AMOUNT.test(w) ? w.slice(1) : w)).join(' ')).filter((x) => x.trim());
}
const FILLER_WORD = /^(שילמתי|שילמנו|קניתי|קנינו|הוצאתי|הוצאנו|קיבלתי|קיבלנו|אתמול|היום|שלשום|גם|ועוד)$/;

// A recording (or a typed line) with several transactions → each one as
// { amount, description, type, daysAgo }, plus what could not be understood.
// Separators: commas, full stops, "וגם", "ואז", "אחר כך", "בנוסף", and "ו"
// before an amount ("80 בסופר ו-46 קפה"). The type and the day carry over:
// "אתמול קניתי לחם ב-12 וחלב ב-8" is two expenses, both yesterday.
export function splitSpoken(text) {
  let s = ' ' + wordsToNumbers(text) + ' ';
  s = s.replace(/,(?!\d{3}(?!\d))/g, ' | ').replace(/[.;!?\n](?!\d)/g, ' | ');
  s = s.replace(/\s(?:וגם|ואז|אחר כך|אחרי זה|בנוסף|ועוד)(?=\s)/g, ' | ');
  s = s.replace(/\sו-?(?=\d)/g, ' | ');
  const segments = s.split('|').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).flatMap(cutByAmounts);
  const items = [];
  const unclear = [];
  let lastType = 'expense';
  let lastDay = 0;
  for (const seg of segments) {
    const p = parseSpoken(seg.replace(/^ו(?=[\u0590-\u05FF]{2,})/, ''), { details: true });
    if (!p) { if (/[\u0590-\u05FFa-z]{2,}/i.test(seg) && /\d/.test(seg)) unclear.push(seg); continue; }
    const type = p.typeSaid ? p.type : lastType;
    const daysAgo = p.daysAgo !== null ? p.daysAgo : lastDay;
    items.push({ amount: p.amount, description: p.description, type, daysAgo });
    lastType = type;
    lastDay = daysAgo;
  }
  return { items, unclear };
}

// ── review before adding ──

const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// Split items → editable review cards: the category from the last time the
// merchant appeared (same kind), the date from "אתמול"/"שלשום".
// guess(description, type) → { category_id, subcategory_id } | null
export function toReviewItems(items, guess, today = new Date()) {
  return items.map((it, i) => {
    const g = guess(it.description, it.type);
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (it.daysAgo || 0));
    return { key: 'v' + i + '-' + it.amount, type: it.type, amount: it.amount, description: it.description, catId: g ? g.subcategory_id || g.category_id : '', date: iso(d) };
  });
}

export function reviewValid(item) {
  return Number(item.amount) > 0 && String(item.description || '').trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date || '');
}

// A review card → the transaction to save. catId is a category or a
// sub-category id; a sub-category carries its parent as the category.
export function reviewToTx(item, categories) {
  const c = item.catId ? categories.find((x) => x.id === item.catId) : null;
  return {
    type: item.type === 'income' ? 'income' : 'expense',
    amount: Math.round(Number(item.amount) * 100) / 100,
    description: String(item.description).trim(),
    tx_date: item.date,
    category_id: c ? c.parent_id || c.id : null,
    subcategory_id: c && c.parent_id ? c.id : null
  };
}

// The finished phrases of a recording, joined once. Chrome on Android sends
// each phrase again with the earlier words in front ("80 בסופר",
// "80 בסופר ו-46 קפה"), so a phrase that extends the previous one replaces
// it, and one already contained is skipped.
export function mergeFinals(list) {
  const out = [];
  for (const raw of list) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const last = out[out.length - 1];
    if (last && t.startsWith(last)) out[out.length - 1] = t;
    else if (last && last.startsWith(t)) continue;
    else out.push(t);
  }
  return out.join(' ');
}
