// Deals at the supermarket, and our policy for them. Pure.
//
// A deal is counted in a chain's total only when anyone walking in gets it:
//   • open to everyone, or to a club the family said it has at that chain
//     (its customers club, or its credit card);
//   • no coupon to bring;
//   • no minimum purchase ("בקנייה מעל ₪75");
//   • on today (started, and not over);
//   • the list asks for enough of it ("2 ב-₪15" counts for ×2, not for one);
//   • up to the deal's limit ("עד 4 יחידות"): beyond it, the regular price.
// Any other deal is shown next to the product, with what it takes, and is
// not counted, so the total is what the family will really pay.

export const PROMO_POLICY = 'מבצע נכלל בסכום כשכל אחד מקבל אותו, או כשהוא של מועדון או כרטיס אשראי שסימנתם שיש לכם באותה רשת; בלי קופון ובלי קנייה מינימלית, בתוקף היום, וכשהכמות ברשימה מספיקה למבצע. מבצע אחר מופיע ליד המוצר ולא נכלל.';

const DAY = 86400000;
// On today: started by the end of today, and not over yet.
function onToday(p, now) {
  const t = now.getTime();
  if (p.ends_at && new Date(p.ends_at).getTime() < t) return false;
  if (p.starts_at && new Date(p.starts_at).getTime() > t + DAY) return false;
  return true;
}
// Why a deal is not counted for this list (null: it is).
//   clubs: what the family has at this chain, a Set of 'club' / 'card'.
export function promoBlock(p, qty, now = new Date(), clubs = null) {
  if (!onToday(p, now)) return 'not-today';
  if (!p.everyone && !(p.club && clubs && clubs.has(p.club))) return p.club === 'card' ? 'card' : 'club';
  if (p.coupon) return 'coupon';
  if (p.min_buy > 0) return 'min-buy';
  if ((p.need || 1) > qty) return 'more';
  return null;
}
// What `qty` units cost at this offer with this deal.
function costWith(price, p, qty) {
  const need = p.need || 1;
  const cap = p.max_qty > 0 ? Math.min(qty, p.max_qty) : qty;
  const inDeal = Math.floor(cap / need) * need;
  return inDeal * p.unit_price + (qty - inDeal) * price;
}
const r2 = (n) => Math.round(n * 100) / 100;

// The cost of `qty` units at an offer (a chain's price, with its deals):
//   { cost, promo: the deal counted or null, saved, other: the best deal not
//     counted and why ({ promo, why }) or null }.
//   clubs: the family's clubs, a Set of 'chain:club' / 'chain:card'.
export function promoCost(offer, qty = 1, now = new Date(), clubs = null) {
  const mine = new Set();
  if (clubs && offer) for (const k of ['club', 'card']) if (clubs.has(offer.chain + ':' + k)) mine.add(k);
  const price = Number(offer && offer.price) || 0;
  const base = r2(price * qty);
  let best = null;
  let other = null;
  for (const p of (offer && offer.promos) || []) {
    if (!(p.unit_price > 0) || !(p.unit_price < price)) continue;
    const why = promoBlock(p, qty, now, mine);
    if (why === 'not-today') continue;
    if (why) { if (!other || p.unit_price < other.promo.unit_price) other = { promo: p, why }; continue; }
    const cost = r2(costWith(price, p, qty));
    if (cost < base && (!best || cost < best.cost)) best = { cost, promo: p };
  }
  return best ? { cost: best.cost, promo: best.promo, saved: r2(base - best.cost), other } : { cost: base, promo: null, saved: 0, other };
}

// A deal in a few words: "2 ב-₪15", or "₪12.50 במקום ₪15.90", and until when.
const fmt = (n) => '₪' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
// The day in Israel (where the shop is), whatever the device's clock says.
const ilDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
function untilText(iso, now = new Date()) {
  if (!iso) return '';
  const end = new Date(iso);
  const day = ilDay(end);
  if (day === ilDay(now)) return 'עד היום';
  if (day === ilDay(new Date(now.getTime() + 86400000))) return 'עד מחר';
  const [, m, d] = day.split('-');
  return 'עד ' + Number(d) + '.' + Number(m);
}
export function promoText(p, regular, now = new Date()) {
  const need = p.need || 1;
  const deal = need > 1 ? need + ' ב-' + fmt(p.unit_price * need) : fmt(p.unit_price) + (regular ? ' במקום ' + fmt(regular) : '');
  return deal + (p.ends_at ? ' · ' + untilText(p.ends_at, now) : '');
}
// What a deal that is not counted takes, in words.
export function blockText(why, p) {
  if (why === 'club') return 'למועדון בלבד';
  if (why === 'card') return 'בכרטיס האשראי של הרשת';
  if (why === 'coupon') return 'עם קופון';
  if (why === 'min-buy') return 'בקנייה מעל ' + fmt(p.min_buy);
  if (why === 'more') return 'בקניית ' + (p.need || 1);
  return '';
}
// A deal that is not counted, in one short line: the deal, and why not.
export function offText(other) {
  const p = other.promo;
  const need = p.need || 1;
  if (other.why === 'more') return 'מבצע ' + need + ' ב-' + fmt(p.unit_price * need) + ' (לא בסכום: ברשימה פחות מ-' + need + ')';
  return 'מבצע ' + fmt(p.unit_price) + ' ' + blockText(other.why, p) + ' (לא בסכום)';
}
