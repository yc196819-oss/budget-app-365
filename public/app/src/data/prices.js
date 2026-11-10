import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { certLevel, isCert } from '../domain/prices.js';

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

// The household's kashrut: the certifiers it relies on (a list), "any" for
// no preference, or null when not chosen yet (a level from before asks again).
export async function getKosherPref(hid) {
  const { data } = await sb.from('price_prefs').select('kosher,certs').eq('household_id', hid).maybeSingle();
  if (!data) return null;
  const certs = (data.certs || []).filter(isCert);
  if (certs.length) return certs;
  return data.kosher === 'any' ? 'any' : null;
}
export async function setKosherPref(hid, pref) {
  const certs = Array.isArray(pref) ? pref.filter(isCert) : [];
  const kosher = !certs.length ? 'any' : certs.every((c) => certLevel(c) === 'regular') ? 'regular' : 'mehadrin';
  const { error } = await sb.from('price_prefs').upsert({ household_id: hid, kosher, certs, updated_at: new Date().toISOString() }, { onConflict: 'household_id' });
  if (error) throw error;
}
// This household's word on a product: the certifier its package shows (one
// per household).
export async function voteKosher(hid, barcode, cert) {
  const { error } = await sb.from('kosher_votes').upsert({ household_id: hid, barcode, cert, level: certLevel(cert) }, { onConflict: 'barcode,household_id' });
  if (error) throw error;
}
// The product picked for a line on the list.
export async function pickProduct(itemId, barcode) {
  const { error } = await sb.from('shopping_items').update({ barcode }).eq('id', itemId);
  if (error) throw error;
}

// The owner: a first catalog, and products waiting for a kashrut word.
export const productImages = (barcodes) => api('/api/prices/images', { method: 'POST', body: { barcodes } });
export const loadStart = () => api('/api/admin/prices/load', { method: 'POST', body: {} });
export const loadState = () => api('/api/admin/prices/load');
export const seedStart = (part) => api('/api/admin/prices/seed', { method: 'POST', body: { part } });
export const seedStatus = (runId) => api('/api/admin/prices/seed/' + encodeURIComponent(runId));
export const kosherList = (q = '') => api('/api/admin/kosher' + (q ? '?q=' + encodeURIComponent(q) : ''));
export const kosherConfirm = (barcodes, cert) => api('/api/admin/kosher', { method: 'POST', body: { barcodes, cert } });
