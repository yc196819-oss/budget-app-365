import { sb } from '../lib/supabase.js';
import { CONFIG } from '../config.js';
import { outcome, advisorQuestion, impact, forAdvisor, threadFor, threadHistory } from '../domain/decisions.js';
import { readLocal, writeLocal } from '../lib/storage.js';
import { buildSummary, parseReply } from '../domain/advisor.js';
import { streamReply, loadMemories } from './advisor.js';
import { saveGoal, deleteGoal } from './household.js';

// Shared decisions and the partners' answers, loaded per household and
// shared by the tab badge and the screen. Refreshed when the app comes back
// to the foreground, so an answer given on the other phone shows up.

const state = { hid: null, status: 'idle', decisions: [], votes: [], messages: [], threshold: 500, allowance: null, missing: false };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function snapshot() { return { ...state }; }

export async function load(hid) {
  if (!hid) return;
  if (state.hid !== hid) Object.assign(state, { hid, status: 'loading', decisions: [], votes: [], messages: [] });
  emit();
  const [d, v, h, msgs] = await Promise.all([
    sb.from('shared_decisions').select('*').eq('household_id', hid).order('created_at', { ascending: false }).limit(100),
    sb.from('decision_votes').select('*').eq('household_id', hid),
    sb.from('households').select('decision_threshold,personal_allowance').eq('id', hid).maybeSingle(),
    sb.from('decision_messages').select('*').eq('household_id', hid).order('created_at', { ascending: false }).limit(500)
  ]);
  if (state.hid !== hid) return;
  if (d.error) {
    // The tables are created by supabase_shared_decisions.sql.
    Object.assign(state, { status: 'error', missing: /shared_decisions|relation|schema cache/i.test(d.error.message || '') });
  } else {
    Object.assign(state, {
      status: 'ready',
      missing: false,
      decisions: d.data || [],
      votes: v.error ? [] : v.data || [],
      // The conversations come with supabase_shared_decisions.sql; without them the cards still work.
      messages: msgs.error ? [] : msgs.data || [],
      threshold: h.data && h.data.decision_threshold != null ? Number(h.data.decision_threshold) : 500,
      allowance: h.data && h.data.personal_allowance != null ? Number(h.data.personal_allowance) : null
    });
  }
  emit();
}

// Tells the server to notify the partners (push). Never blocks the action.
export async function notify(decisionId, event) {
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch(CONFIG.apiBase + '/api/decisions/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ decisionId, event }) });
  } catch (_err) { /* the card is saved; the partner will see it in the app */ }
}

export async function createDecision({ hid, userId, title, amount, category_id = null, wanted_by = null, note = null }) {
  const row = { household_id: hid, created_by: userId, title: title.trim().slice(0, 80), amount, category_id, wanted_by, note: note ? note.trim().slice(0, 500) : null, status: 'open' };
  const { data, error } = await sb.from('shared_decisions').insert(row).select().single();
  if (error) throw error;
  state.decisions = [data, ...state.decisions];
  emit();
  notify(data.id, 'opened');
  return data;
}

async function patchDecision(id, patch) {
  const { error } = await sb.from('shared_decisions').update(patch).eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.decisions = state.decisions.map((d) => (d.id === id ? { ...d, ...patch } : d));
}

// The card's status follows the answers. When it becomes approved, the
// purchase is added to the plan as a planned expense (a goal with a date, as
// everywhere in the app); when it stops being approved, that is removed.
async function settle(d, memberIds) {
  const st = outcome(d, state.votes, memberIds);
  if (st === d.status) return d.status;
  const patch = { status: st, decided_at: st === 'open' ? null : new Date().toISOString() };
  if (st === 'approved' && !d.goal_id) {
    try {
      const goal = await saveGoal({ name: d.title, target_amount: Number(d.amount), saved_amount: 0, target_date: d.wanted_by || null, icon: '🛒', plan_items: [], notes: 'אושר ב"מחליטים ביחד"' });
      patch.goal_id = goal.id;
    } catch (_err) { /* the decision still stands without the plan line */ }
  }
  if (st !== 'approved' && d.goal_id) {
    try { await deleteGoal(d.goal_id); } catch (_err) { /* already gone */ }
    patch.goal_id = null;
  }
  await patchDecision(d.id, patch);
  return st;
}

