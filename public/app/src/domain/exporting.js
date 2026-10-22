// "Everything we keep about you", as files: all of it as JSON, and the
// transactions as a CSV that opens in Excel (BOM, so Hebrew reads right).

export const TX_COLUMNS = ['tx_date', 'type', 'amount', 'description', 'category', 'subcategory', 'payment_method', 'nature', 'source', 'created_at'];

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Quote what would break a row, and defuse cells Excel would run as formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// Category names instead of ids, so the sheet reads by itself.
export function txRows(txs, categories) {
  const name = new Map((categories || []).map((c) => [c.id, c.name]));
  return [...(txs || [])]
    .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)))
    .map((t) => ({ ...t, category: name.get(t.category_id) || '', subcategory: name.get(t.subcategory_id) || '' }));
}

export function exportName(kind, today = new Date()) {
  const d = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  return 'budget-' + kind + '-' + d + (kind === 'transactions' ? '.csv' : '.json');
}

// What a deleted row was, in a line: for the recycle bin.
const KINDS = {
  transactions: { icon: '🧾', label: 'תנועה' },
  goals: { icon: '🎯', label: 'יעד' },
  installments: { icon: '💳', label: 'תשלומים' },
  categories: { icon: '🏷️', label: 'קטגוריה' },
  loans: { icon: '🏦', label: 'הלוואה' },
  investments: { icon: '📈', label: 'השקעה' },
  bank_accounts: { icon: '🏛️', label: 'חשבון בנק' },
  credit_cards: { icon: '💳', label: 'כרטיס אשראי' },
  trips: { icon: '✈️', label: 'טיול' }
};

export function binLine(item) {
  const k = KINDS[item.tbl] || { icon: '🗂️', label: 'פריט' };
  const d = item.data || {};
  const title = d.description || d.name || d.title || d.destination || k.label;
  const amount = Number(d.amount ?? d.target_amount ?? d.total_amount ?? d.balance ?? NaN);
  return { icon: k.icon, kind: k.label, title: String(title).slice(0, 80), amount: Number.isFinite(amount) ? amount : null, date: d.tx_date || null };
}

// Kept 30 days from removal.
export function daysLeft(removedAt, now = new Date(), keep = 30) {
  return Math.max(0, keep - Math.floor((now.getTime() - new Date(removedAt).getTime()) / 86400000));
}
