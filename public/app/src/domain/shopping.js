// The shopping list: what to buy, sorted by where it is in the store,
// remembered from one shopping to the next. Pure.

// The store's departments, in the order most stores are walked.
export const AISLES = [
  { key: 'produce', label: 'ירקות ופירות', words: ['עגבני', 'מלפפון', 'בצל', 'שום', 'תפוח', 'תפוז', 'בננ', 'גזר', 'פלפל', 'חסה', 'כרוב', 'קישוא', 'חציל', 'לימון', 'אבוקדו', 'ענב', 'אגס', 'אפרסק', 'תות', 'פטרוזיליה', 'כוסברה', 'שמיר', 'נענע', 'פטריות', 'בטטה', 'דלעת', 'סלק', 'צנון', 'קלמנטינ', 'אבטיח', 'מלון', 'ירקות', 'פירות', 'תפוא', 'תפו"א', 'תפוחי אדמה'] },
  { key: 'bakery', label: 'מאפים', words: ['לחם', 'לחמני', 'פית', 'חלה', 'חלות', 'בגט', 'עוגה', 'עוגיות', 'קרואסון', 'מאפ', 'טורטי'] },
  { key: 'dairy', label: 'מוצרי חלב', words: ['חלב', 'גבינ', 'קוטג', 'יוגורט', 'שמנת', 'חמאה', 'לבן', 'לבנה', 'מעדן', 'ביצ', 'אשל', 'גיל', 'שוקו', 'פודינג'] },
  { key: 'meat', label: 'בשר, עוף ודגים', words: ['עוף', 'בשר', 'שניצל', 'כרעיים', 'חזה', 'טחון', 'דג', 'סלמון', 'טונה', 'נקניק', 'פרגית', 'הודו', 'כבד', 'קציצ'] },
  { key: 'dry', label: 'יבשים ומזווה', words: ['אורז', 'פסטה', 'ספגטי', 'קמח', 'סוכר', 'מלח', 'שמן', 'קטני', 'עדשים', 'חומוס', 'שעועית', 'קוסקוס', 'פתיתים', 'קורנפלקס', 'דגני', 'שיבולת', 'תבלין', 'פפריקה', 'כמון', 'רסק', 'קפה', 'תה', 'דבש', 'ריבה', 'ממרח', 'טחינה', 'שוקולד', 'במבה', 'ביסלי', 'חטיף', 'אגוז', 'שקדים', 'צימוק', 'שימורים', 'תירס', 'זיתים', 'מלפפון חמוץ', 'קטשופ', 'מיונז', 'חרדל', 'רוטב', 'אבקת מרק'] },
  { key: 'frozen', label: 'קפואים', words: ['קפוא', 'גלידה', 'בורקס', 'אפונה', 'ירקות קפואים', 'פיצה'] },
  { key: 'drinks', label: 'משקאות', words: ['מים', 'סודה', 'מיץ', 'קולה', 'תפוזים', 'בירה', 'יין', 'משקה', 'פטל'] },
  { key: 'clean', label: 'ניקיון', words: ['כביסה', 'מרכך', 'אקונומיקה', 'סבון כלים', 'נוזל כלים', 'ספוג', 'שקיות', 'נייר טואלט', 'מגבות נייר', 'נייר', 'אלומיניום', 'ניילון', 'מטהר', 'מנקה', 'סנו', 'כלים חד'] },
  { key: 'care', label: 'היגיינה ופארם', words: ['שמפו', 'סבון', 'מברשת', 'משחת שיניים', 'דאודורנט', 'תחבושות', 'צמר גפן', 'קרם', 'גילוח', 'מרכך שיער'] },
  { key: 'baby', label: 'תינוקות', words: ['חיתול', 'מגבונים', 'מטרנה', 'סימילאק', 'דייסה', 'מוצץ'] },
  { key: 'other', label: 'אחר', words: [] }
];
const AISLE_ORDER = AISLES.map((a) => a.key);

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const key = (s) => norm(s).toLowerCase().replace(/["'׳״]/g, '');

// Which department an item belongs to. A longer match wins ("סבון כלים" is
// cleaning, "סבון" is hygiene).
export function aisleOf(name) {
  const n = key(name);
  let best = { key: 'other', len: 0 };
  for (const a of AISLES) {
    for (const w of a.words) {
      const k = key(w);
      if (k.length > best.len && n.includes(k)) best = { key: a.key, len: k.length };
    }
  }
  return best.key;
}

const WORDS = { 'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'עשר': 10, 'עשרה': 10 };
const UNITS = ['ק"ג', 'קג', 'קילו', 'גרם', 'ליטר', 'ל\'', 'יח\'', 'יחידות', 'חבילות', 'חבילה', 'בקבוקים', 'בקבוק', 'תבניות', 'תבנית', 'שקיות', 'שקית', 'קופסאות', 'קופסה', 'מגשים', 'מגש'];

// One item from a few typed words: "2 ביצים", "ביצים x2", "שתי תבניות ביצים",
// "1 ק"ג עגבניות" -> { name, qty }.
export function parseItem(text) {
  let t = norm(text).replace(/^(ו|גם)\s*/, '');
  if (!t) return null;
  let qty = null;
  let m = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(t);
  if (m && m[2]) { qty = m[1]; t = m[2]; }
  else {
    m = /^(.*?)\s*[x×*]\s*(\d+)$/.exec(t) || /^(.*?)\s+(\d+)$/.exec(t);
    if (m && m[1]) { qty = m[2]; t = m[1]; }
    else {
      const w = t.split(' ');
      if (WORDS[w[0]] && w.length > 1) { qty = String(WORDS[w[0]]); t = w.slice(1).join(' '); }
    }
  }
  const unit = UNITS.find((u) => t.startsWith(u + ' '));
  if (unit) { qty = (qty || '1') + ' ' + unit.replace('קג', 'ק"ג').replace('קילו', 'ק"ג'); t = t.slice(unit.length + 1); }
  else if (qty) qty = '×' + qty;
  t = norm(t);
  return t ? { name: t.slice(0, 80), qty: qty ? qty.slice(0, 20) : null } : null;
}

// Several items in one line: "חלב, 2 ביצים ולחם".
export function parseItems(text) {
  return String(text || '')
    .split(/[,\n،;]|\s+ו(?=[א-ת]{2,})|\s+וגם\s+/)
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
