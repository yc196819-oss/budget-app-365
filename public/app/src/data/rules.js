import { sb } from '../lib/supabase.js';
import { ruleKey } from '../domain/rules.js';

// The household's category rules ("always file X as Y"), shared by both partners.
let cache = { hid: null, rules: null };

// After a category is deleted (its rules moved or gone), read them again.
export function forgetRules() { cache = { hid: null, rules: null }; }

export async function listRules(hid) {
  if (cache.hid === hid && cache.rules) return cache.rules;
  const { data, error } = await sb.from('category_rules').select('id,type,match,label,category_id,subcategory_id,created_by,created_at').eq('household_id', hid).order('created_at', { ascending: false });
  if (error) throw error;
  cache = { hid, rules: data || [] };
  return cache.rules;
}

export async function saveRule({ hid, tx, category_id, subcategory_id = null }) {
  const row = { household_id: hid, type: tx.type === 'income' ? 'income' : 'expense', match: ruleKey(tx.description), label: String(tx.description || '').trim().slice(0, 120), category_id, subcategory_id, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from('category_rules').upsert(row, { onConflict: 'household_id,type,match' }).select('id,type,match,label,category_id,subcategory_id,created_by,created_at').single();
  if (error) throw error;
  if (cache.hid === hid && cache.rules) cache.rules = [data, ...cache.rules.filter((r) => r.id !== data.id)];
  return data;
}

export async function setRuleCategory(hid, id, category_id, subcategory_id = null) {
  const { error } = await sb.from('category_rules').update({ category_id, subcategory_id, updated_at: new Date().toISOString() }).eq('id', id).eq('household_id', hid);
  if (error) throw error;
  if (cache.hid === hid && cache.rules) cache.rules = cache.rules.map((r) => (r.id === id ? { ...r, category_id, subcategory_id } : r));
}

export async function deleteRule(hid, id) {
  const { error } = await sb.from('category_rules').delete().eq('id', id).eq('household_id', hid);
  if (error) throw error;
  if (cache.hid === hid && cache.rules) cache.rules = cache.rules.filter((r) => r.id !== id);
}
