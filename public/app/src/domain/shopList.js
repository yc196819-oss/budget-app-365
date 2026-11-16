// A shopping list the advisor writes in the conversation ("רשימה לשבת ל-6,
// כשר למהדרין"): read from its answer, sized to the number of people (the
// amounts change when the number does), and added to the household's list.
// Built on what this home buys (the list's history, receipts included). Pure.
import { aisleOf, AISLES } from './shopping.js';

export const LIST_MARK = '@@רשימה:';
const AISLE_KEYS = new Set(AISLES.map((a) => a.key));
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const key = (s) => clean(s, 60).toLowerCase().replace(/["'׳״]/g, '');

// The list in the advisor's answer, or null. The JSON comes on one line after
// the mark, before the follow-up questions.
export function parseList(raw) {
  const s = String(raw || '');
  const at = s.indexOf(LIST_MARK);
  if (at < 0) return null;
  let rest = s.slice(at + LIST_MARK.length);
  const end = rest.indexOf('@@');
  if (end >= 0) rest = rest.slice(0, end);
  const from = rest.indexOf('{');
  const to = rest.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  let j;
  try { j = JSON.parse(rest.slice(from, to + 1)); } catch (_e) { return null; }
  if (!j || !Array.isArray(j.items)) return null;
  const people = Math.max(1, Math.min(30, Math.round(Number(j.people) || 0))) || null;
  const seen = new Set();
  const items = [];
  for (const it of j.items.slice(0, 60)) {
    const name = clean(it && it.name, 40);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    const qty = Number(it.qty);
    items.push({
      name,
      qty: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 9999) : null,
      unit: clean(it.unit, 16),
      aisle: AISLE_KEYS.has(it.aisle) ? it.aisle : aisleOf(name),
      scale: it.scale !== false
    });
  }
  if (!items.length) return null;
  return { title: clean(j.title, 40) || 'רשימת קניות', people, kosher: clean(j.kosher, 30), items };
}

// The amount for another number of people, in words people use: "750 גרם",
// "1.5 ק"ג", "2 בקבוקים", "4". Fixed items ("נרות", one package) stay as they are.
const KG = /^(ק"ג|קג|קילו|ק״ג)$/;
const GRAM = /^(גרם|גר'?)$/;
const LITER = /^(ליטר|ל')$/;
const ONE = { 'בקבוקים': 'בקבוק', 'חבילות': 'חבילה', 'יחידות': 'יחידה', 'שישיות': 'שישייה', 'קופסאות': 'קופסה', 'שקיות': 'שקית', 'מגשים': 'מגש', 'קרטונים': 'קרטון' };
const MANY = Object.fromEntries(Object.entries(ONE).map(([m, o]) => [o, m]));
const fmt = (n) => String(Math.round(n * 10) / 10);
export function qtyText(item, people, basePeople) {
  if (item.qty == null) return item.unit || '';
  const factor = item.scale && basePeople ? people / basePeople : 1;
  let n = item.qty * factor;
  const unit = item.unit || '';
  if (KG.test(unit) || GRAM.test(unit)) {
    const grams = KG.test(unit) ? n * 1000 : n;
    if (grams < 1000) return Math.max(50, Math.round(grams / 50) * 50) + ' גרם';
    return fmt(Math.round(grams / 250) * 0.25) + ' ק"ג';
  }
  if (LITER.test(unit)) return fmt(Math.max(0.5, Math.round(n * 2) / 2)) + ' ליטר';
  // Counted things: whole ones, at least one.
  n = Math.max(1, Math.round(n));
  if (!unit) return String(n);
  const word = n === 1 ? (ONE[unit] || unit) : (MANY[unit] || unit);
  return n + ' ' + word;
}

// What the advisor gets to build a list on: the number of people, the
// kashrut the household chose, what it buys again and again (its list's
// history, which receipts join) with what it paid last, and what is already
// on the list (not added twice).
export function shopContext({ items = [], receipts = [], people = null, kosher = null } = {}) {
  const count = new Map();
  for (const i of items) {
    if (!i.done || !i.cleared_at) continue;
    const k = key(i.name);
    const c = count.get(k) || { name: clean(i.name, 40), times: 0, qty: null };
    c.times++;
    if (i.qty) c.qty = clean(i.qty, 20);
    count.set(k, c);
  }
  const paid = new Map();
  for (const r of receipts) for (const line of (Array.isArray(r.items) ? r.items : [])) {
    const k = key(line && line.name);
    const price = Number(line && line.price);
    if (k && price > 0 && !paid.has(k)) paid.set(k, Math.round(price * 100) / 100);
  }
  const usual = [...count.values()].sort((a, b) => b.times - a.times).slice(0, 40)
    .map((c) => ({ ...c, ...(paid.has(key(c.name)) ? { lastPrice: paid.get(key(c.name)) } : {}) }));
  const onList = items.filter((i) => !i.cleared_at && !i.done).map((i) => clean(i.name, 40)).slice(0, 60);
  return {
    people: Number(people) > 0 ? Math.round(Number(people)) : null,
    kosher: Array.isArray(kosher) && kosher.length ? kosher.slice(0, 4) : null,
    usual,
    onList,
    receipts: receipts.length
  };
}

// Is this already on the household's list? ("חלב" covers "חלב 3%".)
export function alreadyOn(name, onList) {
  const k = key(name);
  const first = k.split(' ')[0];
  return (onList || []).some((n) => { const o = key(n); return o === k || o.split(' ')[0] === first; });
}

// The lines to add: the checked ones not on the list yet, sized.
export function toItems(list, people, checked, onList = []) {
  return list.items
    .filter((it) => checked.has(it.name) && !alreadyOn(it.name, onList))
    .map((it) => ({ name: it.name, qty: qtyText(it, people, list.people) || null, aisle: it.aisle }));
}
