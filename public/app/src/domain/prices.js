import { aisleOf } from './shopping.js';

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
// The chains' files often write the unit with the base they price by:
// "100 גרם", "1 קילוגרם", "גרם 100". The number in the unit is not the size.
export function size(qty, unitText) {
  const q = Number(String(qty ?? '').replace(',', '.'));
  const u = String(unitText || '').trim().replace(/[\d.,\s]+/g, '');
  const m = UNITS.find((x) => x.re.test(u));
  if (!m || !(q > 0)) return null;
  const out = { unit: m.unit, qty: Math.round(q * m.mul * 1000) / 1000 };
  // "1 gram" is a product sold by weight with no size, not a gram of it.
  if (out.unit === 'kg' && out.qty < 0.005) return null;
  return out;
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

// ── fresh food and look-alikes ──
// A name that says the product was made from the thing typed ("עגבניות
// מרוסקות", "בצל מטוגן", "תה בטעם אפרסק", "עוף טוב שניצל"): not what a
// person means by "עגבניות", "בצל", "תה" or "עוף" unless they typed it.
const MADE = /מרוסק|חתוכ|מקולפ|במלח|בחומץ|חמוצ|מטוגן|קפוא|מצופ|בציפוי|צ['׳]?יפס|ציפס|שוקולד|במילוי|ממולא|בטעם|פקק|נאט|מיקרו|רסק|ממרח|סלט|שניצל|נקניק|פסטרמה|צונגו|קציצ|מעושן|משומר|שימורי|מיובש|פירה|רוטב|מתוק|חטיף|עוגיות|מאפה|גלידה|נגיסי|אצבעות|פרוס|מקורמל|פריכי|קרם|קוביות|מיקס|ירוק|קצוץ|קצוצ|מוקפא|מיץ|משקה|נקטר|(^|\s)מלח(\s|$)|(^|\s)חומץ(\s|$)|(^|\s)קר(\s|$)/;
export function madeFrom(name, query) {
  const n = String(name || '').match(MADE);
  return !!n && !String(query || '').includes(n[0].trim());
}
// Fruit, vegetables, meat and fish are mostly sold by weight, under each
// chain's own codes: when no plain product matches, they are left out of the
// comparison (marked so) rather than priced as a made product.
const FRESH = new Set(['produce', 'meat']);
export const isFresh = (query) => FRESH.has(aisleOf(query)) && !MADE.test(String(query || ''));

// ── the automatic choice for one item on the list ──
// The best-matching products first; among them the cheapest (per liter or
// kilo) that the household's kashrut allows. When something matches but
// nothing is confirmed for their kashrut, the cheapest product whose kashrut
// nobody marked yet is priced, marked "unverified" for the person to check
// (one whose name speaks of a certifier they rely on comes first); a product
// known to have another kashrut is never picked. With `strict`, only
// confirmed products are picked, and the item waits for the person instead.
// `pool`: the products that may stand for this item at a chain that does not
// sell the picked one (the same kashrut standing as the pick).
export function choose(query, products, pref = 'any', { keep, strict = false } = {}) {
  const fresh = isFresh(query);
  const scored = products.map((p) => {
    const made = madeFrom(p.name, query);
    // Fruit or vegetables in liters are a drink.
    const drink = fresh && (size(p.qty, p.unit) || {}).unit === 'l';
    return { p, s: made || drink ? (fresh ? 0 : score(query, p) - 0.7) : score(query, p), b: bestPrice(p) };
  }).filter((x) => x.s > 0 && x.b);
  if (!scored.length) return { query, status: fresh && products.length ? 'fresh' : 'none', pick: null, options: [], pool: [] };
  const top = Math.max(...scored.map((x) => x.s));
  // Close matches only (a clearly worse name match is not "the same thing"),
  // and of those the ones most chains sell: what people mean by "לחם" is
  // the bread every supermarket has, not a rare one that is cheap per kilo
  // (or looks cheap because its size in the file is wrong).
  const near = scored.filter((x) => x.s >= top - 0.6);
  const sold = (x) => (x.p.offers || []).filter((o) => o.price > 0).length;
  const most = Math.max(...near.map(sold));
  const close = most >= 4 ? near.filter((x) => sold(x) >= most * 0.5) : near;
  const byPrice = (a, b) => a.b.perUnit - b.b.perUnit || a.b.price - b.b.price;
  const ok = close.filter((x) => allowed(x.p, pref)).sort(byPrice);
  const rest = near.filter((x) => !ok.includes(x));
  const options = [...ok, ...rest.filter((x) => allowed(x.p, pref)).sort(byPrice), ...rest.filter((x) => !allowed(x.p, pref)).sort(byPrice)].slice(0, 8).map((x) => x.p);
  // A choice the person made before stays, if it is still a match.
  const kept = keep && near.find((x) => x.p.barcode === keep);
  if (kept) return { query, status: 'chosen', pick: kept.p, options, pool: (ok.includes(kept) ? ok : near).map((x) => x.p) };
  if (ok.length) return { query, status: 'auto', pick: ok[0].p, options, pool: ok.map((x) => x.p) };
  const maybe = strict ? [] : close.filter((x) => unknownKashrut(x.p)).map((x) => ({ ...x, h: hintFits(x.p, pref) ? 0 : 1 })).sort((a, b) => a.h - b.h || byPrice(a, b));
  if (maybe.length) return { query, status: 'unverified', pick: maybe[0].p, options, pool: maybe.map((x) => x.p), hint: maybe[0].h === 0 };
  return { query, status: 'unsure', pick: null, options, pool: [] };
}
// Nobody said what kashrut it has (not "another kashrut", not "not kosher").
function unknownKashrut(p) {
  return !certOf(p) && !levelOf(p);
}
// The name speaks of a certifier the family relies on ("בד״ץ" in the name).
function hintFits(p, pref) {
  const c = certFromText(p.name);
  if (!c) return false;
  if (Array.isArray(pref)) return pref.includes(c);
  return rank(certLevel(c)) >= rank(pref);
}

// The whole list at once (20 items or 200): one choice per item.
export function chooseAll(items, catalog, pref = 'any', { strict = false } = {}) {
  return items.map((it) => ({ id: it.id, ...choose(it.name, catalog[it.name] || [], pref, { keep: it.barcode, strict }) }));
}

// With the family's area set: only the chains with a branch near it, at
// that branch's price (the server already put it in). A product no branch
// nearby sells keeps no price.
export function nearby(catalog, on) {
  if (!on) return catalog;
  return Object.fromEntries(Object.entries(catalog || {}).map(([n, list]) => [n, (list || []).map((p) => ({ ...p, offers: (p.offers || []).filter((o) => o.local) }))]));
}

// Another product that can stand for the picked one at a chain: the same
// kind of size, from 80% to 125% of it (a 1 liter milk for a 1 liter milk,
// not a 200 ml one). Products with no size stand only for each other. The
// price is counted for the picked size, so a bigger package is not "dearer".
export function equivalent(pick, other) {
  const a = size(pick.qty, pick.unit), b = size(other.qty, other.unit);
  if (!a && !b) return 1;
  if (!a || !b || a.unit !== b.unit) return 0;
  const r = a.qty / b.qty;
  return r >= 0.8 && r <= 1.25 ? r : 0;
}
const offerAt = (p, chain) => (p.offers || []).find((o) => o.chain === chain && o.price > 0);

// What the list costs at each chain, cheapest chain first. At a chain that
// does not sell the exact product picked, the cheapest equivalent product it
// does sell is counted (a "swap", shown as such), so a chain is not left out
// for selling milk under another barcode. Only what has nothing equivalent
// counts as missing. Each row has its lines: what to buy there and for how much.
export function basket(choices, qtyOf = () => 1) {
  const picks = choices.filter((c) => c.pick);
  const chains = new Map();
  const stores = new Map();
  for (const c of picks) for (const p of [c.pick, ...(c.pool || [])]) for (const o of p.offers || []) {
    if (o.price > 0 && !chains.has(o.chain)) chains.set(o.chain, o.chain_name || o.chain);
    if (o.store && !stores.has(o.chain)) stores.set(o.chain, o.store);
  }
  const rows = [...chains.entries()].map(([chain, name]) => {
    let total = 0, missing = 0, swaps = 0;
    const lines = [];
    for (const c of picks) {
      const q = qtyOf(c);
      const o = offerAt(c.pick, chain);
      if (o) { total += o.price * q; lines.push({ id: c.id, product: c.pick, price: o.price, swap: false }); continue; }
      let best = null;
      for (const p of c.pool || []) {
        if (p.barcode === c.pick.barcode) continue;
        const r = equivalent(c.pick, p);
        const po = r && offerAt(p, chain);
        if (po && (!best || po.price * r < best.price)) best = { product: p, price: Math.round(po.price * r * 100) / 100, paid: po.price };
      }
      if (best) { total += best.price * q; swaps++; lines.push({ id: c.id, product: best.product, price: best.paid, swap: true }); } else { missing++; lines.push({ id: c.id, product: null, price: null, swap: false }); }
    }
    return { chain, name, store: stores.get(chain) || null, total: Math.round(total * 100) / 100, missing, swaps, lines };
  });
  return rows.sort((a, b) => a.missing - b.missing || a.total - b.total);
}

// Chains that do not sell every day: shown with what to know, and when one
// of them is the cheapest, the cheapest of the always-open chains too.
export const CHAIN_NOTES = {
  'mishnat-yosef': { short: 'מכירה פעם בשבוע', text: 'משנת יוסף מוכרת במוקדי מכירה פעם בשבוע, ולא בחנות שפתוחה כל יום. המחיר הוא של יום המכירה.', url: null }
};
export const chainNote = (chain) => CHAIN_NOTES[chain] || null;
// The cheapest chain that is open every day, when the cheapest is not.
export function bestAlways(rows) {
  if (!rows.length || !chainNote(rows[0].chain)) return null;
  return rows.find((r) => !chainNote(r.chain) && r.missing === rows[0].missing) || rows.find((r) => !chainNote(r.chain)) || null;
}

// What the cheapest chain saves against the dearest of the chains that have
// everything (or the same number missing): the saving in shekels, 0 when
// there is nothing to compare.
export function saving(rows) {
  const full = rows.filter((r) => r.missing === (rows[0] ? rows[0].missing : 0));
  if (full.length < 2) return 0;
  return Math.round((full[full.length - 1].total - full[0].total) * 100) / 100;
}

// How many units a list line asks for ("×2" → 2, "2 ק"ג" → 1 package).
export function count(qtyText) {
  const m = /^×(\d+)$/.exec(String(qtyText || '').trim());
  return m ? Math.min(99, Number(m[1])) : 1;
}
