import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';

// Prices for the shopping list: matched in our own catalog first (one call
// for the whole list), and only what is missing is asked of the price
// service through the server.

// The products for every item on the list, as { [typed name]: [products] }.
export async function searchPrices(names) {
  const list = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 300);
  if (!list.length) return {};
  const { data, error } = await sb.rpc('price_search', { p_queries: list });
  if (error) throw error;
  const out = Object.fromEntries(list.map((n) => [n, []]));
  for (const r of data || []) {
    const name = list[r.q - 1];
    if (name) out[name].push({ ...r, names: String(r.names || '').split(' | ').filter(Boolean) });
  }
  return out;
}

// Ask the service for items with nothing in our catalog; then check on it.
export const fetchPrices = (hid, queries) => api('/api/prices/fetch', { method: 'POST', body: { hid, queries } });
export const fetchStatus = (runId) => api('/api/prices/fetch/' + encodeURIComponent(runId));

export async function getKosherPref(hid) {
  const { data } = await sb.from('price_prefs').select('kosher').eq('household_id', hid).maybeSingle();
  return (data && data.kosher) || null;
}
export async function setKosherPref(hid, kosher) {
  const { error } = await sb.from('price_prefs').upsert({ household_id: hid, kosher, updated_at: new Date().toISOString() }, { onConflict: 'household_id' });
  if (error) throw error;
}
// This household's word on a product's kashrut (one per household).
export async function voteKosher(hid, barcode, level) {
  const { error } = await sb.from('kosher_votes').upsert({ household_id: hid, barcode, level }, { onConflict: 'barcode,household_id' });
  if (error) throw error;
}
// The product picked for a line on the list.
export async function pickProduct(itemId, barcode) {
  const { error } = await sb.from('shopping_items').update({ barcode }).eq('id', itemId);
  if (error) throw error;
}

// The owner: a first catalog, and products waiting for a kashrut word.
export const loadStart = () => api('/api/admin/prices/load', { method: 'POST', body: {} });
export const loadState = () => api('/api/admin/prices/load');
export const seedStart = (part) => api('/api/admin/prices/seed', { method: 'POST', body: { part } });
export const seedStatus = (runId) => api('/api/admin/prices/seed/' + encodeURIComponent(runId));
export const kosherList = (q = '') => api('/api/admin/kosher' + (q ? '?q=' + encodeURIComponent(q) : ''));
export const kosherConfirm = (barcodes, level) => api('/api/admin/kosher', { method: 'POST', body: { barcodes, level } });
