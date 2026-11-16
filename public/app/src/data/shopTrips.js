import { sb } from '../lib/supabase.js';
import { addTransaction, removeMany } from './household.js';
import { SHOP_SOURCE } from '../domain/shopTrips.js';

// Shopping trips: "סיימתי לקנות" saves what was bought as one trip; what was
// not bought stays on the list. A receipt can be added later, and its total
// becomes the trip's expense (until the card's statement brings the charge).

const COLS = 'id,finished_at,chain,chain_name,bought,left_over,receipt_id,tx_id,total';

export async function loadTrips(hid) {
  const { data, error } = await sb.from('shop_trips').select(COLS).eq('household_id', hid).order('finished_at', { ascending: false }).limit(60);
  if (error) return [];
  return data || [];
}

// The bought items leave the list under the new trip. With a total (typed,
// or from a receipt), an expense is added for the trip.
export async function finishTrip(hid, { bought, left, chain = null, chainName = null }) {
  const at = new Date().toISOString();
  const { data: trip, error } = await sb.from('shop_trips').insert({ household_id: hid, finished_at: at, chain, chain_name: chainName, bought: bought.length, left_over: left.length }).select(COLS).single();
  if (error) throw error;
  const ids = bought.map((i) => i.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error: e2 } = await sb.from('shopping_items').update({ cleared_at: at, trip_id: trip.id }).in('id', ids.slice(i, i + 200)).eq('household_id', hid);
    if (e2) throw e2;
  }
  return trip;
}

// The trip's expense: made, or its amount changed. `cat` from shopCategory.
export async function setTripExpense(hid, trip, { amount, date, store, cat }) {
  const value = Math.round(Number(amount) * 100) / 100;
  if (!(value > 0)) return trip;
  if (trip.tx_id) {
    const { error } = await sb.from('transactions').update({ amount: value }).eq('id', trip.tx_id).eq('household_id', hid);
    if (!error) {
      await sb.from('shop_trips').update({ total: value }).eq('id', trip.id);
      return { ...trip, total: value };
    }
  }
  const tx = await addTransaction({ type: 'expense', amount: value, description: store || 'קנייה בסופר', tx_date: date || String(trip.finished_at).slice(0, 10), ...cat, source: SHOP_SOURCE });
  await sb.from('shop_trips').update({ total: value, tx_id: tx.id }).eq('id', trip.id);
  return { ...trip, total: value, tx_id: tx.id };
}

// A receipt read for a trip: kept with the trip (its lines are not added to
// the list's history again: the trip already has what was bought).
export async function attachReceipt(hid, trip, receipt) {
  const { data, error } = await sb.from('shop_receipts').insert({ household_id: hid, store: receipt.store || trip.chain_name || null, bought_on: receipt.date || String(trip.finished_at).slice(0, 10), total: receipt.total || null, items: receipt.items, trip_id: trip.id }).select('id,store,bought_on,total,items,created_at,trip_id').single();
  if (error) throw error;
  await sb.from('shop_trips').update({ receipt_id: data.id }).eq('id', trip.id);
  return data;
}

export async function loadReceipt(id) {
  const { data } = await sb.from('shop_receipts').select('id,store,bought_on,total,items,created_at,trip_id').eq('id', id).maybeSingle();
  return data || null;
}

// The household said the shopping expense and the card's line are one
// purchase: the shopping one goes (the card's is the real charge).
export const dropShopExpense = (id) => removeMany([id]);

export async function removeItems(hid, ids) {
  if (!ids.length) return;
  const { error } = await sb.from('shopping_items').delete().in('id', ids).eq('household_id', hid);
  if (error) throw error;
}

export async function loadTripItems(hid, tripId) {
  const { data } = await sb.from('shopping_items').select('id,name,qty,aisle').eq('household_id', hid).eq('trip_id', tripId).order('created_at', { ascending: true }).limit(300);
  return data || [];
}
