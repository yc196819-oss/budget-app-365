import { sb } from '../lib/supabase.js';
import { useEffect, useState } from 'preact/hooks';

// The household's shopping list, shared and live: what one adds shows for the
// other within a second. Finished shoppings stay (cleared_at) for 120 days,
// for "the previous list" and "what you usually buy".
const DAYS = 120;
const COLS = 'id,name,qty,aisle,done,added_by,created_at,done_at,cleared_at';

export async function loadShopping(hid) {
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const { data, error } = await sb.from('shopping_items').select(COLS).eq('household_id', hid)
    .or('cleared_at.is.null,cleared_at.gte.' + since).order('created_at', { ascending: true }).limit(2000);
  if (error) throw error;
  return data || [];
}

export async function addItems(hid, items) {
  if (!items.length) return [];
  const rows = items.map((i) => ({ household_id: hid, name: i.name, qty: i.qty || null, aisle: i.aisle || 'other' }));
  const { data, error } = await sb.from('shopping_items').insert(rows).select(COLS);
  if (error) throw error;
  return data || [];
}

export async function setDone(id, done) {
  const { error } = await sb.from('shopping_items').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', id);
  if (error) throw error;
}

export async function removeItem(id) {
  const { error } = await sb.from('shopping_items').delete().eq('id', id);
  if (error) throw error;
}

// "Finished shopping": what was bought leaves the list (and is remembered);
// what was not bought stays for next time.
export async function finishShopping(hid) {
  const { error } = await sb.from('shopping_items').update({ cleared_at: new Date().toISOString() })
    .eq('household_id', hid).eq('done', true).is('cleared_at', null);
  if (error) throw error;
}

export async function setArea(hid, area) {
  const { error } = await sb.from('households').update({ shop_area: String(area || '').trim().slice(0, 60) || null }).eq('id', hid);
  if (error) throw error;
}
export async function getArea(hid) {
  const { data } = await sb.from('households').select('shop_area').eq('id', hid).maybeSingle();
  return (data && data.shop_area) || '';
}

// The list, kept fresh: loaded once, then every change by anyone in the
// household arrives live.
export function useShopping(hid) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  const reload = () => loadShopping(hid).then((items) => setState({ status: 'ready', items })).catch((e) => setState((s) => ({ ...s, status: s.items.length ? 'ready' : 'error', error: e.message })));
  useEffect(() => {
    if (!hid) return undefined;
    reload();
    if (!sb.channel) return undefined;
    let t = null;
    const soon = () => { clearTimeout(t); t = setTimeout(reload, 250); };
    const ch = sb.channel('shopping:' + hid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: 'household_id=eq.' + hid }, soon)
      .subscribe();
    return () => { clearTimeout(t); try { sb.removeChannel(ch); } catch (_e) { /* closed */ } };
  }, [hid]);
  // Changes made here show at once, before the server answers.
  const patch = (fn) => setState((s) => ({ ...s, items: fn(s.items) }));
  return { ...state, reload, patch };
}
