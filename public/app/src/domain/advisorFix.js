// The advisor proposes changes to transactions; the person approves them.
// 1. When a message asks for a fix, the transactions it is about are sent
//    with it (candidates): by a business named in it or in the last
//    messages, an amount, or a day.
// 2. The advisor answers with "@@שינויים:" and the changes as JSON, using
//    only those ids and existing category names.
// 3. Here they are checked and turned into rows the person sees, before and
//    after. Nothing changes until "כן". No deletions from the advisor. Pure.

import { merchantKey } from './money.js';

export const FIX_MARK = '@@שינויים:';
const ASKS = /(לתקן|תתקן|תקן|לשנות|תשנה|שנה את|להעביר|תעביר|העבר|לסווג|תסווג|טעות|לא נכון|זה לא |זו לא |בעצם|הכנסה|הוצאה|קטגורי|מסווג|העברה בין|לאחד|תאריך|הסכום)/;

export const wantsFix = (text) => ASKS.test(String(text || ''));

const words = (s) => String(s || '').replace(/[^\p{L}\d\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3);

// The transactions a fix may be about: a business whose name appears in the
// message (or the last two messages of the person), an amount written in it,
// or a day ("10/11", "10.11"). Newest first, at most 60.
export function candidatesFor(message, txs, categories, earlier = []) {
  const text = [message, ...earlier.slice(-2)].join(' ');
  const said = new Set(words(text).map((w) => w.toLowerCase()));
  const amounts = new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => Number(x.replace(/,/g, ''))).filter((n) => n >= 5));
  const days = new Set((text.match(/\b(\d{1,2})[/.](\d{1,2})\b/g) || []).map((d) => { const [a, b] = d.split(/[/.]/).map(Number); return String(b).padStart(2, '0') + '-' + String(a).padStart(2, '0'); }));
  const byId = new Map((categories || []).map((c) => [c.id, c]));
  const hit = (txs || []).filter((t) => {
    const key = merchantKey(t.description);
    const named = key && key.split(' ').some((w) => w.length >= 3 && said.has(w.toLowerCase()));
    const amount = amounts.has(Math.round(Math.abs(Number(t.amount))));
    const day = days.has(String(t.tx_date).slice(5, 10));
    return named || (amount && (day || named)) || (day && amount);
  });
  return hit.sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date))).slice(0, 60).map((t) => ({
    id: t.id, date: t.tx_date, type: t.type, amount: Math.abs(Number(t.amount)), description: t.description || '',
    category: (byId.get(t.category_id) || {}).name || '', subcategory: (byId.get(t.subcategory_id) || {}).name || ''
  }));
}

// The categories the advisor may use, by name ("אוכל > סופר").
export const categoryNames = (categories) => (categories || []).map((c) => ({ name: c.name, parent: c.parent_id ? ((categories.find((p) => p.id === c.parent_id) || {}).name || null) : null, kind: c.kind || 'expense' }));

function findCategory(categories, name, sub, kind) {
  const n = (s) => String(s || '').trim();
  if (!n(name)) return null;
  const tops = categories.filter((c) => !c.parent_id && n(c.name) === n(name) && (!kind || (c.kind || 'expense') === kind));
  const top = tops[0] || categories.find((c) => !c.parent_id && n(c.name) === n(name));
  if (!top) return null;
  const child = n(sub) ? categories.find((c) => c.parent_id === top.id && n(c.name) === n(sub)) : null;
  if (n(sub) && !child) return null;
  return { category_id: top.id, subcategory_id: child ? child.id : null, kind: top.kind || 'expense' };
}

