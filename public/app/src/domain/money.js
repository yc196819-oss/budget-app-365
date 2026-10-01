// Pure money logic for the Money screen. No DOM, no network.
// A transaction row (from Supabase `transactions`) looks like:
//   { id, type: 'expense'|'income', amount: >0, tx_date: 'YYYY-MM-DD', description,
//     category_id, subcategory_id, nature: 'fixed'|'variable', spread: 'month'|'year', created_by }

export const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const WEEKDAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];

export function parseDate(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return { y, m: m - 1, d };
}

export function isoDate(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// The n months ending with the month of `today`, oldest first: [{ y, m }]
export function monthsBack(today, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({ y: dt.getFullYear(), m: dt.getMonth() });
  }
  return out;
}

export function monthLabel({ y, m }) {
  return MONTH_NAMES[m] + ' ' + y;
}

export function inMonth(tx, { y, m }) {
  const d = parseDate(tx.tx_date);
  return d.y === y && d.m === m;
}

// How much of a transaction belongs to month y/m. A transaction marked
// spread='year' is split evenly over 12 months starting with its own month
// (same rule as the current app).
export function monthShare(tx, { y, m }) {
  const d = parseDate(tx.tx_date);
  const amount = Number(tx.amount) || 0;
  if (tx.spread === 'year') {
    const diff = (y - d.y) * 12 + (m - d.m);
    return diff >= 0 && diff < 12 ? amount / 12 : 0;
  }
  return d.y === y && d.m === m ? amount : 0;
}

export function totalsFor(txs, months) {
  let expense = 0;
  let income = 0;
  for (const tx of txs) {
    for (const mo of months) {
      const v = monthShare(tx, mo);
      if (!v) continue;
      if (tx.type === 'income') income += v; else expense += v;
    }
  }
  return { expense, income, net: income - expense };
}

// "שופרסל דיל 1234 ת"א" and "שופרסל דיל" are the same merchant.
export function merchantKey(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 2)
    .join(' ');
}

// Same merchant when one key is a word-prefix of the other:
// "ארומה" matches "ארומה תל", but "קפה לנדוור" does not match "קפה גרג".
export function sameMerchant(a, b) {
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (!ka || !kb) return false;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return long === short || long.startsWith(short + ' ');
}

export function topCategoryId(tx, categoriesById) {
  const c = categoriesById.get(tx.category_id);
  if (c && c.parent_id) return c.parent_id;
  return tx.category_id || null;
}

export function filterTxs(txs, { query = '', filter = 'all', categoriesById = new Map() } = {}) {
  const q = query.trim().toLowerCase();
  return txs.filter((tx) => {
    if (filter === 'expense' && tx.type === 'income') return false;
    if (filter === 'income' && tx.type !== 'income') return false;
    if (filter === 'fixed' && tx.nature !== 'fixed') return false;
    if (!q) return true;
    const cat = categoriesById.get(tx.category_id);
    const sub = categoriesById.get(tx.subcategory_id);
    return [tx.description, cat && cat.name, sub && sub.name].some((s) => String(s || '').toLowerCase().includes(q));
  });
}

function sortKey(tx) {
  return String(tx.tx_date || '') + String(tx.created_at || '');
}

// Newest day first; inside a day, newest first.
export function groupByDay(txs) {
  const map = new Map();
  for (const tx of [...txs].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))) {
    if (!map.has(tx.tx_date)) map.set(tx.tx_date, []);
    map.get(tx.tx_date).push(tx);
  }
  return [...map.entries()].map(([date, items]) => ({ key: date, date, items, net: netOf(items) }));
}

// Newest month first.
export function groupByMonth(txs, months) {
  return [...months].reverse()
    .map((mo) => {
      const items = txs.filter((tx) => inMonth(tx, mo)).sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
      return { key: mo.y + '-' + mo.m, month: mo, items, net: netOf(items) };
    })
    .filter((g) => g.items.length);
}

function netOf(items) {
  return items.reduce((s, tx) => s + (tx.type === 'income' ? 1 : -1) * (Number(tx.amount) || 0), 0);
}

export function dayLabel(iso, today) {
  const { y, m, d } = parseDate(iso);
  const date = new Date(y, m, d);
  const base = WEEKDAYS[date.getDay()] + ', ' + d + '.' + (m + 1);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((t - date) / 86400000);
  if (diff === 0) return 'היום · ' + base;
  if (diff === 1) return 'אתמול · ' + base;
  return base;
}

// Spending per top-level expense category for the given months, against the
// monthly budget × number of months. Biggest first.
export function categoryRows(txs, categories, budgets, months) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const spent = new Map();
  let uncategorized = 0;
  for (const tx of txs) {
    if (tx.type === 'income') continue;
    const v = months.reduce((s, mo) => s + monthShare(tx, mo), 0);
    if (!v) continue;
    const top = topCategoryId(tx, byId);
    if (!top || !byId.has(top)) { uncategorized += v; continue; }
    spent.set(top, (spent.get(top) || 0) + v);
  }
  const budgetOf = new Map(budgets.map((b) => [b.category_id, Number(b.monthly_amount) || 0]));
  const rows = categories
    .filter((c) => !c.parent_id && c.kind !== 'income')
    .map((c) => {
      const s = spent.get(c.id) || 0;
      const b = (budgetOf.get(c.id) || 0) * months.length;
      return { id: c.id, name: c.name, icon: c.icon || '', spent: s, budget: b, over: b > 0 && s > b, pct: b > 0 ? Math.min(100, Math.round((s / b) * 100)) : 0 };
    })
    .filter((r) => r.spent > 0 || r.budget > 0)
    .sort((a, b) => b.spent - a.spent);
  if (uncategorized > 0) rows.push({ id: null, name: 'בלי קטגוריה', icon: '', spent: uncategorized, budget: 0, over: false, pct: 0 });
  return rows;
}

// "46 קפה בארומה", "קפה 46", "₪1,200 מוסך" -> { amount, description }
export function parseQuickAdd(text) {
  const s = String(text || '');
  const m = s.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
  const description = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length))
    .replace(/[₪]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!amount || amount <= 0 || !description) return null;
  return { amount, description };
}

// The category last used for the same merchant, if any.
export function guessCategory(description, history) {
  if (!merchantKey(description)) return null;
  const hit = [...history]
    .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))
    .find((tx) => tx.category_id && sameMerchant(tx.description, description));
  return hit ? { category_id: hit.category_id, subcategory_id: hit.subcategory_id || null } : null;
}

// What this household adds most often, for one-tap adding: [{ description, amount, category_id, subcategory_id, count }]
export function frequentMerchants(txs, today, limit = 4) {
  const since = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90));
  const groups = new Map();
  for (const tx of txs) {
    if (tx.type === 'income' || tx.nature === 'fixed' || String(tx.tx_date) < since) continue;
    const key = merchantKey(tx.description);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, limit)
    .map((g) => {
      const amounts = g.map((t) => Number(t.amount)).sort((a, b) => a - b);
      const latest = [...g].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))[0];
      return { description: latest.description, amount: amounts[Math.floor(amounts.length / 2)], category_id: latest.category_id || null, subcategory_id: latest.subcategory_id || null, count: g.length };
    });
}

// Other transactions from the same merchant that a category change should also apply to.
export function sameMerchantIds(tx, txs) {
  return txs.filter((t) => t.id !== tx.id && t.type === tx.type && sameMerchant(t.description, tx.description)).map((t) => t.id);
}
