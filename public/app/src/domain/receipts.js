// Receipts the household photographed: what they bought becomes part of
// "what you usually buy", and what they paid is shown next to the price
// comparison ("you paid ₪7.90 at <store>"). Pure.

import { aisleOf } from './shopping.js';
import { score, sizeOfProduct, bestPrice } from './prices.js';

// A receipt line's name as a list item: without sizes, numbers and codes,
// at most three words ("חלב תנובה 3% 1 ליטר" → "חלב תנובה 3%").
const UNIT_WORDS = /^(ק"?ג|ק״ג|קג|גר'?|גרם|ג'?|מ"?ל|מ״ל|מל|ליטר|ל'?|יח'?|יחידות|יחידה|מארז|שקית|בקבוק|גביע|קרטון|x|X|\*)$/;
export function shortName(name) {
  const words = String(name || '').replace(/[()[\]{}|_~^`<>]/g, ' ').replace(/(\d)\s*([xX*×])\s*(\d)/g, '$1 $3').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (/^\d+([.,]\d+)?$/.test(w) || /^\d+[א-תa-z"'״׳]+$/i.test(w) || UNIT_WORDS.test(w)) continue;
    if (/^[\d.,]+%$/.test(w) && out.length) { out.push(w); continue; }
    if (/\d{4,}/.test(w)) continue;
    out.push(w.replace(/[.,;:]+$/, ''));
    if (out.length === 3) break;
  }
  return out.join(' ').trim();
}

// The receipt's lines as finished list items (bought on its date): each
// name once, so "what you usually buy" learns them.
export function historyItems(receipt) {
  const seen = new Set();
  const out = [];
  for (const it of (receipt && receipt.items) || []) {
    const name = shortName(it.name);
    const k = name.replace(/["'׳״]/g, '');
    if (name.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push({ name, qty: it.qty > 1 ? '×' + Math.round(it.qty) : null, aisle: aisleOf(name) });
  }
  return out;
}

// What the household last paid for a list item, from its receipts (newest
// first): the price of one unit, the store and the date. Null when no
// receipt has it.
//   like: the product the comparison picked; a receipt line clearly another
//   product (olive oil for "שמן" when canola was picked: four times the price
//   a liter) is not "what you paid" for it.
function sameKind(it, like) {
  if (!like) return true;
  const a = sizeOfProduct({ name: it.name });
  const b = sizeOfProduct(like);
  const bp = bestPrice(like);
  if (!a || !b || !bp || a.unit !== b.unit || !(a.qty > 0) || !(b.qty > 0)) return true;
  const q = it.qty > 0 && it.qty < 50 && Number.isInteger(it.qty) ? it.qty : 1;
  const r = (it.price / q / a.qty) / (bp.price / b.qty);
  return r >= 0.4 && r <= 2.5;
}
export function lastPaid(query, receipts, like = null) {
  const sorted = [...(receipts || [])].sort((a, b) => String(b.bought_on || b.created_at || '').localeCompare(String(a.bought_on || a.created_at || '')));
  for (const r of sorted) {
    let best = null;
    for (const it of r.items || []) {
      if (!(it.price > 0)) continue;
      const s = score(query, { name: it.name });
      if (s > 0 && sameKind(it, like) && (!best || s > best.s)) best = { s, it };
    }
    if (best) {
      const q = best.it.qty > 0 && best.it.qty < 50 && Number.isInteger(best.it.qty) ? best.it.qty : 1;
      return { price: Math.round((best.it.price / q) * 100) / 100, name: best.it.name, store: r.store || null, date: r.bought_on || null };
    }
  }
  return null;
}

// A short summary of the receipts for the shopping tab: how many, the total
// of the last one, and when.
export function receiptsSummary(receipts) {
  const list = [...(receipts || [])].sort((a, b) => String(b.bought_on || b.created_at || '').localeCompare(String(a.bought_on || a.created_at || '')));
  return { count: list.length, last: list[0] || null, lines: list.reduce((n, r) => n + ((r.items || []).length), 0) };
}
