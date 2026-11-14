import { useEffect, useState } from 'preact/hooks';
import { sb } from '../lib/supabase.js';
import { cleanProperty } from '../domain/property.js';

// The household's apartments and their mortgages (table properties), loaded
// only when the apartments view opens. Without the table
// (supabase_properties.sql) the view says so instead of failing.

const state = { hid: null, status: 'idle', list: [], missing: false };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function snapshot() { return { ...state }; }

export async function load(hid) {
  if (!hid) return;
  if (state.hid !== hid) Object.assign(state, { hid, status: 'loading', list: [], missing: false });
  emit();
  const { data, error } = await sb.from('properties').select('*').eq('household_id', hid).order('created_at', { ascending: true });
  if (state.hid !== hid) return;
  Object.assign(state, error ? { status: 'error', missing: true, list: [] } : { status: 'ready', missing: false, list: data || [] });
  emit();
}

// Saves what the family typed (made safe first). Returns the saved row.
export async function saveProperty(id, input) {
  const p = cleanProperty(input);
  const fields = { name: p.name, city: p.city, home: p.home, rented: p.rented, value: p.value, rent: p.rent, costs: p.costs, mortgage: p.mortgage, rent_payer: String(input.rent_payer || '').trim().slice(0, 80) || null, account_id: input.account_id || null };
  const q = id
    ? sb.from('properties').update(fields).eq('id', id).eq('household_id', state.hid)
    : sb.from('properties').insert({ ...fields, household_id: state.hid });
  const { data, error } = await q.select().single();
  if (error) throw error;
  state.list = id ? state.list.map((r) => (r.id === id ? data : r)) : [...state.list, data];
  emit();
  return data;
}

export async function deleteProperty(id) {
  const { error } = await sb.from('properties').delete().eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.list = state.list.filter((r) => r.id !== id);
  emit();
}

export function useProperties(hid) {
  const [data, setData] = useState(snapshot);
  useEffect(() => subscribe(() => setData(snapshot())), []);
  useEffect(() => { if (hid && (snapshot().hid !== hid || snapshot().status === 'idle')) load(hid); }, [hid]);
  return data;
}
