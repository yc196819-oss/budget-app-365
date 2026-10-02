import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { inviteInfo, acceptInvite, PENDING_INVITE, DECLINED_INVITE } from '../../data/onboarding.js';
import { INVITE_ERRORS } from '../../domain/onboarding.js';
import { writeLocal } from '../../lib/storage.js';

// "X invited you to their household": join with one tap, or start your own.
export function JoinInvite({ code, session }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Declining is remembered, so an invite in the sign-up details does not come back.
  const forget = () => { writeLocal(PENDING_INVITE, ''); writeLocal(DECLINED_INVITE, code); };

  useEffect(() => {
    inviteInfo(code).then(setInfo).catch(() => setInfo({ valid: false, reason: 'invalid' }));
  }, [code]);

  const join = async () => {
    setBusy(true); setError('');
    try {
      await acceptInvite(code);
      forget();
      session.refresh();
    } catch (err) {
      setBusy(false);
      setError(INVITE_ERRORS[err.reason] || 'ההצטרפות נכשלה. נסו שוב.');
    }
  };
  const skip = () => { forget(); session.refresh(); };

  return html`<main class="login">
    <div class="brand-login"><img class="brand-mark" src="/icon.svg" alt="" /><b class="display" style="font-size:22px">התקציב שלנו</b></div>
    ${!info && html`<div class="boot" role="status" style="min-height:auto">בודקים את ההזמנה…</div>`}
    ${info && info.valid && html`<div class="stack">
      <h1 class="display" style="font-size:32px;line-height:1.15;margin:0">${info.inviter_name} מזמין/ה אתכם להצטרף</h1>
      <p class="muted" style="line-height:1.6;margin:0">למשק הבית <b>${info.household_name}</b>. אחרי ההצטרפות תראו יחד את כל הנתונים: תנועות, חשבונות, יעדים ושיחות עם היועץ שלא סומנו כפרטיות.</p>
      ${error && html`<p class="error" role="alert">${error}</p>`}
      <button type="button" class="btn" disabled=${busy} onClick=${join}>${busy ? 'מצטרפים…' : 'להצטרף'}</button>
      <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${skip}>לא עכשיו, לפתוח משק בית משלי</button>
    </div>`}
    ${info && !info.valid && html`<div class="stack">
      <h1 class="display" style="font-size:28px;margin:0">לא ניתן להצטרף</h1>
      <p class="muted" style="line-height:1.6;margin:0">${INVITE_ERRORS[info.reason] || INVITE_ERRORS.invalid}</p>
      <button type="button" class="btn" onClick=${skip}>לפתוח משק בית משלי</button>
    </div>`}
  </main>`;
}
