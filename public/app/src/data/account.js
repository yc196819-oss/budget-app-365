import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { track } from '../lib/telemetry.js';
import { load } from './household.js';

// Everything of the household that this person can see (RLS decides), plus
// their own settings. A table that fails is listed, not silently dropped.
const HOUSEHOLD_TABLES = ['transactions', 'categories', 'category_budgets', 'bank_accounts', 'credit_cards', 'goals', 'installments', 'loans', 'investments', 'trips', 'shared_decisions', 'decision_messages', 'decision_votes', 'advisor_memories', 'memberships'];
const PAGE = 1000;

async function all(table, col, value) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('*').eq(col, value).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function exportAll(hid, userId) {
  track('export');
  const out = { exported_at: new Date().toISOString(), household_id: hid, tables: {}, failed: [] };
  const jobs = HOUSEHOLD_TABLES.map((t) => [t, 'household_id', hid]).concat([['user_settings', 'user_id', userId]]);
  await Promise.all(jobs.map(async ([t, col, v]) => {
    try { out.tables[t] = await all(t, col, v); } catch (_e) { out.failed.push(t); }
  }));
  return out;
}

export async function binItems(hid) {
  const { data, error } = await sb.from('recycle_bin').select('id,tbl,data,removed_at')
    .eq('household_id', hid).is('restored_at', null)
    .gte('removed_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('removed_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data || [];
}

export async function restore(id, hid, userId) {
  track('restore');
  const { error } = await sb.rpc('restore_from_bin', { p_id: id });
  if (error) throw error;
  await load(hid, userId, { force: true });
}

// The owner's numbers; anyone else gets "not allowed", and sees nothing.
export async function adminStats() {
  try { return await api('/api/admin/stats'); } catch (_e) { return null; }
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
