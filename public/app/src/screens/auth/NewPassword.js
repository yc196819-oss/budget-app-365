import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { sb } from '../../lib/supabase.js';

// After the link in a password-reset email: choose a new password.
export function NewPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    if (password.length < 8) { setError('סיסמה של 8 תווים לפחות'); return; }
    setBusy(true); setError('');
    const { error: err } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (err) { setError('לא הצלחנו לשמור את הסיסמה. נסו שוב, או בקשו קישור חדש.'); return; }
    history.replaceState(null, '', location.pathname);
    onDone();
  };
  return html`<main class="login">
    <div class="brand-login"><img class="brand-mark" src="/wallet.svg" alt="" /><b class="display" style="font-size:22px">התקציב שלנו</b></div>
    <h1 class="display" style="font-size:30px;margin:0">סיסמה חדשה</h1>
    <form class="stack" onSubmit=${save} noValidate>
      <label class="field"><span>סיסמה חדשה (8 תווים לפחות)</span>
        <input class="input" type="password" autocomplete="new-password" dir="ltr" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
      ${error && html`<p class="error" role="alert">${error}</p>`}
      <button class="btn" type="submit" disabled=${busy}>${busy ? 'שומר…' : 'לשמור ולהיכנס'}</button>
    </form>
  </main>`;
}
