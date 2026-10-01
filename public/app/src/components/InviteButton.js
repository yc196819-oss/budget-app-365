import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { createInvite } from '../data/onboarding.js';

// Creates a one-time invite link for the partner and shares or copies it.
export function InviteButton({ hid, userId, partner, variant = 'btn btn-ghost' }) {
  const [link, setLink] = useState('');
  const [state, setState] = useState('');
  const make = async () => {
    setState('busy');
    try {
      const url = await createInvite(hid, userId);
      setLink(url);
      const text = 'הצטרפו לתקציב המשותף שלנו: ' + url;
      if (navigator.share) {
        try { await navigator.share({ title: 'התקציב שלנו', text }); setState('shared'); return; } catch (_err) { /* cancelled: fall back to copy */ }
      }
      try { await navigator.clipboard.writeText(url); setState('copied'); } catch (_err) { setState('ready'); }
    } catch (_err) {
      setState('error');
    }
  };
  return html`<div class="stack" style="gap:6px">
    <button type="button" class=${variant} disabled=${state === 'busy'} onClick=${make}>${state === 'busy' ? 'יוצרים קישור…' : 'הזמנת ' + (partner || 'בן/בת הזוג')}</button>
    ${link && html`<input class="input num" readonly value=${link} aria-label="קישור הזמנה" onFocus=${(e) => e.target.select()} />`}
    ${state === 'copied' && html`<span class="muted" style="font-size:13px" role="status">הקישור הועתק. שלחו אותו בוואטסאפ או במייל. הוא עובד פעם אחת, במשך 7 ימים.</span>`}
    ${state === 'shared' && html`<span class="muted" style="font-size:13px" role="status">נשלח. הקישור עובד פעם אחת, במשך 7 ימים.</span>`}
    ${state === 'ready' && html`<span class="muted" style="font-size:13px" role="status">העתיקו את הקישור ושלחו אותו. הוא עובד פעם אחת, במשך 7 ימים.</span>`}
    ${state === 'error' && html`<span class="error" role="alert">לא הצלחנו ליצור קישור. נסו שוב.</span>`}
  </div>`;
}