export async function answer({ decision, userId, vote, note, memberIds }) {
  const row = { decision_id: decision.id, household_id: state.hid, user_id: userId, vote, note: note ? note.trim().slice(0, 500) : null, updated_at: new Date().toISOString() };
  const { error } = await sb.from('decision_votes').upsert(row, { onConflict: 'decision_id,user_id' });
  if (error) throw error;
  state.votes = [...state.votes.filter((v) => !(v.decision_id === decision.id && v.user_id === userId)), row];
  const st = await settle(decision, memberIds);
  emit();
  notify(decision.id, 'answered');
  return st;
}

// Bought (optionally linked to the transaction) or withdrawn: final. The
// planned-expense line is removed, the real transaction now counts.
export async function close(decision, status, transactionId = null) {
  if (decision.goal_id) { try { await deleteGoal(decision.goal_id); } catch (_err) { /* already gone */ } }
  await patchDecision(decision.id, { status, goal_id: null, transaction_id: transactionId, decided_at: new Date().toISOString() });
  emit();
  notify(decision.id, status);
}

export async function saveAgreement(hid, { threshold, allowance }) {
  const patch = { decision_threshold: Math.max(0, Math.round(threshold)), personal_allowance: allowance === null || allowance === '' ? null : Math.max(0, Math.round(allowance)) };
  const { error } = await sb.from('households').update(patch).eq('id', hid);
  if (error) throw error;
  Object.assign(state, { threshold: patch.decision_threshold, allowance: patch.personal_allowance });
  emit();
}

// ── the conversation on a card ──

// When I last opened each card's conversation (this device).
const seenKey = (id) => 'seen:decision:' + id;
export function seenAt(decisionId) { return readLocal(seenKey(decisionId), ''); }
export function markSeen(decisionId) {
  const last = threadFor({ id: decisionId }, state.messages).at(-1);
  const at = last ? last.created_at : new Date().toISOString();
  if (seenAt(decisionId) >= at) return;
  writeLocal(seenKey(decisionId), at);
  emit();
}

async function addMessage(row) {
  const { data, error } = await sb.from('decision_messages').insert({ ...row, household_id: state.hid, text: String(row.text).trim().slice(0, 4000) }).select().single();
  if (error) throw error;
  state.messages = [...state.messages, data];
  markSeen(row.decision_id);
  emit();
  return data;
}

// My own message only (the database allows nothing else).
export async function deleteMessage(id) {
  const { error } = await sb.from('decision_messages').delete().eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.messages = state.messages.filter((m) => m.id !== id);
  emit();
}

export async function sendMessage({ decision, userId, text }) {
  const msg = await addMessage({ decision_id: decision.id, role: 'user', author_id: userId, text });
  notify(decision.id, 'message');
  return msg;
}

// The advisor joins the conversation: it sees the card, both answers, the
// conversation so far and the household's current numbers, and answers in
// the thread for both partners (who are notified). Streams into onDelta.
export async function askAdvisor({ decision, data, userId, memberIds, onDelta, signal }) {
  const names = data.members || {};
  const realName = (id) => names[id] || 'בן/בת הזוג';
  const thread = threadFor(decision, state.messages);
  const fx = impact(decision, data, new Date());
  const memories = await loadMemories(state.hid).catch(() => []);
  const summary = buildSummary({ ...data, userId, userName: realName(userId), memories, screen: 'together', sharedDecisions: forAdvisor(state.decisions, state.votes, memberIds) });
  let raw = '';
  const message = advisorQuestion(decision, state.votes, memberIds, realName, fx, new Date(), thread.length > 0);
  await streamReply({ summary, history: threadHistory(thread, realName), message, authorName: realName(userId) }, (delta) => { raw += delta; onDelta && onDelta(parseReply(raw).text); }, signal);
  const text = parseReply(raw).text;
  if (!text) throw new Error('לא התקבלה תשובה מהיועץ. נסו שוב.');
  const msg = await addMessage({ decision_id: decision.id, role: 'ai', author_id: userId, text });
  notify(decision.id, 'advisor');
  return msg;
}
