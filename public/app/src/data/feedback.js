import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';

// Requests to the owner (a problem or an idea): sent through the server,
// which saves them and emails the owner. The person sees theirs, with the
// status and the owner's answer.
export function sendFeedback({ kind, text, screen }) {
  const device = (matchMedia('(min-width: 900px)').matches ? 'מחשב' : 'טלפון') + (matchMedia('(display-mode: standalone)').matches ? ' · מותקנת' : '');
  return api('/api/feedback', { method: 'POST', body: { kind, text, screen, device } });
}

export async function myFeedback(userId) {
  const { data, error } = await sb.from('feedback').select('id,kind,text,status,owner_note,created_at,updated_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

// The owner's inbox.
export async function adminFeedback() {
  try { return (await api('/api/admin/feedback')).items || []; } catch (_e) { return null; }
}
export function setFeedback(id, patch) {
  return api('/api/admin/feedback/' + encodeURIComponent(id), { method: 'POST', body: patch });
}

export const FEEDBACK_KIND = { bug: { icon: '🐞', label: 'תקלה' }, idea: { icon: '💡', label: 'הצעה לשיפור' }, other: { icon: '✉️', label: 'אחר' } };
export const FEEDBACK_STATUS = { new: 'חדשה', working: 'בטיפול', done: 'טופלה', wontfix: 'לא נטפל כרגע' };
