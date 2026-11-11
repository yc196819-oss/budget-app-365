// Supermarket prices: from what a person typed ("חלב 3%") to one exact
// product (by barcode), chosen automatically as the cheapest one at the
// household's kashrut level, and what the whole list costs at each chain.
// Pure: the products come from the server's catalog.

// Kashrut levels, from none to the strictest. A product's level comes from
// families who confirmed it (and the owner), never from a guess.
export const LEVELS = ['none', 'regular', 'mehadrin'];
export const LEVEL_NAMES = { none: 'לא כשר', regular: 'כשר', mehadrin: 'כשר למהדרין' };
export const PREFS = [
  { key: 'mehadrin', label: 'מהדרין', note: 'רק מוצרים שאושרו כמהדרין (בד"ץ, מהדרין)' },
  { key: 'regular', label: 'כשר', note: 'כל מוצר שאושר ככשר' },
  { key: 'any', label: 'בלי העדפה', note: 'הכי זול, בלי קשר לכשרות' }
];
const rank = (level) => LEVELS.indexOf(level);

// Words in a product name that hint at kashrut. Only a hint, shown to the
// person; it never decides for them.
const HINTS = [
  { re: /בד"?ץ|בד״ץ|מהדרין|מהדר|חלק|בית יוסף|לנדא|רובין|עדה החרדית/, level: 'mehadrin' },
  { re: /כשר|רבנות/, level: 'regular' }
];
export function kosherHint(name) {
  const n = String(name || '');
  const h = HINTS.find((x) => x.re.test(n));
  return h ? h.level : null;
}

// ── which kashrut exactly: the certifier written on the package ──
// A family picks the certifiers it relies on; a product's certifier comes
// from the owner, from families who marked what the package says, or from
// the open product database. The most specific names are first, so
// "רבנות ... מהדרין" is not read as plain "רבנות".
export const NOT_KOSHER = 'לא כשר';
export const CERTS = [
  { name: 'בד"ץ העדה החרדית', level: 'mehadrin', re: /עדה\s*החרדית|העדה החרדית|badatz.?eda|edah/i },
  { name: 'בד"ץ בית יוסף', level: 'mehadrin', re: /בית\s*יוסף|beit.?yosef/i },
  { name: 'הרב לנדא', level: 'mehadrin', re: /לנדא|landau|landa\b/i },
  { name: 'בד"ץ חתם סופר', level: 'mehadrin', re: /חתם\s*סופר|chatam.?sofer/i },
  { name: 'בד"ץ בעלז', level: 'mehadrin', re: /בעלז|belz/i },
  { name: 'הרב רובין', level: 'mehadrin', re: /רובין|rubin/i },
  { name: 'שארית ישראל', level: 'mehadrin', re: /שארית\s*ישראל|sheerit/i },
  { name: 'בד"ץ אגודת ישראל', level: 'mehadrin', re: /אגודת\s*ישראל|agudat/i },
  { name: 'בד"ץ יורה דעה', level: 'mehadrin', re: /יורה\s*דעה|מחפוד|yoreh.?deah|machpud/i },
  { name: 'רבנות מהדרין', level: 'mehadrin', re: /רבנות.{0,30}מהדרין|מהדרין.{0,30}רבנות|rabbanut.{0,20}mehadrin|mehadrin.{0,20}rabbanut/i },
  { name: 'רבנות', level: 'regular', re: /רבנות|rabbanut|rabbinate/i }
];
const CERT_NAMES = new Set(CERTS.map((c) => c.name));
export const isCert = (name) => CERT_NAMES.has(name) || name === NOT_KOSHER;
export const certLevel = (name) => (name === NOT_KOSHER ? 'none' : (CERTS.find((c) => c.name === name) || { level: 'mehadrin' }).level);
// The certifier a text speaks of (a package label, a product name), if any.
export function certFromText(text) {
  const t = String(text || '');
  const c = CERTS.find((x) => x.re.test(t));
  return c ? c.name : null;
}
// Products that are not food need no kashrut (cleaning, hygiene).
const NONFOOD = /שמפו|מרכך שיער|סבון|אקונומיקה|נוזל כלים|אבקת כביסה|ג'?ל כביסה|מרכך כביסה|ספוג|נייר טואלט|מגבונים|טישו|חיתול|מברשת שיניים|דאודורנט|קרם גוף|קרם ידיים|שקיות אשפה|נייר אפייה|נייר כסף|מטהר אוויר|מסקרה|ליפסטיק|תחבושות|סכיני גילוח|ניקוי|מנקה|כלים חד/;
export const nonFood = (product) => NONFOOD.test(String((product && product.name) || ''));
// The product's certifier and who said so: the owner first, then what most
// families marked (at least one), then the open product database.
export function certOf(product) {
  const k = (product && product.kosher) || {};
  if (k.owner_cert && isCert(k.owner_cert)) return { cert: k.owner_cert, by: 'owner', n: 0 };
  const certs = k.certs || {};
  let top = null;
  for (const [c, n] of Object.entries(certs)) if (isCert(c) && n > 0 && (!top || n > certs[top])) top = c;
  if (top) return { cert: top, by: 'families', n: certs[top] };
  if (k.open && isCert(k.open)) return { cert: k.open, by: 'open', n: 0 };
  return null;
}

// ── sizes: "1 ליטר", "1000 מיליליטר", "500 גרם" → one unit to compare by ──
const UNITS = [
  { re: /^(מיליליטר|מ"?ל|מ״ל|מל|ml)$/i, unit: 'l', mul: 0.001 },
  { re: /^(ליטר|ליטרים|ל'?|ל׳|lt?r?)$/i, unit: 'l', mul: 1 },
  { re: /^(גרם|גר'?|ג'?|גר׳|g|gr)$/i, unit: 'kg', mul: 0.001 },
  { re: /^(קילוגרם|קילו|ק"?ג|ק״ג|kg)$/i, unit: 'kg', mul: 1 },
  { re: /^(יחידה|יחידות|יח'?|יח׳|unit)$/i, unit: 'unit', mul: 1 }
];
export function size(qty, unitText) {
  const q = Number(String(qty ?? '').replace(',', '.'));
  const u = String(unitText || '').trim().replace(/\s+/g, '');
  const m = UNITS.find((x) => x.re.test(u));
  if (!m || !(q > 0)) return null;
  return { unit: m.unit, qty: Math.round(q * m.mul * 1000) / 1000 };
}
export function sizeText(s) {
  if (!s) return '';
  if (s.unit === 'l') return s.qty < 1 ? Math.round(s.qty * 1000) + ' מ"ל' : s.qty + ' ליטר';
  if (s.unit === 'kg') return s.qty < 1 ? Math.round(s.qty * 1000) + ' גרם' : s.qty + ' ק"ג';
  return s.qty > 1 ? s.qty + ' יחידות' : '';
}

// ── matching what was typed to product names ──
const clean = (s) => String(s || '').toLowerCase().replace(/[״"׳'`,.()\-+/\\*]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['של', 'עם', 'בטעם', 'את', 'ה']);
export function words(s) {
  return clean(s).split(' ').filter((w) => w && !STOP.has(w));
}
// A typed word is found in a name if a name word starts with it, or with it
// after one Hebrew prefix letter ("החלב", "וחלב").
function hit(w, nameWords) {
  return nameWords.some((n) => n === w || n.startsWith(w) || (n.length > 2 && 'הובלמש'.includes(n[0]) && n.slice(1).startsWith(w)));
}
// How well a product matches: 0 when a typed word is missing; more when the
// name starts with the first typed word ("חלב 3%" is milk, not chocolate milk).
export function score(query, product) {
  const q = words(query);
  if (!q.length) return 0;
  const names = [product.name, ...(product.names || [])].filter(Boolean);
  let best = 0;
  for (const name of names) {
    const nw = words(name);
    if (!q.every((w) => hit(w, nw))) continue;
    let s = 1;
    if (nw[0] && (nw[0] === q[0] || nw[0].startsWith(q[0]))) s += 1;
    s += Math.max(0, 0.5 - (nw.length - q.length) * 0.05);
    best = Math.max(best, s);
  }
  return best;
}

// ── a product's prices and kashrut ──
// The cheapest price of a product at any chain, and per unit of size.
export function bestPrice(product) {
  const offers = (product.offers || []).filter((o) => o.price > 0);
  if (!offers.length) return null;
  const o = offers.reduce((a, b) => (b.price < a.price ? b : a));
  const s = size(product.qty, product.unit);
  return { price: o.price, chain: o.chain, chainName: o.chain_name || o.chain, perUnit: s && s.unit !== 'unit' ? o.price / s.qty : o.price / ((s && s.qty) || 1) };
}
// The confirmed level: the owner's word if given, otherwise what most
// families said (at least one). Nothing confirmed: null.
export function levelOf(product) {
  const k = product.kosher || {};
  if (k.owner && LEVELS.includes(k.owner)) return { level: k.owner, by: 'owner', votes: k.votes || {} };
  const votes = k.votes || {};
  let top = null;
  for (const l of LEVELS) if ((votes[l] || 0) > 0 && (!top || votes[l] > votes[top] || (votes[l] === votes[top] && rank(l) < rank(top)))) top = l;
  return top ? { level: top, by: 'families', votes } : null;
}
// Allowed for this household's preference: only a confirmed level counts.
// A household's preference is either a list of certifiers it relies on, or
// (from before) a level.
export function allowed(product, pref) {
  if (!pref || pref === 'any') return true;
  if (Array.isArray(pref)) {
    if (!pref.length) return true;
    if (nonFood(product)) return true;
    const c = certOf(product);
    return !!c && c.cert !== NOT_KOSHER && pref.includes(c.cert);
  }
  const l = levelOf(product);
  return !!l && rank(l.level) >= rank(pref);
}

// ── the automatic choice for one item on the list ──
// The best-matching products first; among them the cheapest (per liter or
// kilo) that the household's kashrut allows. When something matches but
// nothing is confirmed for their level, the item is marked "unsure" for the
// person to choose, instead of guessing.
export function choose(query, products, pref = 'any', { keep } = {}) {
  const scored = products.map((p) => ({ p, s: score(query, p), b: bestPrice(p) })).filter((x) => x.s > 0 && x.b);
  if (!scored.length) return { query, status: 'none', pick: null, options: [] };
  const top = Math.max(...scored.map((x) => x.s));
  // Close matches only (a clearly worse name match is not "the same thing").
  const close = scored.filter((x) => x.s >= top - 0.6);
  const byPrice = (a, b) => a.b.perUnit - b.b.perUnit || a.b.price - b.b.price;
  const ok = close.filter((x) => allowed(x.p, pref)).sort(byPrice);
  const options = [...ok, ...close.filter((x) => !ok.includes(x)).sort(byPrice)].slice(0, 8).map((x) => x.p);
  // A choice the person made before stays, if it is still a match.
  const kept = keep && close.find((x) => x.p.barcode === keep);
  if (kept) return { query, status: 'chosen', pick: kept.p, options };
  if (!ok.length) return { query, status: 'unsure', pick: null, options };
  return { query, status: 'auto', pick: ok[0].p, options };
}

// The whole list at once (20 items or 200): one choice per item.
export function chooseAll(items, catalog, pref = 'any') {
  return items.map((it) => ({ id: it.id, ...choose(it.name, catalog[it.name] || [], pref, { keep: it.barcode }) }));
}

// With the family's area set: only the chains with a branch near it, at
// that branch's price (the server already put it in). A product no branch
// nearby sells keeps no price.
export function nearby(catalog, on) {
  if (!on) return catalog;
  return Object.fromEntries(Object.entries(catalog || {}).map(([n, list]) => [n, (list || []).map((p) => ({ ...p, offers: (p.offers || []).filter((o) => o.local) }))]));
}

// What the chosen products cost at each chain, cheapest chain first, with
// how many of them the chain does not have, and the branch when known.
export function basket(choices, qtyOf = () => 1) {
  const picks = choices.filter((c) => c.pick);
  const chains = new Map();
  const stores = new Map();
  for (const c of picks) for (const o of c.pick.offers || []) {
    if (o.price > 0 && !chains.has(o.chain)) chains.set(o.chain, o.chain_name || o.chain);
    if (o.store && !stores.has(o.chain)) stores.set(o.chain, o.store);
  }
  const rows = [...chains.entries()].map(([chain, name]) => {
    let total = 0, missing = 0;
    for (const c of picks) {
      const o = (c.pick.offers || []).find((x) => x.chain === chain && x.price > 0);
      if (o) total += o.price * qtyOf(c); else missing++;
    }
    return { chain, name, store: stores.get(chain) || null, total: Math.round(total * 100) / 100, missing };
  });
  return rows.sort((a, b) => a.missing - b.missing || a.total - b.total);
}

// How many units a list line asks for ("×2" → 2, "2 ק"ג" → 1 package).
export function count(qtyText) {
  const m = /^×(\d+)$/.exec(String(qtyText || '').trim());
  return m ? Math.min(99, Number(m[1])) : 1;
}
