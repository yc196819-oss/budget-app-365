import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { shrinkImage } from './feedback.js';

// Receipts: the photo is read on the server (and not kept); the family checks
// the lines and saves them. What they bought joins the list's history, so
// "what you usually buy" learns it; the receipt itself (store, date, prices)
// is kept for "what you paid last time".

export async function scanReceipt(hid, file) {
  const data = await shrinkImage(file);
  const [, mimeType, fileData] = /^data:([^;]+);base64,(.*)$/.exec(data) || [];
  return api('/api/receipts/scan', { method: 'POST', body: { hid, fileData, mimeType } });
}

// The household's receipts, newest first. Before the receipts table is in
// the database, none (the rest still works).
export async function loadReceipts(hid) {
  const { data, error } = await sb.from('shop_receipts').select('id,store,bought_on,total,items,created_at').eq('household_id', hid).order('created_at', { ascending: false }).limit(60);
  if (error) return [];
  return data || [];
}

// Saves the checked lines: as bought items in the list's history (on the
// receipt's date), and the receipt itself when the database has its table.
// Returns { saved: the receipt row or null, history: rows added }.
export async function saveReceipt(hid, receipt, history) {
  const at = (receipt.date ? new Date(receipt.date + 'T12:00:00') : new Date()).toISOString();
  let rows = [];
  if (history.length) {
    const { data, error } = await sb.from('shopping_items').insert(history.map((h) => ({ household_id: hid, name: h.name, qty: h.qty || null, aisle: h.aisle || 'other', done: true, done_at: at, cleared_at: at }))).select('id,name,qty,aisle,done,added_by,created_at,done_at,cleared_at');
    if (error) throw error;
    rows = data || [];
  }
  const { data: saved } = await sb.from('shop_receipts').insert({ household_id: hid, store: receipt.store || null, bought_on: receipt.date || null, total: receipt.total || null, items: receipt.items }).select('id,store,bought_on,total,items,created_at').maybeSingle();
  return { saved: saved || null, history: rows };
}
