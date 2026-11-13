import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { certLevel, isCert, searchTerm, chainHe } from '../domain/prices.js';

// Prices for the shopping list: matched in our own catalog first (one call
// for the whole list), and only what is missing is asked of the price
// service through the server.

// The products for every item on the list, as { [typed name]: [products] }.
export async function searchPrices(names) {
  const list = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 300);
  if (!list.length) return {};
  // Searched as the chains write it ("ביצה" as "ביצים"), each term once, and
  // kept under the name on the list.
  const terms = [...new Set(list.map(searchTerm))];
  // A long list in parts of 40, four at a time: one huge request could pass
  // the database's time limit, and a part that fails is asked once more.
  const parts = [];
  for (let i = 0; i < terms.length; i += 40) parts.push(terms.slice(i, i + 40));
  const ask = async (part) => {
    for (let tries = 0; ; tries++) {
      const { data, error } = await sb.rpc('price_search', { p_queries: part });
      if (!error) return data || [];
      if (tries >= 1) throw error;
    }
  };
  const found = new Map(terms.map((t) => [t, []]));
  for (let i = 0; i < parts.length; i += 4) {
    const got = await Promise.all(parts.slice(i, i + 4).map(ask));
    got.forEach((rows, k) => {
      const part = parts[i + k];
      for (const r of rows) {
        const term = part[r.q - 1];
        if (term) found.get(term).push({ ...r, names: String(r.names || '').split(' | ').filter(Boolean), offers: (r.offers || []).map((o) => (o && o.chain_name ? { ...o, chain_name: chainHe(o.chain_name) } : o)) });
      }
    });
  }
  return Object.fromEntries(list.map((n) => [n, found.get(searchTerm(n)) || []]));
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
// The chains whose customers club or credit card the family has
// ('rami-levy:club', 'shufersal:card'): their deals count for them. Before the
// database has the column, none.
export async function getClubs(hid) {
  const { data, error } = await sb.from('price_prefs').select('clubs').eq('household_id', hid).maybeSingle();
  if (error || !data) return [];
  return (data.clubs || []).filter((c) => /^[a-z0-9-]{1,40}:(club|card)$/.test(c));
}
// Chains open on Shabbat the family brought back into its comparison.
export async function getChainsShown(hid) {
  const { data, error } = await sb.from('price_prefs').select('chains_shown').eq('household_id', hid).maybeSingle();
  if (error || !data) return [];
  return (data.chains_shown || []).filter((c) => /^[a-z0-9-]{1,40}$/.test(c));
}
export async function setChainsShown(hid, chains) {
  const list = [...new Set((chains || []).filter((c) => /^[a-z0-9-]{1,40}$/.test(c)))].slice(0, 40);
  const { error } = await sb.from('price_prefs').upsert({ household_id: hid, chains_shown: list, updated_at: new Date().toISOString() }, { onConflict: 'household_id' });
  if (error) throw error;
}
export async function setClubs(hid, clubs) {
  const list = [...new Set((clubs || []).filter((c) => /^[a-z0-9-]{1,40}:(club|card)$/.test(c)))].slice(0, 80);
  const { error } = await sb.from('price_prefs').upsert({ household_id: hid, clubs: list, updated_at: new Date().toISOString() }, { onConflict: 'household_id' });
  if (error) throw error;
}
// This household's word on a product: the certifier its package shows (one
// per household).
export async function voteKosher(hid, barcode, cert) {
  const { error } = await sb.from('kosher_votes').upsert({ household_id: hid, barcode, cert, level: certLevel(cert) }, { onConflict: 'barcode,household_id' });
  if (error) throw error;
}
// Where the family lives, and the branch found near it at each chain.
export async function getArea(hid) {
  const [{ data: a }, { data: s }] = await Promise.all([
    sb.from('household_area').select('city_code,city,hood,max_km').eq('household_id', hid).maybeSingle(),
    sb.from('household_stores').select('chain,chain_name,store_id,name,address,city,km,kind').eq('household_id', hid)
  ]);
  return a ? { ...a, stores: s || [] } : null;
}
export const setArea = (hid, city_code, hood, max_km = 25) => api('/api/prices/area', { method: 'POST', body: { hid, city_code, hood, max_km } });
export const findPlaces = (q) => api('/api/prices/places?q=' + encodeURIComponent(q));
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
