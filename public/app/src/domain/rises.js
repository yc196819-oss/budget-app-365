// A recurring payment that got dearer: the same business charged once a
// month, steady for at least two months, and now at least 5% and ₪10 more.
// Only the last month or the one before (an old rise is old news). Pure.

import { merchantKey, parseDate } from './money.js';

const monthOf = (iso) => String(iso).slice(0, 7);
const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); };

export function priceRises(txs, today = new Date()) {
  const now = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
  const recent = new Set([now, prevMonth(now)]);
  const by = new Map();
  for (const t of txs || []) {
    if (t.type !== 'expense' || !(Number(t.amount) > 0)) continue;
    const k = merchantKey(t.description);
    if (!k || k.length < 3) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  }
  const out = [];
  for (const list of by.values()) {
    const months = new Map();
    for (const t of list) {
      const m = monthOf(t.tx_date);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(t);
    }
    // Once a month: a business charged twice in a month is a shop, not a payment.
    if ([...months.values()].some((l) => l.length > 1)) continue;
    const ms = [...months.keys()].sort();
    if (ms.length < 3) continue;
    const lastM = ms[ms.length - 1];
    if (!recent.has(lastM)) continue;
    const last = months.get(lastM)[0];
    const p1 = Number(months.get(ms[ms.length - 2])[0].amount);
    const p2 = Number(months.get(ms[ms.length - 3])[0].amount);
    // Steady before: the two months before within 3% of each other.
    if (Math.abs(p1 - p2) > Math.max(p1, p2) * 0.03) continue;
    const from = p1, to = Number(last.amount);
    if (!(to > from * 1.05 && to - from >= 10)) continue;
    const d = parseDate(last.tx_date);
    out.push({
      key: 'rise:' + last.id, tx: last, name: String(last.description || '').trim().slice(0, 40),
      from: Math.round(from * 100) / 100, to: Math.round(to * 100) / 100,
      pct: Math.round(((to - from) / from) * 100), perYear: Math.round((to - from) * 12),
      since: d ? d.m : null
    });
  }
  return out.sort((a, b) => b.perYear - a.perYear);
}
