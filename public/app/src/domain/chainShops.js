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

// The chains whose logo the server keeps (served from /api/chain-logo/<key>):
// the image file on each chain's own site, checked by hand. A chain not here
// keeps its letter.
export const LOGOS = {
  'rami-levy': 'https://www.rami-levy.co.il/images/new_logo.png',
  shufersal: 'https://www.shufersal.co.il/online/medias/sys_master/root/h18/hc4/11095082172446/logo-online.png',
  'osher-ad': 'https://osherad.co.il/wp-content/uploads/2022/05/logo_osherad.svg',
  yochananof: 'https://www.yochananof.co.il/pwa/ios/512.png',
  victory: 'https://d2yk3mljcbz59g.cloudfront.net/media/2026/07/0f6965cf-b3ea-4c96-b503-19ee407daa1c.svg',
  'tiv-taam': 'https://d226b0iufwcjmj.cloudfront.net/retailers/1062/logo/1722333933467.png',
  carrefour: 'https://d226b0iufwcjmj.cloudfront.net/retailers/1540/logo/1774438836316.png',
  'super-yuda': 'https://d226b0iufwcjmj.cloudfront.net/retailers/1492/logo/1701077319899.png',
  'hazi-hinam': 'https://cdn.hazi-hinam.co.il/app/V_1.3029/assets/images/header_logo.svg',
  'machsanei-hashuk': 'https://d226b0iufwcjmj.cloudfront.net/retailers/1107/logo.png',
  'shuk-hair': 'https://d226b0iufwcjmj.cloudfront.net/retailers/1254/logo.png',
  'super-sapir': 'https://d226b0iufwcjmj.cloudfront.net/retailers/1339/logo/1719137685691.png',
  'stop-market': 'https://www.stopmarket.co.il/wp-content/uploads/2021/06/logo3.d110a0.webp',
  politzer: 'https://d226b0iufwcjmj.cloudfront.net/retailers/1450/logo.png',
  'salach-dabach': 'https://sdabach.co.il/wp-content/uploads/2024/09/Untitled-2.png',
  keshet: 'https://d226b0iufwcjmj.cloudfront.net/retailers/1219/logo/1723367587440.png',
  'fresh-market': 'https://d226b0iufwcjmj.cloudfront.net/retailers/1522/logo/1704358979286.png',
  'good-pharm': 'https://goodpharm.co.il/wp-content/uploads/2018/08/GOOD@1.5x.png',
  bareket: 'https://super-bareket.co.il/wp-content/uploads/2015/03/logo.png',
  'mishnat-yosef': 'https://mishnatyosef.org/assets/logo-lg-a1d09199.svg',
  'shefa-birkat-hashem': 'https://shefa-bh.co.il/wp-content/uploads/2025/07/%D7%9C%D7%95%D7%92%D7%95-%D7%A9%D7%A4%D7%A2.svg',
  'maayan-2000': 'https://branches.m2000.co.il/images/mLogo.png',
  yellow: 'https://app.yellow.co.il/media/1061/yellow_logo222x62.png',
  'city-market': 'https://city-market.co.il/wp-content/uploads/2026/06/Mask-group.png'
};
// The logo's address on our server, or null (the chain keeps its letter).
// (Two old names of the same chains in the price files.)
const SAME = { 'shefa-birkat': 'shefa-birkat-hashem', 'shuk-hayir': 'shuk-hair' };
export function logoKey(chain) {
  const k = shopKey(chain);
  const key = SAME[k] || k;
  return LOGOS[key] ? key : null;
}
export const logoSrc = (chain) => { const k = logoKey(chain); return k ? '/api/chain-logo/' + k : null; };
