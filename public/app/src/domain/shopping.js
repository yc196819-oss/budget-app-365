// The shopping list: what to buy, sorted by where it is in the store,
// remembered from one shopping to the next. Pure.

import { plainLetters } from './produce.js';

// The store's departments, in the order most stores are walked.
export const AISLES = [
  { key: 'produce', label: 'ירקות ופירות', words: ['עגבני', 'מלפפון', 'בצל', 'שום', 'תפוח', 'תפוז', 'בננ', 'גזר', 'פלפל', 'חסה', 'כרוב', 'קישוא', 'חציל', 'לימון', 'אבוקדו', 'ענב', 'אגס', 'אפרסק', 'תות', 'פטרוזיליה', 'כוסברה', 'שמיר', 'נענע', 'פטריות', 'בטטה', 'דלעת', 'סלק', 'צנון', 'קלמנטינ', 'אבטיח', 'מלון', 'ירקות', 'פירות', 'תפוא', 'תפו"א', 'תפוחי אדמה', 'ארטישוק', 'ברוקולי', 'כרובית', 'שעועית ירוקה', 'תמרים'] },
  { key: 'bakery', label: 'מאפים', words: ['לחם', 'לחמני', 'פית', 'חלה', 'חלות', 'בגט', 'עוגה', 'עוגיות', 'קרואסון', 'מאפ', 'טורטי', 'בייגל', 'פרוסות'] },
  { key: 'dairy', label: 'מוצרי חלב', words: ['חלב', 'גבינ', 'קוטג', 'יוגורט', 'שמנת', 'חמאה', 'לבן', 'לבנה', 'מעדן', 'ביצ', 'אשל', 'גיל', 'שוקו', 'פודינג', 'מרגרינה', 'טופו'] },
  { key: 'meat', label: 'בשר, עוף ודגים', words: ['עוף', 'בשר', 'שניצל', 'כרעיים', 'חזה', 'טחון', 'דג', 'סלמון', 'טונה', 'נקניק', 'פרגית', 'הודו', 'כבד', 'קציצ', 'פילה', 'מושט', 'אמנון', 'דניס', 'לברק', 'בורי', 'מוסר ים', 'שוקיים', 'פרגי', 'כנפיים', 'קבב', 'המבורגר', 'אנטריקוט', 'צלעות', 'כתף', 'שווארמה'] },
  { key: 'dry', label: 'יבשים ומזווה', words: ['אורז', 'פסטה', 'ספגטי', 'קמח', 'סוכר', 'מלח', 'שמן', 'קטני', 'עדשים', 'חומוס', 'שעועית', 'קוסקוס', 'פתיתים', 'קורנפלקס', 'דגני', 'שיבולת', 'תבלין', 'פפריקה', 'כמון', 'רסק', 'קפה', 'תה', 'דבש', 'ריבה', 'ממרח', 'טחינה', 'שוקולד', 'במבה', 'ביסלי', 'חטיף', 'אגוז', 'שקדים', 'צימוק', 'שימורים', 'תירס', 'זיתים', 'מלפפון חמוץ', 'קטשופ', 'מיונז', 'חרדל', 'רוטב', 'אבקת מרק', 'חלבה', 'חלווה', 'שומשום', 'ביסקוויט', 'קרקר', 'חמאת בוטנים', 'בורגול', 'קינואה', 'גרגירי', 'זעתר', 'ריבת', 'אבקת אפייה', 'שמרים', 'וניל', 'פירורי לחם', 'מצות', 'ופל', 'וופל'] },
  { key: 'frozen', label: 'קפואים', words: ['קפוא', 'גלידה', 'בורקס', 'אפונה', 'ירקות קפואים', 'פיצה', 'בצק'] },
  { key: 'drinks', label: 'משקאות', words: ['מים', 'סודה', 'מיץ', 'קולה', 'תפוזים', 'בירה', 'יין', 'משקה', 'פטל', 'ספרייט', 'שוופס', 'פריגת', 'תפוזינה', 'פפסי', 'ספרינג', 'נביעות', 'ויסקי', 'וודקה'] },
  { key: 'clean', label: 'ניקיון', words: ['כביסה', 'מרכך', 'אקונומיקה', 'סבון כלים', 'נוזל כלים', 'ספוג', 'שקיות', 'נייר טואלט', 'מגבות נייר', 'נייר', 'אלומיניום', 'ניילון', 'מטהר', 'מנקה', 'סנו', 'כלים חד', 'נרות', 'פתיליות', 'גפרורים', 'כפפות', 'מטליות', 'שקיות זבל', 'סוללות'] },
  { key: 'care', label: 'היגיינה ופארם', words: ['שמפו', 'סבון', 'מברשת', 'משחת שיניים', 'דאודורנט', 'תחבושות', 'צמר גפן', 'קרם', 'גילוח', 'מרכך שיער'] },
  { key: 'baby', label: 'תינוקות', words: ['חיתול', 'מגבונים', 'מטרנה', 'סימילאק', 'דייסה', 'דייסת', 'מוצץ', 'טיטולים'] },
  { key: 'other', label: 'אחר', words: [] }
];
const AISLE_ORDER = AISLES.map((a) => a.key);

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const key = (s) => norm(s).toLowerCase().replace(/["'׳״]/g, '');

// Which department an item belongs to. A word counts where a word starts
// (after one prefix letter at most: "לכביסה" is laundry, but "רגיל" is not
// "גיל" and "פיתות" is not "תות"). The first thing named wins, since in
// Hebrew it is what the item is ("רוטב עגבניות" is a sauce, "מיץ ענבים" a
// drink); at the same place, a longer match ("סבון כלים" is cleaning, "סבון"
// is hygiene).
// (Letters at a word's end written plainly: "מלפפונים" is cucumbers too.)
const PREFIX = 'והבלמשכ';
export function aisleOf(name) {
  const n = plainLetters(key(name));
  let best = { key: 'other', pos: Infinity, len: 0 };
  for (const a of AISLES) {
    for (const w of a.words) {
      const k = plainLetters(key(w));
      for (let at = n.indexOf(k); at >= 0; at = n.indexOf(k, at + 1)) {
        const start = at === 0 || n[at - 1] === ' ' || (PREFIX.includes(n[at - 1]) && (at === 1 || n[at - 2] === ' '));
        if (!start) continue;
        const pos = n.slice(0, at).split(' ').length - 1;
        if (pos < best.pos || (pos === best.pos && k.length > best.len)) best = { key: a.key, pos, len: k.length };
        break;
      }
    }
  }
  return best.key;
}

const WORDS = { 'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'עשר': 10, 'עשרה': 10 };
const UNITS = ['ק"ג', 'קג', 'קילו', 'גרם', 'ליטר', 'ל\'', 'יח\'', 'יחידות', 'חבילות', 'חבילה', 'בקבוקים', 'בקבוק', 'תבניות', 'תבנית', 'שקיות', 'שקית', 'קופסאות', 'קופסה', 'מגשים', 'מגש'];

const WEIGHTS = ['ק"ג', 'קג', 'קילו', 'גרם', 'ליטר'];

// One item from a few typed words: "2 ביצים", "ביצים x2", "שתי תבניות ביצים",
// "1 ק"ג עגבניות" -> { name, qty }.
// A line pasted from a message: its bullet, numbering ("1.", "2)"), check
// marks and emoji are not part of the name.
export function cleanLine(text) {
  return norm(String(text || '')
    .replace(/\p{Extended_Pictographic}|[\u2600-\u27BF\uFE0F\u200d]/gu, ' ')
    .replace(/^\s*(?:[-–—•*·▪◦●○■□☐✓→>]+\s*|\d{1,2}\s*[.)]\s+)/, '')
    .replace(/[,;.]+\s*$/, ''));
}
export function parseItem(text) {
  let t = cleanLine(text);
  // "ולחם" is bread, but "ויסקי" and "ופלים" start with their own "ו".
  const bare = t.replace(/^(ו|גם)\s*/, '');
  if (bare !== t && (aisleOf(bare) !== 'other' || aisleOf(t) === 'other')) t = bare;
  if (!t) return null;
  let qty = null;
  // (A number that is a percent is part of the name: "3% חלב".)
  let m = /^(\d+(?:[.,]\d+)?)(?!\s*%)\s*(.*)$/.exec(t);
  if (m && m[2]) { qty = m[1]; t = m[2]; }
  else {
    m = /^(.*?)\s*[x×*]\s*(\d+)$/.exec(t) || /^(.*?)\s+(\d+)$/.exec(t);
    // A size, not how many: "טיטולים מידה 4", "מטרנה שלב 2", and eggs by the tray ("ביצים L 12").
    const sizeOf = m && m[1] && !/[x×*]\s*\d+$/.test(t) && (/(מידה|מס['׳]?|שלב|גודל)$/.test(m[1].trim()) || (/ביצים/.test(m[1]) && [6, 10, 12, 18, 20, 24, 30].includes(Number(m[2]))));
    if (m && m[1] && !sizeOf) { qty = m[2]; t = m[1]; }
    else {
      const w = t.split(' ');
      if (WORDS[w[0]] && w.length > 1) { qty = String(WORDS[w[0]]); t = w.slice(1).join(' '); }
    }
  }
  // A size at the end: "חלב 3% 2 ליטר" → "חלב 3%", 2 ליטר.
  if (!qty) {
    const e = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(ק"ג|קג|קילו|גרם|ליטר|ל'|יח'|יחידות)$/.exec(t);
    if (e) return { name: norm(e[1]).slice(0, 80), qty: (e[2] + ' ' + e[3].replace('קג', 'ק"ג').replace('קילו', 'ק"ג')).slice(0, 20) };
  }
  // A package word is the amount only with a number ("2 שקיות חלב"); alone it
  // is part of the name ("שקיות זבל"). A weight needs none ("קילו עגבניות").
  const unit = UNITS.find((u) => t.startsWith(u + ' ') && (qty || WEIGHTS.includes(u)));
  if (unit) { qty = (qty || '1') + ' ' + unit.replace('קג', 'ק"ג').replace('קילו', 'ק"ג'); t = t.slice(unit.length + 1); }
  else if (qty) qty = '×' + qty;
  t = norm(t);
  return t ? { name: t.slice(0, 80), qty: qty ? qty.slice(0, 20) : null } : null;
}

// "לחם ועגבניות" is two things, but "תה ויסוצקי" is one: a part after "ו"
// stands alone only when it is a thing we know.
function splitAnd(chunk) {
  const parts = String(chunk).split(/\s+(?=ו[א-ת]{2,})/);
  const out = [];
  for (const p of parts) {
    if (out.length && /^ו/.test(p) && aisleOf(p.slice(1)) === 'other') out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

// Several items in one line: "חלב, 2 ביצים ולחם".
export function parseItems(text) {
  return String(text || '')
    // A heading line ("רשימה לשבת:") is not an item.
    .split('\n').filter((l) => !/:\s*$/.test(l.trim())).join('\n')
    .split(/[,\n،;]|\s+וגם\s+/)
    .flatMap(splitAnd)
    .map(parseItem)
    .filter(Boolean)
    .map((it) => ({ ...it, aisle: aisleOf(it.name) }));
}

// The open list in store order, as { aisle, label, items }.
export function grouped(items) {
  const open = items.filter((i) => !i.cleared_at);
  const groups = new Map();
  for (const i of open) {
    const a = AISLE_ORDER.includes(i.aisle) ? i.aisle : 'other';
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push(i);
  }
  return AISLE_ORDER.filter((a) => groups.has(a)).map((a) => ({
    aisle: a,
    label: AISLES.find((x) => x.key === a).label,
    items: groups.get(a).sort((x, y) => Number(x.done) - Number(y.done) || String(x.created_at).localeCompare(String(y.created_at)))
  }));
}

// What this household buys again and again (from finished shoppings), most
// often first, without what is already on the list.
export function usual(items, limit = 8) {
  const open = new Set(items.filter((i) => !i.cleared_at).map((i) => key(i.name)));
  const count = new Map();
  for (const i of items) {
    if (!i.cleared_at || !i.done) continue;
    const k = key(i.name);
    if (open.has(k)) continue;
    const c = count.get(k) || { name: norm(i.name), n: 0, last: '' };
    c.n++;
    if (String(i.cleared_at) > c.last) { c.last = String(i.cleared_at); c.name = norm(i.name); }
    count.set(k, c);
  }
  return [...count.values()].filter((c) => c.n >= 1).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, limit).map((c) => c.name);
}

// The last finished shopping: everything cleared together, to bring back.
export function previousList(items) {
  const cleared = items.filter((i) => i.cleared_at);
  if (!cleared.length) return [];
  const last = cleared.reduce((m, i) => (String(i.cleared_at) > m ? String(i.cleared_at) : m), '');
  const open = new Set(items.filter((i) => !i.cleared_at).map((i) => key(i.name)));
  const seen = new Set();
  return cleared.filter((i) => String(i.cleared_at) === last).filter((i) => {
    const k = key(i.name);
    if (open.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Already on the open list (so it is not added twice).
export function onList(items, name) {
  const k = key(name);
  return items.some((i) => !i.cleared_at && key(i.name) === k);
}

// The list as plain text, for an email or for printing.
export function listText(items) {
  return grouped(items).map((g) => g.label + ':\n' + g.items.filter((i) => !i.done).map((i) => '☐ ' + i.name + (i.qty ? ' (' + i.qty + ')' : '')).join('\n')).filter((s) => s.includes('☐')).join('\n\n');
}

// How much is left for the supermarket per week until the month ends, so
// the budget lasts: what is left divided by the weeks left (at least one).
export function perWeek(left, today = new Date()) {
  if (!(left > 0)) return 0;
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = end - today.getDate() + 1;
  return Math.floor(left / Math.max(1, daysLeft / 7));
}

// A week's basics for a household, by how many live there: [name, how many a
// week for each person, the unit, the least worth buying]. Kept short, the
// things nearly every home runs out of.
const BASICS = [
  ['חלב 3%', 1, 'ליטר', 2], ['ביצים', 3, 'ביצים', 12], ['לחם', 0.5, 'כיכרות', 1], ['קוטג׳', 0.5, 'גביעים', 1],
  ['גבינה לבנה', 0.34, 'גביעים', 1], ['יוגורט', 2, 'גביעים', 2], ['עגבניות', 0.5, 'ק״ג', 1], ['מלפפונים', 0.5, 'ק״ג', 1],
  ['בננות', 0.4, 'ק״ג', 1], ['תפוחים', 0.4, 'ק״ג', 1], ['בצל', 0.2, 'ק״ג', 1], ['תפוחי אדמה', 0.4, 'ק״ג', 1],
  ['חזה עוף', 0.35, 'ק״ג', 0.5], ['אורז', 0.15, 'ק״ג', 1], ['פסטה', 0.25, 'חבילות', 1], ['נייר טואלט', 0.25, 'חבילות', 1]
];
const UNIT_STEP = { 'ק״ג': 0.5, 'ביצים': 12 };
function amount(perPerson, people, unit, least) {
  const step = UNIT_STEP[unit] || 1;
  const n = Math.max(least, Math.ceil((perPerson * people) / step) * step);
  if (unit === 'ביצים') return n / 12 === 1 ? 'תבנית' : '×' + n / 12 + ' תבניות';
  return unit === 'ק״ג' ? n + ' ק״ג' : '×' + n;
}

// The advisor's list for the week: first what this home buys again and
// again, then the basics, each sized for the number of people; nothing that
// is already on the list. Every line says why it is there; all can be edited.
export function suggestList({ items = [], people = 2 } = {}) {
  const p = Math.max(1, Math.min(20, Math.round(Number(people) || 2)));
  const out = [];
  const seen = new Set();
  const take = (name, qty, why) => {
    const k = key(name);
    if (seen.has(k) || onList(items, name)) return;
    // "חלב" from the usual list covers "חלב 3%" from the basics, and back.
    for (const s of seen) if (s.split(' ')[0] === k.split(' ')[0]) return;
    seen.add(k);
    out.push({ name: norm(name), qty, aisle: aisleOf(name), why });
  };
  for (const name of usual(items, 10)) take(name, null, 'קונים בדרך כלל');
  for (const [name, per, unit, least] of BASICS) take(name, amount(per, p, unit, least), 'לפי ' + (p === 1 ? 'נפש אחת' : p + ' נפשות'));
  return out;
}
