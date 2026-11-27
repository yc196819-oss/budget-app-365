// A shopping trip: "סיימתי לקנות" keeps what was bought as one trip (the
// date, the chain, how many things), and what was not bought stays on the
// list for next time. A receipt can be added to a trip, and its prices are
// checked against ours. Pure.

import { similarText } from './statement.js';
import { score, sizeOfProduct, validOffers } from './prices.js';
import { shortName } from './receipts.js';
import { listOf } from './shopLists.js';

// The source of an expense made from a shopping trip, until the card's
// statement brings the real charge.
export const SHOP_SOURCE = 'shop';

const key = (s) => String(s || '').trim().replace(/["'׳״]/g, '').replace(/\s+/g, ' ');

// The open list split for the "finish" sheet.
// What was typed as "how much you paid": "352.90", "₪1,234.50", and also
// "352,90" (a comma for the agorot), which used to be read as 35,290.
// Not a sum (two dots, letters only): 0.
export function typedAmount(text) {
  const t = String(text || '').replace(/[₪\s]|ש"ח|שח|ש״ח/g, '');
  if (!t) return 0;
  let n;
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) n = Number(t.replace(/,/g, ''));
  else if (/^\d+,\d{1,2}$/.test(t)) n = Number(t.replace(',', '.'));
  else if (/^\d*\.?\d+$/.test(t)) n = Number(t);
  else return 0;
  return n > 0 ? Math.round(n * 100) / 100 : 0;
}

export function finishSplit(items) {
  const open = (items || []).filter((i) => !i.cleared_at);
  return { bought: open.filter((i) => i.done), left: open.filter((i) => !i.done) };
}

// The trips, newest first, each with its bought items (by trip_id).
export function tripsWithItems(trips, items) {
  const by = new Map();
  for (const i of items || []) if (i.trip_id) { if (!by.has(i.trip_id)) by.set(i.trip_id, []); by.get(i.trip_id).push(i); }
  return [...(trips || [])].sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))
    .map((t) => ({ ...t, items: by.get(t.id) || [] }));
}

// Items still on the list that were not bought in the last `n` trips in a
// row (each trip after the item was added): offered to take off the list.
export function staleItems(items, trips, n = 3, lists = null) {
  const sorted = [...(trips || [])].sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)));
  // Several lists: only a shopping of the item's own list counts ("שמפו" on
  // the pharmacy list was not "skipped" by three shoppings for Shabbat).
  const listKey = (i) => (lists ? listOf(i, lists) : null);
  const boughtIn = new Map();
  const listsIn = new Map();
  for (const i of items || []) {
    if (!i.trip_id) continue;
    if (!boughtIn.has(i.trip_id)) { boughtIn.set(i.trip_id, new Set()); listsIn.set(i.trip_id, new Set()); }
    boughtIn.get(i.trip_id).add(key(i.name));
    listsIn.get(i.trip_id).add(listKey(i));
  }
  return (items || []).filter((i) => !i.cleared_at && !i.done).filter((i) => {
    const mine = listKey(i);
    const after = sorted.filter((t) => String(t.finished_at) > String(i.created_at) && (!listsIn.has(t.id) || listsIn.get(t.id).has(mine)));
    if (after.length < n) return false;
    return after.slice(0, n).every((t) => !(boughtIn.get(t.id) || new Set()).has(key(i.name)));
  });
}

// A receipt price against ours is "to check" when the gap is more than 15%
// of our price or more than ₪3, the bigger of the two.
export function gapToCheck(paid, ours) {
  if (!(paid > 0) || !(ours > 0)) return false;
  return Math.abs(paid - ours) > Math.max(ours * 0.15, 3);
}

const sameChain = (offer, chain, chainName) => {
  if (!offer) return false;
  if (chain && offer.chain === chain) return true;
  const n = chainName || '';
  return !!n && !!(offer.chain_name || offer.chain) && similarText(offer.chain_name || offer.chain, n);
};

// A weighed line: a weight in kilos (not a whole number of units).
export const isWeighed = (line) => !!line && (line.weighed === true || (Number(line.qty) > 0 && !Number.isInteger(Number(line.qty))));

// One unit's price on a receipt line (a line of 3 yogurts at ₪15 is ₪5
// each); a weighed line's is its kilo price (written, or the line ÷ kilos).
export function unitPaid(line) {
  if (isWeighed(line)) {
    if (line.unit_price > 0) return Math.round(Number(line.unit_price) * 100) / 100;
    return Math.round((Number(line.price) / Number(line.qty)) * 100) / 100;
  }
  const q = line.qty > 0 && line.qty < 50 && Number.isInteger(line.qty) ? line.qty : 1;
  return Math.round((Number(line.price) / q) * 100) / 100;
}
// How many units (or kilos) the line is.
const unitsOf = (line) => (isWeighed(line) ? Number(line.qty) : line.qty > 0 && line.qty < 50 && Number.isInteger(line.qty) ? line.qty : 1);

// A product sold by the kilo (its price is a kilo price): a size of one
// kilo, or no size at all.
const byKilo = (p) => { const z = sizeOfProduct(p); return !z || (z.unit === 'kg' && z.qty === 1); };

