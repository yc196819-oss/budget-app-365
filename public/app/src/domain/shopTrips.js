// A shopping trip: "סיימתי לקנות" keeps what was bought as one trip (the
// date, the chain, how many things), and what was not bought stays on the
// list for next time. A receipt can be added to a trip, and its prices are
// checked against ours. Pure.

import { similarText } from './statement.js';
import { score, sizeOfProduct, validOffers } from './prices.js';
import { shortName } from './receipts.js';

// The source of an expense made from a shopping trip, until the card's
// statement brings the real charge.
export const SHOP_SOURCE = 'shop';

const key = (s) => String(s || '').trim().replace(/["'׳״]/g, '').replace(/\s+/g, ' ');

// The open list split for the "finish" sheet.
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
export function staleItems(items, trips, n = 3) {
  const sorted = [...(trips || [])].sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)));
  const boughtIn = new Map();
  for (const i of items || []) if (i.trip_id) { if (!boughtIn.has(i.trip_id)) boughtIn.set(i.trip_id, new Set()); boughtIn.get(i.trip_id).add(key(i.name)); }
  return (items || []).filter((i) => !i.cleared_at && !i.done).filter((i) => {
    const after = sorted.filter((t) => String(t.finished_at) > String(i.created_at));
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

// One unit's price on a receipt line (a line of 3 yogurts at ₪15 is ₪5 each).
export function unitPaid(line) {
  const q = line.qty > 0 && line.qty < 50 && Number.isInteger(line.qty) ? line.qty : 1;
  return Math.round((Number(line.price) / q) * 100) / 100;
}

// Every receipt line with the price we have for it at the same chain:
//   { name, paid, ours, product, status: 'ok' | 'check' | 'none' }
// `found` is what searchPrices answered, by the line's short name. A product
// whose price is far from the receipt's (another size or kind) is not
// compared: 'none'.
export function compareReceipt(receipt, found, { chain = null, chainName = null } = {}) {
  const name = chainName || (receipt && receipt.store) || '';
  return ((receipt && receipt.items) || []).filter((l) => l.price > 0).map((l) => {
    const q = shortName(l.name) || l.name;
    const paid = unitPaid(l);
    let best = null;
    for (const p of found[q] || []) {
      const offer = validOffers(p).find((o) => sameChain(o, chain, name));
      if (!offer) continue;
      const s = score(q, p);
      if (s > 0 && (!best || s > best.s)) best = { s, p, price: offer.price };
    }
    if (!best) return { name: l.name, paid, ours: null, product: null, status: 'none' };
    // Weighed things: the receipt has a kilo price only when the line says so.
    const sz = sizeOfProduct(best.p);
    const r = paid / best.price;
    if (r < 0.4 || r > 2.5) return { name: l.name, paid, ours: null, product: best.p.name, status: 'none', other: true, sz };
    return { name: l.name, paid, ours: best.price, product: best.p.name, status: gapToCheck(paid, best.price) ? 'check' : 'ok' };
  });
}

export function compareSummary(lines) {
  const known = lines.filter((l) => l.ours != null);
  return {
    paid: Math.round(known.reduce((s, l) => s + l.paid, 0) * 100) / 100,
    ours: Math.round(known.reduce((s, l) => s + l.ours, 0) * 100) / 100,
    check: lines.filter((l) => l.status === 'check').length,
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
