// Fresh food as people count it and as the chains sell it.
//
// A recipe says "4 עגבניות" or "1 שום"; the chains sell tomatoes by the kilo
// and garlic by the head or by the kilo. To price "4 tomatoes" the count has
// to become a weight first, or a kilo price is paid four times.
// Each entry: [the start of the name, grams in one (a tomato, a head of
// garlic, a bunch of parsley), the most a kilo of it costs in Israel].
// The ceiling is generous (a dear month, a small shop); a price above it is a
// product mislabeled or the wrong product, never a fair price for the thing.
// Pure, no data of anyone's.

const TABLE = [
  // vegetables
  ['עגבניות שרי|עגבניה שרי|עגבנית שרי', 15, 45], ['עגבניה|עגבנית|עגבניות', 150, 30],
  ['מלפפון בייבי', 500, 25, false, 'מלפפון'], ['מלפפון', 120, 25], ['בצל ירוק', 100, 80], ['בצל שאלוט', 30, 60], ['בצל פנינה|בצלי פנינה', 15, 60], ['בצל', 150, 25],
  ['שיני שום|שן שום', 5, 80, false, 'שום'], ['שום', 50, 80],
  ['פלפל חריף יבש|צ\'ילי יבש', 3, 400, true], ['פלפל חריף|צ\'ילי|פלפל צילי', 20, 80], ['פלפל', 200, 40],
  ['גזר', 100, 20], ['תפוחי אדמה|תפוח אדמה|תפו"א|תפוא', 200, 20],
  ['בטטה', 300, 25], ['חצילונים|חצילון', 500, 30, false, 'חציל'], ['חציל', 350, 25], ['קישוא', 200, 30], ['חסה', 400, 40], ['כרובית', 800, 30], ['כרוב', 1200, 20],
  ['ברוקולי', 350, 45], ['סלק עלים|עלי סלק|מנגולד', 300, 40], ['סלק', 150, 25], ['צנון', 100, 25], ['קולרבי', 250, 25], ['דלעת', 1000, 25], ['שומר', 250, 30],
  ['סלרי', 400, 30], ['לוביה', 10, 45], ['שעועית ירוקה', 10, 45], ['פטריות|פטריה', 15, 70], ['ג\'ינג\'ר|גינגר', 50, 70],
  ['תירס', 300, 30], ['ארטישוק', 300, 40], ['במיה', 15, 50], ['אפונה', 5, 50],
  // herbs: a bunch
  ['פטרוזיליה', 100, 70, 'bunch'], ['כוסברה', 100, 70, 'bunch'], ['שמיר', 100, 70, 'bunch'], ['נענע', 100, 70, 'bunch'], ['בזיליקום', 50, 150, 'bunch'],
  ['רוזמרין', 30, 150, 'bunch'], ['טימין', 30, 150, 'bunch'], ['תרד', 300, 50], ['רוקט', 100, 100],
  // fruit
  ['לימון', 120, 30], ['ליים', 80, 40], ['תפוז', 200, 25], ['קלמנטינה', 90, 25], ['אשכולית', 350, 25], ['תפוח', 180, 30],
  ['בננה', 150, 25], ['אבוקדו', 220, 45], ['אגס', 180, 35], ['אפרסק', 150, 35], ['נקטרינה', 150, 35], ['שזיף', 70, 35],
  ['מנגו', 350, 45], ['רימון', 300, 35], ['ענבים', 500, 45], ['תות', 15, 80], ['אבטיח', 5000, 12], ['מלון', 1500, 20],
  ['קיווי', 90, 40], ['תמר', 20, 80], ['אננס', 1500, 35],
  // fish and meat, a piece as recipes count it
  ['פילה מושט|פילה אמנון|פילה סלמון|פילה דניס|פילה לברק|פילה בורי|פילה מוסר|פילה הרינג|פילה', 150, 180], ['סלמון', 150, 180], ['מושט|אמנון|דניס|לברק|בורי', 400, 120], ['דג', 400, 150],
  ['חזה עוף|חזה', 250, 70], ['שוקיים|שוק עוף', 150, 50], ['כרעיים|כרע', 300, 45],
  ['פרגית', 120, 70], ['כנפיים|כנף', 80, 45], ['עוף שלם', 1800, 40], ['עוף', 1800, 70], ['סטייק|אנטריקוט', 300, 250],
  ['בשר טחון', 500, 90], ['קציצות|קציצה', 60, 90], ['נקניקיות|נקניקיה', 50, 80]
];
// (Hebrew letters at the end of a word written plainly, so "פלפלים" and
// "פלפל" start the same.)
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export const plainLetters = (s) => String(s || '').replace(/[ךםןףץ]/g, (c) => FINALS[c]);
const cleanName = (s) => String(s || '').toLowerCase().replace(/[״"׳'`]/g, '').replace(/[,.()\-+/\\*]/g, ' ').replace(/\s+/g, ' ').trim();
// What fresh food is called in a recipe and in a shop differ: the plural
// ("עגבניות", "פלפלים") and adjectives in the plural ("אדומים", "יבשים").
// Each word's base, so both are found: "עגבני", "פלפל", "אדום".
const FILLER = /^(מתוק|מתוקה|מתוקים|טרי|טריים|טרייה|טריה|טריות|גדול|גדולה|גדולים|גדולות|קטן|קטנה|קטנים|קטנות|בינוני|בינונית|בינוניים|בינוניות|שלם|שלמה|שלמים|שלמות|בשל|בשלה|בשלים|בשלות)$/;
const TO_FINAL = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
function base(w) {
  if (w.length < 4) return w;
  let b = w;
  if (/ייה$/.test(b)) b = b.slice(0, -2);
  else if (/יה$/.test(b) && b.length > 4) b = b.slice(0, -1);
  else if (/יות$/.test(b)) b = b.slice(0, -2);
  else if (/(ים|ות)$/.test(b) && b.length > 4) b = b.slice(0, -2);
  // (The last letter in its end form again: "אדומ" is "אדום".)
  return b.slice(0, -1) + (TO_FINAL[b.slice(-1)] || b.slice(-1));
}
// Each name as the bases of its words ("פלפלים אדומים" → פלפל, אדומ), so
// an entry is found whatever the order and number of the words.
const stems = (s) => cleanName(s).split(' ').filter(Boolean).map((w) => plainLetters(base(w)));
// (`food`: another entry's first name when it is the same food counted
// otherwise: a clove of garlic is garlic.)
const FIRST = TABLE.map(([names]) => names.split('|')[0]);
// (`sold`: true for a pack that serves any recipe, 'bunch' for what is sold
// by the bunch, whatever a file says of its price per kilo.)
const ROWS = TABLE.map(([names, g, max, sold, food], i) => ({ group: food ? FIRST.indexOf(food) : i, g, max, pack: sold === true, bunch: sold === 'bunch', alts: names.split('|').map(stems) }));
const has = (ws, alt) => alt.every((a) => ws.some((w) => w.startsWith(a)));
const ORDER = ROWS.flatMap((r) => r.alts.map((alt) => ({ r, alt }))).sort((a, b) => b.alt.length - a.alt.length || b.alt.join('').length - a.alt.join('').length);

// The entry for a name ("עגבניות" → tomatoes, "פילה מושט 7-9" → a fillet),
// or null for anything that is not fresh food we know. Two names with the
// same `group` are the same food ("עגבניה מגי" is "עגבניות"; "תפוח אדמה"
// is not "תפוחים").
export function produceOf(name) {
  const ws = stems(name);
  if (!ws.length) return null;
  const hit = ORDER.find((x) => has(ws, x.alt));
  return hit ? hit.r : null;
}
export const pieceGrams = (name) => { const r = produceOf(name); return r ? r.g : null; };
// The most a kilo of it may cost, or null.
export const maxPerKg = (name) => { const r = produceOf(name); return r ? r.max : null; };

export function freshTerm(term) {
  const ws = String(term || '').split(' ').filter(Boolean);
  let keep = ws.filter((w) => !FILLER.test(w));
  // "פילה דג מושט": the chains write "פילה מושט", "דג מושט" or just "מושט".
  if (keep.length > 1) keep = keep.filter((w) => w !== 'דג' && w !== 'דגי');
  if (!keep.length) keep = ws;
  return keep.map(base).join(' ');
}
