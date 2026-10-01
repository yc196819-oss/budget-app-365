import { sb } from '../lib/supabase.js';
import { CONFIG } from '../config.js';
import { normalizeMessages, parseSse } from '../domain/advisor.js';

// Advisor conversations live in the same tables as the current app:
// advisor_conversations (one row per conversation, shared with the
// household unless private) and advisor_messages (one row per message).
// Nothing here deletes or edits a message; old conversations stay as they are.

export async function listConversations(hid) {
  const { data, error } = await sb.from('advisor_conversations')
    .select('id,title,updated_at,user_id,is_private')
    .eq('household_id', hid)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function openConversation(id) {
  const [conv, rows] = await Promise.all([
    sb.from('advisor_conversations').select('id,title,user_id,is_private,messages').eq('id', id).single(),
    sb.from('advisor_messages').select('id,role,text,data,author_id,created_at').eq('conversation_id', id).order('created_at', { ascending: true })
  ]);
  if (conv.error) throw conv.error;
  const c = conv.data;
  return { id: c.id, title: c.title, user_id: c.user_id, is_private: !!c.is_private, messages: normalizeMessages(rows.data || [], c.messages, c.user_id) };
}

export async function createConversation({ hid, userId, title, isPrivate = false }) {
  const { data, error } = await sb.from('advisor_conversations')
    .insert({ household_id: hid, user_id: userId, title, messages: [], is_private: isPrivate, updated_at: new Date().toISOString() })
    .select('id,title,user_id,is_private,updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function addMessage({ conversationId, hid, userId, role, text }) {
  const { error } = await sb.from('advisor_messages').insert({ conversation_id: conversationId, household_id: hid, author_id: userId, role, text, data: null });
  if (error) throw error;
}

export async function setPrivate(id, isPrivate) {
  const { error } = await sb.from('advisor_conversations').update({ is_private: isPrivate }).eq('id', id);
  if (error) throw error;
}

export async function loadMemories(hid) {
  const { data } = await sb.from('advisor_memories').select('text').eq('household_id', hid).order('created_at', { ascending: false }).limit(30);
  return data || [];
}

// Streams the answer from our server; onDelta gets each piece of text.
export async function streamReply(payload, onDelta, signal) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  const res = await fetch(CONFIG.apiBase + '/api/ai/advice-chat-stream', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'היועץ לא זמין כרגע (' + res.status + ')');
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const out = parseSse(buf);
    buf = out.rest;
    for (const e of out.events) {
      if (e.error) throw new Error(e.error);
      if (e.delta) onDelta(e.delta);
    }
  }
}
