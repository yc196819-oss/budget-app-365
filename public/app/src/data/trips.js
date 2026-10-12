import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { aiEnabled } from '../lib/settings.js';
import { tripName } from '../domain/trips.js';

// Trip folders (table trips), per household, shared by the home screen
// (a trip just found) and the plans screen (the folders). A dismissed trip
// is kept too, so it is not offered again.

const state = { hid: null, status: 'idle', trips: [], missing: false, openId: null };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function snapshot() { return { ...state }; }

export async function load(hid) {
  if (!hid) return;
  if (state.hid !== hid) Object.assign(state, { hid, status: 'loading', trips: [] });
  emit();
  const { data, error } = await sb.from('trips').select('*').eq('household_id', hid).order('start_date', { ascending: false });
  if (state.hid !== hid) return;
  // Without the table (supabase_trips.sql) the feature just stays hidden.
  Object.assign(state, error ? { status: 'error', missing: true } : { status: 'ready', missing: false, trips: data || [] });
  emit();
}

// Every transaction already in a folder, or in a trip marked "not a trip".
export function knownIds(trips) {
  const s = new Set();
  for (const t of trips) for (const id of t.transaction_ids || []) s.add(id);
  return s;
}

async function insert(found, status, people = 2) {
  const { data: u } = await sb.auth.getUser();
  const row = {
    household_id: state.hid, created_by: u?.user?.id, status, name: tripName(found).slice(0, 80), country: found.country || null,
    start_date: found.start, end_date: found.end, people, transaction_ids: found.items.map((t) => t.id)
  };
  const { data, error } = await sb.from('trips').insert(row).select().single();
  if (error) throw error;
  state.trips = [data, ...state.trips];
  emit();
  return data;
}

export const saveTrip = (found, people) => insert(found, 'saved', people);
export const dismissTrip = (found) => insert(found, 'dismissed');

export async function updateTrip(id, patch) {
  const { error } = await sb.from('trips').update(patch).eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.trips = state.trips.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

export async function deleteTrip(id) {
  const { error } = await sb.from('trips').delete().eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.trips = state.trips.filter((t) => t.id !== id);
  emit();
}

// Asks the plans screen to open this folder when it shows.
export function openLater(id) { state.openId = id; emit(); }
export function takeOpen() { const id = state.openId; state.openId = null; return id; }

// The advisor's estimate for a destination (server: /api/ai/trip-estimate).
export async function estimate(body) {
  if (!aiEnabled()) throw new Error('היועץ (AI) כבוי בפרופיל. הפעילו אותו כדי לבדוק יעד.');
  const j = await api('/api/ai/trip-estimate', { method: 'POST', body });
  return j.estimate;
}
