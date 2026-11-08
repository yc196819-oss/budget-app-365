import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { CONFIG } from '../config.js';
import { useEffect, useState } from 'preact/hooks';

// Requests to the owner (a problem or an idea). Each is a short
// conversation: the person's request, the owner's answer (which usually
// closes it), "it helped" or one more message that reopens it. Writes go
// through the server; the person reads their own here.
export function sendFeedback({ kind, text, screen }) {
  const device = (matchMedia('(min-width: 900px)').matches ? 'מחשב' : 'טלפון') + (matchMedia('(display-mode: standalone)').matches ? ' · מותקנת' : '');
  return api('/api/feedback', { method: 'POST', body: { kind, text, screen, device } }).then((r) => { refreshFeedbackUnread(); return r; });
}

const COLS = 'id,kind,text,status,owner_note,created_at,updated_at,closed,helped,last_at,last_by,user_seen_at';
// An answer the person has not opened yet.
export const isUnread = (f) => f.last_by === 'owner' && (!f.user_seen_at || f.user_seen_at < f.last_at);

export async function myFeedback(userId) {
  const { data, error } = await sb.from('feedback').select(COLS).eq('user_id', userId).order('last_at', { ascending: false }).limit(50);
  if (error) throw error;
  const rows = data || [];
  const ids = rows.map((f) => f.id);
  const { data: msgs } = ids.length ? await sb.from('feedback_messages').select('feedback_id,author,text,created_at,image').in('feedback_id', ids).order('created_at', { ascending: true }) : { data: [] };
  return rows.map((f) => ({
    ...f,
    unread: isUnread(f),
    messages: [{ author: 'user', text: f.text, created_at: f.created_at }, ...(msgs || []).filter((m) => m.feedback_id === f.id)]
  }));
}

// { message } a reply (reopens a closed one), { helped: true }, { seen: true }.
export function replyFeedback(id, body) {
  return api('/api/feedback/' + encodeURIComponent(id), { method: 'POST', body }).then((r) => { refreshFeedbackUnread(); return r; });
}

// ── how many answers wait for the person (badge on the profile) ──
let unread = { userId: null, count: 0 };
const listeners = new Set();
export async function refreshFeedbackUnread(userId = unread.userId) {
  if (!userId) return 0;
  try {
    const { data } = await sb.from('feedback').select('last_at,last_by,user_seen_at').eq('user_id', userId).eq('last_by', 'owner').limit(50);
    unread = { userId, count: (data || []).filter(isUnread).length };
  } catch (_e) { unread = { userId, count: 0 }; }
  listeners.forEach((fn) => fn(unread.count));
  return unread.count;
}
export function useFeedbackUnread(userId) {
  const [n, setN] = useState(unread.userId === userId ? unread.count : 0);
  useEffect(() => {
    listeners.add(setN);
    if (userId && unread.userId !== userId) refreshFeedbackUnread(userId);
    const onFocus = () => { if (document.visibilityState === 'visible') refreshFeedbackUnread(userId); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { listeners.delete(setN); document.removeEventListener('visibilitychange', onFocus); };
  }, [userId]);
  return n;
}

// ── the owner's inbox ──
export async function adminFeedback() {
  try { return (await api('/api/admin/feedback')).items || []; } catch (_e) { return null; }
}
// { message, close, mail } | { note } | { status } | { pinned } | { archived } | { unread: true } | { seen: true }
export function setFeedback(id, body) {
  return api('/api/admin/feedback/' + encodeURIComponent(id), { method: 'POST', body });
}

// A draft answer from the AI: status is fixed | working | explain | idea | more;
// hint is what the owner typed so far (the gist), if anything.
export async function draftReply(id, status, hint = '') {
  return api('/api/admin/feedback/' + encodeURIComponent(id) + '/draft', { method: 'POST', body: { status, hint } });
}

export const FEEDBACK_KIND = { bug: { icon: 'wrench', label: 'תקלה' }, idea: { icon: 'bulb', label: 'רעיון' }, other: { icon: 'mail', label: 'אחר' } };
export const FEEDBACK_STATUS = { new: 'חדש', working: 'בטיפול', done: 'טופל', wontfix: 'לא נטפל כרגע' };

// ── a picture with a request ──
// Made smaller on the device first (at most 1600px, JPEG), so it sends fast
// and stays under the server's limit.
const MAX_SIDE = 1600;
export async function shrinkImage(file) {
  if (!/^image\//.test(file.type || '')) throw new Error('אפשר לצרף רק תמונה.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('לא הצלחנו לפתוח את התמונה.')); i.src = url; });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.55]) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length * 0.75 < 1.4 * 1024 * 1024) return data;
    }
    throw new Error('התמונה גדולה מדי.');
  } finally { URL.revokeObjectURL(url); }
}

export async function attachImage(id, file) {
  const data = await shrinkImage(file);
  return api('/api/feedback/' + encodeURIComponent(id) + '/image', { method: 'POST', body: { data } });
}

// The picture itself comes through the server (only the writer and the owner
// may see it), as a local address for an <img>.
export async function imageUrl(path) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch(CONFIG.apiBase + '/api/feedback-image?p=' + encodeURIComponent(path), { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