// The advisor's answer → the changes, checked. Each: { id, tx, patch, before,
// after, reason }. Changes to unknown ids, unknown categories, deletions and
// changes that change nothing are dropped; `dropped` says how many.
export function parseFix(raw, txs, categories) {
  const s = String(raw || '');
  const at = s.indexOf(FIX_MARK);
  if (at < 0) return null;
  let rest = s.slice(at + FIX_MARK.length);
  const end = rest.indexOf('@@');
  if (end >= 0) rest = rest.slice(0, end);
  const from = rest.indexOf('{'), to = rest.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  let j;
  try { j = JSON.parse(rest.slice(from, to + 1)); } catch (_e) { return null; }
  const ops = Array.isArray(j && j.ops) ? j.ops.slice(0, 20) : [];
  const byId = new Map((txs || []).map((t) => [t.id, t]));
  const cname = (id) => ((categories || []).find((c) => c.id === id) || {}).name || 'בלי קטגוריה';
  const changes = [];
  let dropped = 0;
  for (const op of ops) {
    const tx = op && byId.get(op.id);
    if (!tx || op.op !== 'update' || !op.set || typeof op.set !== 'object') { dropped++; continue; }
    const set = op.set, patch = {};
    const type = set.type === 'income' || set.type === 'expense' ? set.type : tx.type;
    if (type !== tx.type) patch.type = type;
    if (set.category) {
      const c = findCategory(categories || [], set.category, set.subcategory, type);
      if (!c || c.kind !== type) { dropped++; continue; }
      if (c.category_id !== tx.category_id) patch.category_id = c.category_id;
      if ((c.subcategory_id || null) !== (tx.subcategory_id || null)) patch.subcategory_id = c.subcategory_id;
    } else if (patch.type) { patch.category_id = null; patch.subcategory_id = null; }
    if (set.amount != null && Number(set.amount) > 0 && Math.abs(Number(set.amount) - Math.abs(Number(tx.amount))) > 0.001) patch.amount = Math.round(Number(set.amount) * 100) / 100;
    if (set.tx_date && /^\d{4}-\d{2}-\d{2}$/.test(set.tx_date) && set.tx_date !== tx.tx_date) patch.tx_date = set.tx_date;
    if (set.description && String(set.description).trim() && String(set.description).trim() !== tx.description) patch.description = String(set.description).trim().slice(0, 120);
    if (!Object.keys(patch).length) { dropped++; continue; }
    const kindName = (t) => (t === 'income' ? 'הכנסה' : 'הוצאה');
    const catOf = (cid, sid) => cname(cid) + (sid ? ' · ' + cname(sid) : '');
    const before = [patch.type ? kindName(tx.type) : null, (patch.category_id !== undefined || patch.subcategory_id !== undefined) ? catOf(tx.category_id, tx.subcategory_id) : null, patch.amount ? '₪' + Math.abs(Number(tx.amount)) : null, patch.tx_date ? tx.tx_date : null, patch.description ? tx.description : null].filter(Boolean).join(' · ');
    const after = [patch.type ? kindName(patch.type) : null, (patch.category_id !== undefined || patch.subcategory_id !== undefined) ? catOf(patch.category_id !== undefined ? patch.category_id : tx.category_id, patch.subcategory_id !== undefined ? patch.subcategory_id : tx.subcategory_id) : null, patch.amount ? '₪' + patch.amount : null, patch.tx_date || null, patch.description || null].filter(Boolean).join(' · ');
    changes.push({ id: tx.id, tx, patch, before, after, reason: String(op.reason || '').slice(0, 80) });
  }
  return { changes, dropped };
}

// What to put back on "לבטל".
export function undoPatches(changes) {
  return changes.map((c) => ({ id: c.id, patch: Object.fromEntries(Object.keys(c.patch).map((k) => [k, c.tx[k] === undefined ? null : c.tx[k]])) }));
}

// After moving a business's transactions to one category: keep it as a rule?
// Only when every change is a category change of the same business.
export function ruleOffer(changes) {
  if (!changes.length) return null;
  const keys = new Set(changes.map((c) => merchantKey(c.tx.description)));
  const moved = (c) => c.patch.category_id !== undefined || c.patch.subcategory_id !== undefined;
  const to = (c) => ({ category_id: c.patch.category_id !== undefined ? c.patch.category_id : c.tx.category_id, subcategory_id: c.patch.subcategory_id !== undefined ? c.patch.subcategory_id : (c.tx.subcategory_id || null) });
  const cat = new Set(changes.map((c) => to(c).category_id + '|' + (to(c).subcategory_id || '')));
  if (keys.size !== 1 || cat.size !== 1 || !changes.every(moved) || !to(changes[0]).category_id) return null;
  const c = changes[0];
  return { tx: { ...c.tx, type: c.patch.type || c.tx.type }, ...to(c) };
}
