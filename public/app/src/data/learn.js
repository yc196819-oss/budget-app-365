import { sb } from '../lib/supabase.js';
import { CONFIG } from '../config.js';
import { saveGoal, setBudget, setBalance, saveRow, setIncome } from './household.js';

// What the advisor learned: ask the server, then save what the person
// approved, each item into the place it belongs. Memories live in
// advisor_memories, shared with the previous app.

async function authHeaders() {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

export async function askLearnings({ messages, context }) {
  const res = await fetch(CONFIG.apiBase + '/api/ai/learn-from-chat', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ messages, context }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'לא הצלחנו לקרוא את השיחה כרגע (' + res.status + ')');
  return Array.isArray(j.items) ? j.items : [];
}

const today = () => new Date().toISOString().slice(0, 10);

function saveOne(item, { hid, userId, conversationId }) {
  switch (item.kind) {
    case 'memory':
      return addMemory({ hid, userId, text: item.text, kind: item.memKind, conversationId });
    case 'goal':
      return saveGoal({ name: item.name, target_amount: item.target_amount, saved_amount: item.saved_amount || 0, target_date: item.target_date || null, icon: '🎯', plan_items: [] });
    case 'goal_update':
      return saveGoal({ id: item.goal_id, ...item.set });
    case 'budget':
      return setBudget(item.category_id, item.amount);
    case 'balance':
      return setBalance(item.account_id, item.balance);
    case 'loan':
      return saveRow('loans', { direction: item.direction, counterparty: item.counterparty, amount: item.amount, loan_date: today(), settled: false, note: 'נוסף מתוך שיחה עם היועץ' });
    case 'installment':
      return saveRow('installments', { description: item.description, total_amount: item.total_amount, payments_count: item.payments_count, first_payment: item.first_payment });
    case 'income':
      return setIncome(item.amount);
    default:
      return Promise.reject(new Error('unknown kind'));
  }
}

// One at a time, so a failure saves the rest and is reported by item.
export async function applyLearnings(items, ctx) {
  const done = [];
  const failed = [];
  for (const item of items) {
    try { await saveOne(item, ctx); done.push(item); } catch (_err) { failed.push(item); }
  }
  return { done, failed };
}

// ── memories: what the advisor knows about the household ──

export async function listMemories(hid) {
  const { data, error } = await sb.from('advisor_memories').select('id,text,kind,created_by,created_at').eq('household_id', hid).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}

export async function addMemory({ hid, userId, text, kind = 'decision', conversationId = null }) {
  const { data, error } = await sb.from('advisor_memories').insert({ household_id: hid, text: String(text).trim().slice(0, 120), kind, created_by: userId, source_conversation_id: conversationId }).select().single();
  if (error) throw error;
  return data;
}

export async function updateMemory(id, hid, text) {
  const { error } = await sb.from('advisor_memories').update({ text: String(text).trim().slice(0, 120) }).eq('id', id).eq('household_id', hid);
  if (error) throw error;
}

export async function deleteMemory(id, hid) {
  const { error } = await sb.from('advisor_memories').delete().eq('id', id).eq('household_id', hid);
  if (error) throw error;
}