// Every receipt line with the regular price we have for it at the same
// chain, and its deals now:
//   { name, paid, ours, units, weighed, product, by: 'code' | 'name',
//     promo: the deal's text, status }
// status:
//   'ok'      the price we have;
//   'promo'   less than ours, and the chain has a deal on it now;
//   'cheaper' less than ours, a deal we do not know of (the branch's own?);
//   'check'   more than ours (by more than 15% or ₪3);
//   'none'    not found at this chain, or a far price (another product).
// `byCode` (pricesByBarcode) is tried first, by the barcode printed on the
// line: exact. Otherwise `found` (searchPrices, by the line's short name):
// the best name, and of those the price nearest to what was paid; a price
// far from it (under 60% or over 160%) is taken for another product.
export function compareReceipt(receipt, found, { chain = null, chainName = null, byCode = {} } = {}) {
  const name = chainName || (receipt && receipt.store) || '';
  return ((receipt && receipt.items) || []).filter((l) => l.price > 0).map((l) => {
    const paid = unitPaid(l);
    const units = unitsOf(l);
    const weighed = isWeighed(l);
    const base = { name: l.name, paid, units, weighed, ours: null, product: null, by: null, promo: null };
    let pick = null;
    const coded = l.code && byCode && byCode[l.code];
    const codeOffer = coded && validOffers(coded).find((o) => sameChain(o, chain, name));
    if (codeOffer) pick = { p: coded, offer: codeOffer, by: 'code' };
    else {
      const q = shortName(l.name) || l.name;
      let best = null;
      for (const p of found[q] || []) {
        if (weighed && !byKilo(p)) continue;
        const offer = validOffers(p).find((o) => sameChain(o, chain, name));
        if (!offer) continue;
        const s = score(q, p);
        const near = Math.abs(Math.log(paid / offer.price));
        if (s > 0 && (!best || s > best.s || (s === best.s && near < best.near))) best = { s, near, p, offer };
      }
      if (best) {
        const r = paid / best.offer.price;
        if (r < 0.6 || r > 1.6) return { ...base, product: best.p.name, status: 'none', other: true };
        pick = { p: best.p, offer: best.offer, by: 'name' };
      }
    }
    if (!pick) return { ...base, status: 'none' };
    const ours = Number(pick.offer.price);
    const deals = (pick.offer.promos || []).filter((p) => p.unit_price > 0 && p.unit_price < ours);
    const deal = deals[0] || null;
    const line = { ...base, ours, product: pick.p.name, by: pick.by, promo: deal ? deal.text || null : null };
    // (A few agorot less is the same price.)
    if (!gapToCheck(paid, ours) && paid >= ours - Math.max(0.3, ours * 0.03)) return { ...line, status: 'ok' };
    if (paid < ours) return { ...line, status: deal ? 'promo' : 'cheaper' };
    return { ...line, status: gapToCheck(paid, ours) ? 'check' : 'ok' };
  });
}

// The comparison in totals, over the lines found only (so the two sums are
// of the same things): what was paid for them, what they cost at our regular
// price, how much the deals saved, and how many were not found.
export function compareSummary(lines) {
  const known = lines.filter((l) => l.ours != null);
  const r2 = (n) => Math.round(n * 100) / 100;
  const paid = r2(known.reduce((s, l) => s + l.paid * (l.units || 1), 0));
  const ours = r2(known.reduce((s, l) => s + l.ours * (l.units || 1), 0));
  return {
    paid,
    ours,
    saved: r2(Math.max(0, ours - paid)),
    check: lines.filter((l) => l.status === 'check').length,
    promo: lines.filter((l) => l.status === 'promo' || l.status === 'cheaper').length,
    known: known.length,
    total: lines.length
  };
}

// The category for a shopping expense: the one this home used last for the
// same chain; otherwise its "סופר" (or "מזון") category.
export function shopCategory(txs, categories, store) {
  const last = [...(txs || [])].filter((t) => t.type === 'expense' && t.category_id && store && similarText(t.description, store))
    .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)))[0];
  if (last) return { category_id: last.category_id, subcategory_id: last.subcategory_id || null };
  const cats = categories || [];
  const find = (re) => cats.find((c) => re.test(c.name || ''));
  const sub = find(/^סופר$|סופרמרקט|מכולת/);
  if (sub) return sub.parent_id ? { category_id: sub.parent_id, subcategory_id: sub.id } : { category_id: sub.id, subcategory_id: null };
  const top = find(/מזון|אוכל|קניות/);
  return top ? (top.parent_id ? { category_id: top.parent_id, subcategory_id: top.id } : { category_id: top.id, subcategory_id: null }) : { category_id: null, subcategory_id: null };
}

const dayGap = (a, b) => Math.round(Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);

// A shopping expense and a line from a card or bank statement that look like
// the same purchase: the same business (by name) within 3 days. The amount
// is shown, not required to match (a typed total is only an estimate). The
// household decides; nothing is removed by itself.
export function shopTwins(txs, skipped = new Set()) {
  const shops = (txs || []).filter((t) => t.source === SHOP_SOURCE && t.type === 'expense');
  const lines = (txs || []).filter((t) => t.source !== SHOP_SOURCE && t.type === 'expense' && t.source !== 'manual');
  const out = [];
  const used = new Set();
  for (const s of shops) {
    const near = lines.filter((l) => !used.has(l.id) && dayGap(l.tx_date, s.tx_date) <= 3 && similarText(l.description, s.description))
      .sort((a, b) => dayGap(a.tx_date, s.tx_date) - dayGap(b.tx_date, s.tx_date) || Math.abs(a.amount - s.amount) - Math.abs(b.amount - s.amount));
    const l = near[0];
    if (!l) continue;
    const k = 'shoptwin:' + s.id + ':' + l.id;
    if (skipped.has(k)) continue;
    used.add(l.id);
    out.push({ kind: 'shoptwin', key: k, shop: s, line: l });
  }
  return out;
}
