// The chains' own shops: where to order, how to search a product on their
// site, what delivery costs and the smallest order. Checked by hand on the
// chains' public pages (17.11.2026, no account, nothing ordered). What was
// not found is null, never guessed; where a chain's own pages disagree, the
// fee is "about" (sure: false) and the note says so. Pure.
//
//   order:  the chain's ordering site.
//   search: a product search on it ({q} is the product's name, encoded).
//   fee:    delivery, when the chain states one amount; null when it depends
//           on the address or was not found (then about ₪35.90 is counted).
//   sure:   the fee is the chain's own stated one, with nothing against it.
//   min:    the smallest order, when stated.
//   paste:  a page where a whole list is pasted (the shop matches products).
//   note:   what else to know, in a few words.

export const GUESS_FEE = 35.9;

export const SHOPS = {
  'rami-levy': { order: 'https://www.rami-levy.co.il/he', search: 'https://www.rami-levy.co.il/he/online/search?q={q}', fee: 35.9, sure: true, min: null },
  shufersal: { order: 'https://www.shufersal.co.il/online/he/A', search: 'https://www.shufersal.co.il/online/he/search?text={q}', fee: 35.9, sure: true, min: null },
  victory: { order: 'https://www.victoryonline.co.il/', search: 'https://www.victoryonline.co.il/search?q={q}', fee: null, sure: false, min: null },
  'tiv-taam': { order: 'https://www.tivtaam.co.il/', search: 'https://www.tivtaam.co.il/search/{q}', fee: null, sure: false, min: null },
  carrefour: { order: 'https://www.carrefour.co.il/', search: 'https://www.carrefour.co.il/search/{q}', fee: 35.9, sure: true, min: 200 },
  'super-yuda': { order: 'https://www.yuda.co.il/', search: 'https://www.yuda.co.il/search/{q}', fee: 35, sure: false, min: 200, note: 'באתר מופיעים גם 35 ₪ וגם 45 ₪ למשלוח' },
  'hazi-hinam': { order: 'https://shop.hazi-hinam.co.il/', search: 'https://shop.hazi-hinam.co.il/searchResults/{q}', fee: 35.9, sure: true, min: 500, paste: 'https://shop.hazi-hinam.co.il/quickbuy/editor' },
  'machsanei-hashuk': { order: 'https://www.mck.co.il/', search: 'https://www.mck.co.il/search/{q}', fee: 38.9, sure: true, min: null },
  'shuk-hair': { order: 'https://www.shukcity.co.il/', search: 'https://www.shukcity.co.il/search/{q}', fee: null, sure: false, min: 250, note: 'המשלוח לפי הכתובת והשעה' },
  'super-sapir': { order: 'https://www.supersapir.co.il/', search: 'https://www.supersapir.co.il/search/{q}', fee: null, sure: false, min: 200, note: 'המשלוח לפי האזור והשעה' },
  politzer: { order: 'https://www.politzer-c.co.il/', search: 'https://www.politzer-c.co.il/search/{q}', fee: null, sure: false, min: 150, note: 'המשלוח לפי האזור והשעה' },
  keshet: { order: 'https://www.keshet-teamim.co.il/', search: 'https://www.keshet-teamim.co.il/search/{q}', fee: 35.9, sure: false, min: 350, note: 'באתר מופיעים גם 35.90 ₪ וגם 29.90 ₪ למשלוח' },
  'fresh-market': { order: 'https://www.freshmarket.co.il/', search: 'https://www.freshmarket.co.il/search/{q}', fee: 34, sure: true, min: 200, note: 'נבדק אתר אחד של הרשת (ראשון לציון)' },
  yochananof: { order: 'https://www.yochananof.co.il/', search: null, fee: 15, sure: true, min: 250, pickup: true, note: 'הזמנה לאיסוף מהסניף, לא משלוח' },
  'king-store': { order: null, search: null, fee: null, sure: false, min: null }
};

// The chain behind an online shop ("rami-levy-online" is Rami Levy's).
export const shopKey = (chain) => String(chain || '').replace(/-online$/, '');
export const shopOf = (chain) => SHOPS[shopKey(chain)] || null;

// What delivery adds to a list of `subtotal` at an online shop:
//   { fee, sure, min, under: below the smallest order, note }.
// A fee we do not know is counted as about ₪35.90 (sure: false).
export function deliveryFor(chain, subtotal = 0) {
  const s = shopOf(chain);
  const fee = s && s.fee != null ? s.fee : GUESS_FEE;
  const sure = !!(s && s.fee != null && s.sure);
  const min = s && s.min ? s.min : null;
  return { fee, sure, min, under: !!(min && subtotal > 0 && subtotal < min), note: (s && s.note) || null };
}

// A link to search one product on the chain's site (null when the chain has
// no search we checked).
export function searchLink(chain, name) {
  const s = shopOf(chain);
  const q = String(name || '').trim();
  return s && s.search && q ? s.search.replace('{q}', encodeURIComponent(q)) : null;
}
export const orderLink = (chain) => { const s = shopOf(chain); return (s && s.order) || null; };
export const pasteLink = (chain) => { const s = shopOf(chain); return (s && s.paste) || null; };

// The list as the shops take it pasted: one product a line, with how many.
export function pasteText(items) {
  return (items || []).filter((i) => i && !i.done && !i.cleared_at && String(i.name || '').trim())
    .map((i) => String(i.name).trim() + (i.qty ? ' ' + String(i.qty).trim() : '')).join('\n');
}

// The chains whose logo is kept in the app (public/app/assets/chains/<key>.png),
// downloaded once from each chain's own site, trimmed and resized. A chain not
// here keeps its letter (some chains' sites refuse a download).
export const LOGOS = ['bareket', 'carrefour', 'city-market', 'fresh-market', 'good-pharm', 'hazi-hinam', 'keshet', 'maayan-2000',
  'machsanei-hashuk', 'mishnat-yosef', 'politzer', 'salach-dabach', 'shuk-hair', 'stop-market', 'super-sapir', 'super-yuda',
  'tiv-taam', 'victory', 'yellow'];
// A white logo, shown on a dark tile.
export const DARK_LOGOS = ['city-market'];
// The logo's file in the app, or null (the chain keeps its letter).
// (Two old names of the same chains in the price files.)
const SAME = { 'shefa-birkat': 'shefa-birkat-hashem', 'shuk-hayir': 'shuk-hair' };
export function logoKey(chain) {
  const k = shopKey(chain);
  const key = SAME[k] || k;
  return LOGOS.includes(key) ? key : null;
}
export const logoSrc = (chain) => { const k = logoKey(chain); return k ? '/app/assets/chains/' + k + '.png' : null; };
export const logoDark = (chain) => DARK_LOGOS.includes(logoKey(chain));
